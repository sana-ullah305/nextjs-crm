import { db } from "@/server/db";
import { sendEmail, EmailConfigError, EmailSendError } from "@/server/mailer";
import type { SessionUser } from "@/server/auth";

/**
 * Follow-up reminder scheduler.
 *
 * Scans for due lead follow-ups (followUpAt <= now, lead still open) and
 * due/overdue tasks (dueAt/reminderAt <= now, task not completed) and creates
 * in-app notifications for the responsible user. When the recipient has the
 * email channel enabled (User.emailNotifications) and the matching per-type
 * preference is on, an email-channel reminder is also sent.
 *
 * Design notes:
 * - Deduplicated via FollowUpReminder.dedupeKey (org-scoped unique) so running
 *   the scan repeatedly never duplicates a reminder. Dedupe keys include a
 *   coarse "day" component so a recurring daily scan re-alerts each new day
 *   until the user acts (standard CRM nudging behavior).
 * - Triggered in-process by an API route (POST /api/reminders/run) which a
 *   cron job, uptime monitor, or scheduler can hit on an interval. This keeps
 *   the app portable (no background worker required for single-instance
 *   deployments) while leaving a clean seam to swap in a real scheduler.
 * - Reminders point at the lead's assignee (falling back to owner) and the
 *   task's assignee (falling back to creator). Skipped/completed tasks and
 *   converted/unqualified leads are excluded.
 */

const OPEN_LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED"];
const OPEN_TASK_STATUSES = ["PENDING", "IN_PROGRESS"];

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Preference keys in User.notificationPreferences. */
const PREF_TASK_REMINDERS = "taskReminders";
const PREF_LEAD_FOLLOW_UPS = "leadFollowUps";

function preferenceEnabled(raw: unknown, key: string): boolean {
  // Default true: an absent per-type key means "send it".
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "boolean") return value;
  }
  return true;
}

type Recipient = {
  id: string;
  email: string;
  name: string;
  emailNotifications: boolean;
  notificationPreferences: unknown;
};

function asSessionUser(recipient: Recipient, organizationId: string): SessionUser {
  return {
    id: recipient.id,
    organizationId,
    email: recipient.email,
    name: recipient.name,
    role: "SALES_REP",
    avatarColor: "#6366f1",
    title: "",
  } as SessionUser;
}

/**
 * Email-channel reminder. Fire-and-forget: the scan never blocks on SMTP
 * (connect timeouts can be long), and email failures never break the in-app
 * notification path. Respects the recipient's emailNotifications flag and the
 * per-type notificationPreferences key.
 */
function maybeSendEmailReminder(
  orgId: string,
  recipient: Recipient,
  kind: "lead" | "task",
  title: string,
  body: string,
  link: string,
  leadId?: string
): void {
  if (!recipient.emailNotifications) return;
  const prefKey = kind === "task" ? PREF_TASK_REMINDERS : PREF_LEAD_FOLLOW_UPS;
  if (!preferenceEnabled(recipient.notificationPreferences, prefKey)) return;

  void sendEmail({
    user: asSessionUser(recipient, orgId),
    to: { email: recipient.email, name: recipient.name },
    subject: title,
    body: `${body}\n\n${link}`,
    leadId: leadId ?? null,
    contactId: null,
    dealId: null,
  }).catch((err) => {
    // Email is a secondary channel; in-app notification already created.
    if (err instanceof EmailConfigError || err instanceof EmailSendError) return;
    console.error("Reminder email send failed", err);
  });
}

export type ReminderRunResult = {
  leadsReminded: number;
  tasksReminded: number;
  remindersCreated: number;
  emailsSent: number;
  scannedAt: string;
};

