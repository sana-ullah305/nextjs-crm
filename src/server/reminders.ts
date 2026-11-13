import { db } from "@/server/db";

/**
 * Follow-up reminder scheduler.
 *
 * Scans for due lead follow-ups (followUpAt <= now, lead still open) and
 * due/overdue tasks (dueAt/reminderAt <= now, task not completed) and creates
 * in-app notifications for the responsible user.
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

export type ReminderRunResult = {
  leadsReminded: number;
  tasksReminded: number;
  remindersCreated: number;
  scannedAt: string;
};

export async function runReminderScan(now: Date = new Date()): Promise<ReminderRunResult> {
  const orgs = await db.organization.findMany({ select: { id: true } });
  let leadsReminded = 0;
  let tasksReminded = 0;
  let remindersCreated = 0;

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
      await db.followUpReminder.create({
        data: {
          organizationId: org.id,
          userId: recipientId,
          dedupeKey,
          kind: "LEAD_FOLLOW_UP",
          title,
          body: `Scheduled follow-up for lead ${lead.firstName} ${lead.lastName} is due.`,
          link: `/leads?q=${encodeURIComponent(`${lead.firstName} ${lead.lastName}`)}`,
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
          link: `/leads?q=${encodeURIComponent(`${lead.firstName} ${lead.lastName}`)}`,
        },
      });
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
      tasksReminded++;
      remindersCreated++;
    }
  }

  return { leadsReminded, tasksReminded, remindersCreated, scannedAt: now.toISOString() };
}
