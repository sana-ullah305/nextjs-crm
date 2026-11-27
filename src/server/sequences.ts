import { db } from "@/server/db";
import { sendEmail, renderTemplate } from "@/server/mailer";
import type { SessionUser } from "@/server/auth";

/**
 * Follow-up sequence scheduler.
 *
 * For each organization, finds ACTIVE enrollments whose nextSendAt is due,
 * renders the current step's subject/body templates with the record's merge
 * vars, sends through the org mailer (with the unsubscribe footer appended
 * and List-Unsubscribe headers), and advances the enrollment to the next
 * step or COMPLETED.
 *
 * Design notes:
 * - Idempotency / concurrency: a sendable enrollment is first CLAIMED with an
 *   updateMany that only matches (status ACTIVE AND nextSendAt <= now) and
 *   moves nextSendAt to a far-future placeholder. Only the scan whose
 *   updateMany reports count === 1 proceeds — that is an optimistic lock, so
 *   two simultaneous scans can never double-send the same step.
 * - Send failures are terminal for the enrollment (STOPPED, stoppedReason
 *   "send_failed: ...") — no retry logic by design; the operator can
 *   re-enroll once the SMTP issue is resolved.
 * - A missing step (steps replaced while an enrollment was mid-sequence)
 *   stops the enrollment with stoppedReason "step missing".
 * - Triggered in-process by POST /api/sequences/run (cron/scheduler
 *   friendly), mirroring reminders.ts.
 */

export const ENROLLMENT_STATUS = {
  ACTIVE: "ACTIVE",
  COMPLETED: "COMPLETED",
  STOPPED: "STOPPED",
  UNSUBSCRIBED: "UNSUBSCRIBED",
} as const;

const SCAN_BATCH_LIMIT = 500;
// Far-future placeholder used as the optimistic-lock claim value. Any real
// scheduling always overwrites it; it exists only so a claimed enrollment is
// invisible to concurrent scans until its owner finishes the step.
const CLAIMED_SENTINEL = new Date("9999-12-31T23:59:59.999Z");

/***************************************************************
 * Send retries + dead letters
 *
 * A step send that fails is retried with exponential backoff (up to
 * MAX_SEND_RETRIES retries). When every attempt is exhausted the step is
 * recorded in SequenceDeadLetter for operator review and the enrollment is
 * stopped — the scan never crashes or silently drops a single bad step.
 ***************************************************************/

/** One initial attempt plus this many retries (max 3 retries total). */
export const MAX_SEND_RETRIES = 3;
/** Base delay (ms) for exponential backoff: base, base*2, base*4, ... */
export const SEND_BACKOFF_BASE_MS = 1_000;

export function computeBackoffMs(attempt: number): number {
  return SEND_BACKOFF_BASE_MS * 2 ** (attempt - 1);
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SendOutcome =
  | { ok: true }
  | { ok: false; attempts: number; lastError: string };

/**
 * Send with exponential backoff. Every send failure is retried up to
 * MAX_SEND_RETRIES times — a transient SMTP outage shouldn't kill an
 * enrollment, and an operator may fix SMTP mid-scan. When all attempts are
 * exhausted the caller dead-letters the step and stops the enrollment.
 */
async function sendWithRetry(
  params: Parameters<typeof sendEmail>[0]
): Promise<SendOutcome> {
  let lastError = "unknown send error";
  const maxAttempts = 1 + MAX_SEND_RETRIES;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await sendEmail(params);
      return { ok: true };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt === maxAttempts) break;
      await sleep(computeBackoffMs(attempt));
    }
  }
  return { ok: false, attempts: maxAttempts, lastError };
}

export type SequenceRunResult = {
  sent: number;
  completed: number;
  stopped: number;
  deadLettered: number;
  scannedAt: string;
};

export function buildUnsubscribeUrl(unsubToken: string): string {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base}/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
}

type RecordVars = {
  contactId: string | null;
  leadId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  ownerName: string;
};