export async function runReminderScan(now: Date = new Date()): Promise<ReminderRunResult> {
  const orgs = await db.organization.findMany({ select: { id: true } });
  let leadsReminded = 0;
  let tasksReminded = 0;
  let remindersCreated = 0;
  let emailsSent = 0;

  for (const org of orgs) {
    const day = dayKey(now);

    // --- Due lead follow-ups ---
    const dueLeads = await db.lead.findMany({
      where: {
        organizationId: org.id,
        deletedAt: null,
        status: { in: OPEN_LEAD_STATUSES },
        followUpAt: { not: null, lte: now },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        assignedUserId: true,
        ownerId: true,
        followUpAt: true,
      },
      take: 500,
    });

    for (const lead of dueLeads) {
      const recipientId = lead.assignedUserId ?? lead.ownerId;
      if (!recipientId) continue;
      const dedupeKey = `lead:${lead.id}:${day}`;
      const existing = await db.followUpReminder.findUnique({
        where: { organizationId_dedupeKey: { organizationId: org.id, dedupeKey } },
        select: { id: true },
      });
      if (existing) continue;

      const overdueMs = now.getTime() - new Date(lead.followUpAt!).getTime();
      const isOverdue = overdueMs > 24 * 60 * 60 * 1000;
      const title = isOverdue
        ? `Overdue follow-up: ${lead.firstName} ${lead.lastName}`
        : `Follow-up due: ${lead.firstName} ${lead.lastName}`;
      const link = `/leads?q=${encodeURIComponent(`${lead.firstName} ${lead.lastName}`)}`;
      await db.followUpReminder.create({
        data: {
          organizationId: org.id,
          userId: recipientId,
          dedupeKey,
          kind: "LEAD_FOLLOW_UP",
          title,
          body: `Scheduled follow-up for lead ${lead.firstName} ${lead.lastName} is due.`,
          link,
          leadId: lead.id,
        },
      });
      await db.notification.create({
        data: {
          organizationId: org.id,
          userId: recipientId,
          title,
          body: `Lead follow-up is due. Open the lead to take action.`,
          type: "WARNING",
          link,
        },
      });

      const recipient = await db.user.findUnique({
        where: { id: recipientId },
        select: {
          id: true,
          email: true,
          name: true,
          emailNotifications: true,
          notificationPreferences: true,
        },
      });
      if (recipient) {
        const emailDue =
          recipient.emailNotifications &&
          preferenceEnabled(recipient.notificationPreferences, PREF_LEAD_FOLLOW_UPS);
        if (emailDue) {
          maybeSendEmailReminder(
            org.id,
            recipient,
            "lead",
            title,
            `Scheduled follow-up for lead ${lead.firstName} ${lead.lastName} is due.`,
            link,
            lead.id
          );
          emailsSent++;
        }
      }

      leadsReminded++;
      remindersCreated++;
    }

    // --- Due and overdue tasks ---
    const dueTasks = await db.task.findMany({
      where: {
        organizationId: org.id,
        status: { in: OPEN_TASK_STATUSES },
        OR: [
          { dueAt: { not: null, lte: now } },
          { reminderAt: { not: null, lte: now } },
        ],
      },
      select: {
        id: true,
        title: true,
        dueAt: true,
        reminderAt: true,
        assignedUserId: true,
        createdById: true,
        relatedType: true,
        relatedId: true,
      },
      take: 500,
    });

    for (const task of dueTasks) {
      const recipientId = task.assignedUserId ?? task.createdById;
      if (!recipientId) continue;
      const dedupeKey = `task:${task.id}:${day}`;
      const existing = await db.followUpReminder.findUnique({
        where: { organizationId_dedupeKey: { organizationId: org.id, dedupeKey } },
        select: { id: true },
      });
      if (existing) continue;

      const dueRef = task.dueAt ?? task.reminderAt!;
      const overdueMs = now.getTime() - new Date(dueRef).getTime();
      const isOverdue = overdueMs > 24 * 60 * 60 * 1000;
      let link = `/tasks`;
      if (task.relatedType && task.relatedId) {
        link = `/${task.relatedType}s/${task.relatedId}`;
      }
      const title = isOverdue ? `Task overdue: ${task.title}` : `Task due: ${task.title}`;
      await db.followUpReminder.create({
        data: {
          organizationId: org.id,
          userId: recipientId,
          dedupeKey,
          kind: isOverdue ? "TASK_OVERDUE" : "TASK_DUE",
          title,
          body: `Task "${task.title}" is due.`,
          link,
          taskId: task.id,
        },
      });
      await db.notification.create({
        data: {
          organizationId: org.id,
          userId: recipientId,
          title,
          body: `Check your task list.`,
          type: "TASK",
          link,
        },
      });

      const recipient = await db.user.findUnique({
        where: { id: recipientId },
        select: {
          id: true,
          email: true,
          name: true,
          emailNotifications: true,
          notificationPreferences: true,
        },
      });
      if (recipient) {
        const emailDue =
          recipient.emailNotifications &&
          preferenceEnabled(recipient.notificationPreferences, PREF_TASK_REMINDERS);
        if (emailDue) {
          maybeSendEmailReminder(
            org.id,
            recipient,
            "task",
            title,
            `Task "${task.title}" is due.`,
            link
          );
          emailsSent++;
        }
      }

      tasksReminded++;
      remindersCreated++;
    }
  }

  return { leadsReminded, tasksReminded, remindersCreated, emailsSent, scannedAt: now.toISOString() };
}
