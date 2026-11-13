import { NextRequest } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseBody, ApiNotFoundError, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

/**
 * POST /api/merge — merge two same-org records, re-pointing every related
 * row to the survivor inside one transaction.
 *
 * Merge kinds:
 *   "lead-into-contact"    conversion merge: the loser lead is marked
 *                          CONVERTED with contactId set — the same
 *                          semantics as the convert route in
 *                          src/app/api/leads/[[...id]]/route.ts
 *   "contact-into-contact" same entity, both contacts
 *   "lead-into-lead"       same entity, both leads
 *
 * Permissions: `contacts:update_all` — manager/admin only; reps are a hard
 * 403 for every kind. All loads are org-scoped; ids from another org look
 * like 404 to avoid leaking their existence.
 *
 * FK re-pointing safety: NONE of the moved foreign keys
 * (Activity.contactId/leadId, Note.contactId/leadId, Task.relatedId,
 * Deal.contactId/leadId, SentEmail.contactId/leadId,
 * InboundEmail.contactId/leadId, Lead.contactId) participates in a @@unique
 * or composite-key constraint — they are plain indexed FK columns, so rows
 * move freely and no constraint conflict can occur on re-pointing. The only
 * unique constraints on the affected tables are on unrelated columns
 * (InboundEmail [organizationId, messageId], FollowUpReminder
 * [organizationId, dedupeKey], Tag [organizationId, name]), none of which
 * this merge touches.
 *
 * The loser is NEVER hard-deleted: it is soft-deleted (deletedAt) with a
 * summary prefix documenting where it went.
 */

const mergeBodySchema = z
  .object({
    type: z.enum(["lead-into-contact", "contact-into-contact", "lead-into-lead"]),
    sourceId: z.string().trim().min(1),
    targetId: z.string().trim().min(1),
    fieldChoices: z
      .object({
        email: z.string().trim().min(1),
        firstName: z.string().trim().min(1),
        lastName: z.string().trim().min(1),
        phone: z.string(),
        title: z.string(),
        status: z.string().trim().min(1),
      })
      .partial()
      .optional(),
  })
  .refine((v) => v.sourceId !== v.targetId, {
    message: "sourceId and targetId must differ",
    path: ["targetId"],
  });

export type MergeCounts = {
  activities: number;
  notes: number;
  tasks: number;
  deals: number;
  sentEmails: number;
  inboundEmails: number;
  leads: number;
};

export type MergeResult = {
  type: string;
  sourceId: string;
  targetId: string;
  moved: MergeCounts;
};

export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireApiUserWith("contacts:update_all");
  const body = await parseBody(req, mergeBodySchema);
  return ok(await executeMerge(req, user, body));
});

/**
 * Loads both records (org-scoped; ids outside the org → 404) and dispatches
 * on the declared merge kind. Entity mismatch is impossible by construction:
 * each kind names its two entity types and loads them from those tables.
 */
async function executeMerge(
  req: NextRequest,
  user: { id: string; organizationId: string },
  body: z.infer<typeof mergeBodySchema>
): Promise<MergeResult> {
  const { type, sourceId, targetId } = body;
  const orgId = user.organizationId;

  const source =
    type === "contact-into-contact"
      ? await db.contact.findFirst({
          where: { id: sourceId, organizationId: orgId, deletedAt: null },
        })
      : await db.lead.findFirst({
          where: { id: sourceId, organizationId: orgId, deletedAt: null },
        });
  const target =
    type === "lead-into-lead"
      ? await db.lead.findFirst({
          where: { id: targetId, organizationId: orgId, deletedAt: null },
        })
      : await db.contact.findFirst({
          where: { id: targetId, organizationId: orgId, deletedAt: null },
        });

  if (!source) throw new ApiNotFoundError("Source record not found");
  if (!target) throw new ApiNotFoundError("Target record not found");

  const sourceKind: "contact" | "lead" = type === "contact-into-contact" ? "contact" : "lead";
  const targetKind: "contact" | "lead" = type === "lead-into-lead" ? "lead" : "contact";

  return await runMerge(req, user, orgId, body, sourceKind, targetKind);
}

/**
 * Executes one merge inside a single interactive transaction. Field choices
 * (when provided) overwrite the target's values; every related row is
 * re-pointed from the loser to the survivor; the loser is soft-deleted with
 * a summary pointer at the survivor; audit + owner notification conclude.
 */