/** Load the enrolled record and build the merge vars for one send. */
async function loadRecordVars(
  organizationId: string,
  contactId: string | null,
  leadId: string | null
): Promise<RecordVars | null> {
  if (contactId) {
    const contact = await db.contact.findFirst({
      where: { id: contactId, organizationId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        ownerId: true,
        company: { select: { name: true } },
      },
    });
    if (!contact) return null;
    const owner = contact.ownerId
      ? await db.user.findUnique({ where: { id: contact.ownerId }, select: { name: true } })
      : null;
    return {
      contactId: contact.id,
      leadId: null,
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      company: contact.company?.name ?? "",
      ownerName: owner?.name ?? "",
    };
  }
  if (leadId) {
    const lead = await db.lead.findFirst({
      where: { id: leadId, organizationId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        companyName: true,
        assignedUserId: true,
        ownerId: true,
      },
    });
    if (!lead) return null;
    const owner = lead.assignedUserId ?? lead.ownerId;
    const ownerUser = owner
      ? await db.user.findUnique({ where: { id: owner }, select: { name: true } })
      : null;
    return {
      contactId: null,
      leadId: lead.id,
      email: lead.email,
      firstName: lead.firstName,
      lastName: lead.lastName,
      company: lead.companyName,
      ownerName: ownerUser?.name ?? "",
    };
  }
  return null;
}

/**
 * Shared render helper (also used by tests): merge vars into subject and
 * body, and append the mandatory unsubscribe footer to the body.
 */
export function renderSequenceStep(
  step: { subjectTemplate: string; bodyTemplate: string },
  vars: RecordVars,
  unsubscribeUrl: string
): { subject: string; body: string; footer: string } {
  const mergeVars: Record<string, string> = {
    firstName: vars.firstName,
    lastName: vars.lastName,
    email: vars.email,
    company: vars.company,
    ownerName: vars.ownerName,
    unsubscribeUrl,
  };
  const subject = renderTemplate(step.subjectTemplate, mergeVars);
  const bodyCore = renderTemplate(step.bodyTemplate, mergeVars);
  // Footer is APPENDED after rendering so caller templates can't be tricked
  // into overwriting it; the separator is the documented contract.
  const footer = `\n\n—\nTo stop receiving these emails: ${unsubscribeUrl}`;
  return { subject, body: bodyCore + footer, footer };
}

/** Stop an enrollment with a reason (idempotent; ACTIVE rows only). */
async function stopEnrollment(id: string, reason: string): Promise<void> {
  await db.sequenceEnrollment.updateMany({
    where: { id, status: ENROLLMENT_STATUS.ACTIVE },
    data: { status: ENROLLMENT_STATUS.STOPPED, stoppedReason: reason, nextSendAt: null },
  });
}

/**
 * Resolve the "sender" identity for the mailer's SentEmail/user attribution:
 * the org's first active admin (scheduler runs unattended, like inbound mail).
 */
async function resolveSystemUser(organizationId: string): Promise<SessionUser | null> {
  const user = await db.user.findFirst({
    where: { organizationId, isActive: true },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      organizationId: true,
      email: true,
      name: true,
      role: true,
      avatarColor: true,
      title: true,
    },
  });
  return user ?? null;
}

export async function runSequenceScan(now: Date = new Date()): Promise<SequenceRunResult> {
  const orgs = await db.organization.findMany({ select: { id: true } });
  let sent = 0;
  let completed = 0;
  let stopped = 0;
  let deadLettered = 0;

  for (const org of orgs) {
    const due = await db.sequenceEnrollment.findMany({
      where: {
        organizationId: org.id,
        status: ENROLLMENT_STATUS.ACTIVE,
        nextSendAt: { lte: now },
      },
      orderBy: { createdAt: "asc" },
      take: SCAN_BATCH_LIMIT,
      select: {
        id: true,
        sequenceId: true,
        contactId: true,
        leadId: true,
        enrolledEmail: true,
        currentStep: true,
        unsubToken: true,
      },
    });

    for (const enrollment of due) {
      // ---- Optimistic-lock claim ----
      // Atomically flip nextSendAt to a far-future sentinel ONLY if the row
      // is still ACTIVE and still due. Concurrent scans race here: exactly
      // one gets count === 1 and owns the step; the loser gets 0 and skips.
      const claim = await db.sequenceEnrollment.updateMany({
        where: {
          id: enrollment.id,
          organizationId: org.id,
          status: ENROLLMENT_STATUS.ACTIVE,
          nextSendAt: { lte: now },
        },
        data: { nextSendAt: CLAIMED_SENTINEL },
      });
      if (claim.count !== 1) continue;

      // Suppression check: if this person has ANY UNSUBSCRIBED enrollment
      // with the same email in the org, they opted out of sequence mail —
      // stop this enrollment without sending (mirror of the enroll-route
      // 409 UNSUBSCRIBED guard).
      const suppressed = await db.sequenceEnrollment.findFirst({
        where: {
          organizationId: org.id,
          enrolledEmail: enrollment.enrolledEmail,
          status: ENROLLMENT_STATUS.UNSUBSCRIBED,
        },
        select: { id: true },
      });
      if (suppressed) {
        await stopEnrollment(enrollment.id, "unsubscribed");
        stopped++;
        continue;
      }

      const step = await db.sequenceStep.findFirst({
        where: { sequenceId: enrollment.sequenceId, position: enrollment.currentStep },
        select: { id: true, position: true, delayHours: true, subjectTemplate: true, bodyTemplate: true },
      });
      if (!step) {
        await stopEnrollment(enrollment.id, "step missing");
        stopped++;
        continue;
      }
      const nextStep = await db.sequenceStep.findFirst({
        where: { sequenceId: enrollment.sequenceId, position: enrollment.currentStep + 1 },
        select: { position: true, delayHours: true },
      });

      const vars = await loadRecordVars(org.id, enrollment.contactId, enrollment.leadId);
      if (!vars) {
        await stopEnrollment(enrollment.id, "record missing");
        stopped++;
        continue;
      }

      const unsubscribeUrl = buildUnsubscribeUrl(enrollment.unsubToken);
      const { subject, body } = renderSequenceStep(step, vars, unsubscribeUrl);

      const systemUser = await resolveSystemUser(org.id);
      if (!systemUser) {
        // No active user in the org: nothing sane to attribute the send to.
        await stopEnrollment(enrollment.id, "send_failed: no active user in organization");
        stopped++;
        continue;
      }

      const outcome = await sendWithRetry({
        user: systemUser,
        to: { email: vars.email, name: `${vars.firstName} ${vars.lastName}`.trim() },
        subject,
        body,
        // templateId NOT set for sequence sends (rows must be distinguishable
        // from template sends in history).
        templateId: null,
        contactId: vars.contactId,
        leadId: vars.leadId,
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "One-Click",
        },
      });
      if (!outcome.ok) {
        // Every retry was exhausted: dead-letter the step for operator
        // review and stop the enrollment. Re-enroll once the underlying
        // issue (SMTP, DNS, ...) is fixed.
        await db.sequenceDeadLetter.create({
          data: {
            organizationId: org.id,
            sequenceId: enrollment.sequenceId,
            enrollmentId: enrollment.id,
            contactId: enrollment.contactId,
            leadId: enrollment.leadId,
            stepId: step.id,
            stepPosition: step.position,
            attempts: outcome.attempts,
            lastError: outcome.lastError,
          },
        });
        await stopEnrollment(enrollment.id, `send_failed: ${outcome.lastError}`);
        stopped++;
        deadLettered++;
        continue;
      }

      await db.sequenceStepEnrollment.upsert({
        where: {
          stepId_enrollmentId: { stepId: step.id, enrollmentId: enrollment.id },
        },
        create: { stepId: step.id, enrollmentId: enrollment.id },
        update: {},
      });

      sent++;
      if (nextStep) {
        await db.sequenceEnrollment.update({
          where: { id: enrollment.id },
          data: {
            currentStep: nextStep.position,
            nextSendAt: new Date(now.getTime() + nextStep.delayHours * 60 * 60 * 1000),
          },
        });
      } else {
        await db.sequenceEnrollment.update({
          where: { id: enrollment.id },
          data: { status: ENROLLMENT_STATUS.COMPLETED, nextSendAt: null },
        });
        completed++;
      }

      await db.auditLog.create({
        data: {
          organizationId: org.id,
          userId: systemUser.id,
          action: "SEQUENCE_STEP_SENT",
          entityType: "sequenceEnrollment",
          entityId: enrollment.id,
          ipAddress: "",
          metadata: JSON.stringify({
            seqId: enrollment.sequenceId,
            stepPos: step.position,
            enrollmentId: enrollment.id,
          }),
        },
      });
    }
  }

  return { sent, completed, stopped, deadLettered, scannedAt: now.toISOString() };
}