async function runMerge(
  req: NextRequest,
  user: { id: string; organizationId: string },
  orgId: string,
  body: z.infer<typeof mergeBodySchema>,
  sourceKind: "contact" | "lead",
  targetKind: "contact" | "lead"
): Promise<MergeResult> {
  const { type, sourceId, targetId, fieldChoices } = body;
  const now = new Date();
  const isConversion = sourceKind === "lead" && targetKind === "contact";
  const isLeadToLead = sourceKind === "lead" && targetKind === "lead";

  const { counts, chosen } = await db.$transaction(async (tx) => {
    const counts: MergeCounts = {
      activities: 0,
      notes: 0,
      tasks: 0,
      deals: 0,
      sentEmails: 0,
      inboundEmails: 0,
      leads: 0,
    };

    const sourceContactId = sourceKind === "contact" ? sourceId : null;
    const sourceLeadId = sourceKind === "lead" ? sourceId : null;
    const targetContactId = targetKind === "contact" ? targetId : null;
    const targetLeadId = targetKind === "lead" ? targetId : null;

    // ---- 1. Re-point related rows ----
    // Lead-into-contact CONVERSION keeps leadId on history rows and ADDS
    // the surviving contactId (mirrors convert-route activity rows, which
    // carry both ids); same-entity merges move only the matching FK.
    const historyData = isConversion
      ? { contactId: targetContactId }
      : isLeadToLead
        ? { leadId: targetLeadId! }
        : { contactId: targetContactId! };
    const historyWhereLead = { organizationId: orgId, leadId: sourceLeadId! };
    const historyWhereContact = { organizationId: orgId, contactId: sourceContactId! };

    counts.activities = (
      await tx.activity.updateMany({
        where: sourceLeadId ? historyWhereLead : historyWhereContact,
        data: historyData,
      })
    ).count;
    counts.notes = (
      await tx.note.updateMany({
        where: sourceLeadId ? historyWhereLead : historyWhereContact,
        data: historyData,
      })
    ).count;
    counts.sentEmails = (
      await tx.sentEmail.updateMany({
        where: sourceLeadId ? historyWhereLead : historyWhereContact,
        data: historyData,
      })
    ).count;
    counts.inboundEmails = (
      await tx.inboundEmail.updateMany({
        where: sourceLeadId ? historyWhereLead : historyWhereContact,
        data: historyData,
      })
    ).count;

    // Tasks hang off the polymorphic (relatedType, relatedId) pair.
    counts.tasks = (
      await tx.task.updateMany({
        where: { organizationId: orgId, relatedType: sourceKind, relatedId: sourceId },
        data: { relatedType: targetKind, relatedId: targetId },
      })
    ).count;

    // Deals: a lead-into-contact merge re-points deal.leadId to NULL and
    // fills contactId (the deal now belongs to the person — the surviving
    // contact); same-entity merges move the matching FK.
    counts.deals = (
      await tx.deal.updateMany({
        where: sourceLeadId
          ? { organizationId: orgId, deletedAt: null, leadId: sourceLeadId }
          : { organizationId: orgId, deletedAt: null, contactId: sourceContactId! },
        data: isConversion
          ? { leadId: null, contactId: targetContactId }
          : historyData,
      })
    ).count;

    // ---- 2. contactId back-links on other leads ----
    // Contact-into-contact: leads whose contactId points at the losing
    // contact follow it to the survivor. Lead-into-contact: same move for
    // conversion chains recorded against the source lead (e.g. a lead
    // converted then re-merged would have linked itself; a source lead
    // normally has no back-links so this is usually a no-op count).
    if (!isLeadToLead) {
      counts.leads = (
        await tx.lead.updateMany({
          where: {
            organizationId: orgId,
            contactId: sourceId,
            deletedAt: null,
          },
          data: { contactId: targetId },
        })
      ).count;
    }

    // ---- 3. Per-field survivor choices on the target record ----
    const chosen: Record<string, string> = {};
    if (fieldChoices) {
      const updates: Record<string, string> = {};
      for (const key of ["email", "firstName", "lastName", "phone", "title", "status"] as const) {
        const value = fieldChoices[key];
        if (value !== undefined) {
          updates[key] = value;
          chosen[key] = value;
        }
      }
      // Lead has no `title` column: applying that choice would raise a
      // Prisma Unknown-argument error (500). Ignore it for lead survivors.
      if (targetKind === "lead") delete updates.title;
      if (Object.keys(updates).length > 0) {
        if (targetKind === "contact") {
          await tx.contact.update({ where: { id: targetId }, data: updates });
        } else {
          await tx.lead.update({ where: { id: targetId }, data: updates });
        }
      }
    }

    // ---- 4. Soft-delete the loser with a summary pointer; NEVER delete ----
    const prefix = `Merged into ${targetKind} ${targetId} on ${now.toISOString()}`;
    if (sourceKind === "lead") {
      // Conversion merge reuses the convert route's semantics: status
      // CONVERTED, convertedAt set, contactId pointing at the survivor.
      const data: {
        deletedAt: Date;
        summary: string;
        status?: string;
        convertedAt?: Date;
        contactId?: string;
      } = { deletedAt: now, summary: prefix };
      if (isConversion) {
        data.status = "CONVERTED";
        data.convertedAt = now;
        data.contactId = targetId;
      }
      await tx.lead.update({ where: { id: sourceId }, data });
    } else {
      await tx.contact.update({
        where: { id: sourceId },
        data: { deletedAt: now, summary: prefix },
      });
    }

    return { counts, chosen };
  });

  // ---- 5. Audit + survivor-owner notification (post-transaction: an
  // audit write failure must never roll back a completed merge) ----
  const survivorLink = targetKind === "contact" ? `/contacts/${targetId}` : `/leads/${targetId}`;
  await writeAudit({
    organizationId: orgId,
    userId: user.id,
    action: "RECORD_MERGE",
    entityType: targetKind,
    entityId: targetId,
    ipAddress: clientIp(req),
    metadata: {
      sourceType: sourceKind,
      sourceId,
      targetType: targetKind,
      targetId,
      mergeType: type,
      moved: counts,
      fieldChoices: chosen,
    },
  });

  const survivor = targetKind === "contact"
    ? await db.contact.findUnique({ where: { id: targetId }, select: { ownerId: true } })
    : await db.lead.findUnique({ where: { id: targetId }, select: { ownerId: true } });
  if (survivor?.ownerId) {
    await db.notification.create({
      data: {
        organizationId: orgId,
        userId: survivor.ownerId,
        title: "Records merged",
        body: `A ${sourceKind} record was merged into this ${targetKind}.`,
        type: "INFO",
        link: survivorLink,
      },
    });
  }

  return { type, sourceId, targetId, moved: counts };
}
