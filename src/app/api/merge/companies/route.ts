import { NextRequest } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseBody, ApiNotFoundError, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

/**
 * POST /api/merge/companies — merge two companies in the same org.
 *
 * The losing company is soft-deleted (deletedAt set) with a summary pointer
 * at the survivor; it is NEVER hard-deleted. Before the loser is archived:
 *   - contacts.companyId, leads.companyId, deals.companyId, activities.companyId,
 *     and notes.companyId are re-pointed from the loser to the survivor;
 *   - tasks hanging off the loser via (relatedType="company", relatedId) move
 *     to the survivor;
 *   - tags across the combined company's contacts are unioned (unique by tag
 *     id) so no tag is lost — see mergeCompanyTags.
 *
 * Field choices (when provided) overwrite the survivor's column values.
 *
 * Permissions: `companies:merge` — manager/admin only; reps are a hard 403.
 * All loads are org-scoped; ids from another org look like 404.
 *
 * FK re-pointing safety: companyId is a plain indexed FK on Contact, Lead,
 * Deal, Activity, and Note (onDelete: SetNull / Cascade) — none participates
 * in a @@unique constraint, so rows move freely with no conflict.
 */

const mergeBodySchema = z
  .object({
    sourceId: z.string().trim().min(1),
    targetId: z.string().trim().min(1),
    fieldChoices: z
      .object({
        name: z.string().trim().min(1),
        domain: z.string(),
        industry: z.string(),
        size: z.string(),
        phone: z.string(),
        website: z.string(),
        address: z.string(),
        city: z.string(),
        state: z.string(),
        country: z.string(),
      })
      .partial()
      .optional(),
  })
  .refine((v) => v.sourceId !== v.targetId, {
    message: "sourceId and targetId must differ",
    path: ["targetId"],
  });

export type CompanyMergeCounts = {
  contacts: number;
  leads: number;
  deals: number;
  activities: number;
  notes: number;
  tasks: number;
};

export type CompanyMergeResult = {
  sourceId: string;
  targetId: string;
  moved: CompanyMergeCounts;
  tagsMerged: number;
};

export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireApiUserWith("companies:merge");
  const body = await parseBody(req, mergeBodySchema);
  return ok(await executeCompanyMerge(req, user, body));
});

async function executeCompanyMerge(
  req: NextRequest,
  user: { id: string; organizationId: string },
  body: z.infer<typeof mergeBodySchema>
): Promise<CompanyMergeResult> {
  const orgId = user.organizationId;
  const [source, target] = await Promise.all([
    db.company.findFirst({
      where: { id: body.sourceId, organizationId: orgId, deletedAt: null },
    }),
    db.company.findFirst({
      where: { id: body.targetId, organizationId: orgId, deletedAt: null },
    }),
  ]);
  if (!source) throw new ApiNotFoundError("Source company not found");
  if (!target) throw new ApiNotFoundError("Target company not found");
  return runCompanyMerge(req, user, orgId, body);
}

async function runCompanyMerge(
  req: NextRequest,
  user: { id: string; organizationId: string },
  orgId: string,
  body: z.infer<typeof mergeBodySchema>
): Promise<CompanyMergeResult> {
  const { sourceId, targetId, fieldChoices } = body;
  const now = new Date();

  const { counts, tagsMerged } = await db.$transaction(async (tx) => {
    const counts: CompanyMergeCounts = {
      contacts: 0,
      leads: 0,
      deals: 0,
      activities: 0,
      notes: 0,
      tasks: 0,
    };

    // ---- 1. Re-point every companyId FK from loser -> survivor ----
    counts.contacts = (
      await tx.contact.updateMany({
        where: { organizationId: orgId, companyId: sourceId },
        data: { companyId: targetId },
      })
    ).count;
    counts.leads = (
      await tx.lead.updateMany({
        where: { organizationId: orgId, companyId: sourceId },
        data: { companyId: targetId },
      })
    ).count;
    counts.deals = (
      await tx.deal.updateMany({
        where: { organizationId: orgId, deletedAt: null, companyId: sourceId },
        data: { companyId: targetId },
      })
    ).count;
    counts.activities = (
      await tx.activity.updateMany({
        where: { organizationId: orgId, companyId: sourceId },
        data: { companyId: targetId },
      })
    ).count;
    counts.notes = (
      await tx.note.updateMany({
        where: { organizationId: orgId, companyId: sourceId },
        data: { companyId: targetId },
      })
    ).count;
    // Tasks hang off the polymorphic (relatedType, relatedId) pair.
    counts.tasks = (
      await tx.task.updateMany({
        where: { organizationId: orgId, relatedType: "company", relatedId: sourceId },
        data: { relatedId: targetId },
      })
    ).count;

    // ---- 2. Combine tags across the combined company's contacts ----
    const tagsMerged = await mergeCompanyTags(tx, orgId, targetId);

    // ---- 3. Per-field survivor choices on the target record ----
    if (fieldChoices) {
      const updates: Record<string, string> = {};
      for (const key of [
        "name",
        "domain",
        "industry",
        "size",
        "phone",
        "website",
        "address",
        "city",
        "state",
        "country",
      ] as const) {
        const value = fieldChoices[key];
        if (value !== undefined) updates[key] = value;
      }
      if (Object.keys(updates).length > 0) {
        await tx.company.update({ where: { id: targetId }, data: updates });
      }
    }

    // ---- 4. Soft-delete the loser with a summary pointer; NEVER delete ----
    await tx.company.update({
      where: { id: sourceId },
      data: {
        deletedAt: now,
        summary: `Merged into company ${targetId} on ${now.toISOString()}`,
      },
    });

    return { counts, tagsMerged };
  });

  // ---- 5. Audit + survivor-owner notification (post-transaction) ----
  await writeAudit({
    organizationId: orgId,
    userId: user.id,
    action: "COMPANY_MERGE",
    entityType: "company",
    entityId: targetId,
    ipAddress: clientIp(req),
    metadata: {
      sourceId,
      targetId,
      moved: counts,
      tagsMerged,
      fieldChoices: fieldChoices ?? {},
    },
  });

  const survivor = await db.company.findUnique({
    where: { id: targetId },
    select: { ownerId: true },
  });
  if (survivor?.ownerId) {
    await db.notification.create({
      data: {
        organizationId: orgId,
        userId: survivor.ownerId,
        title: "Companies merged",
        body: "A duplicate company was merged into this company.",
        type: "INFO",
        link: `/companies/${targetId}`,
      },
    });
  }

  return { sourceId, targetId, moved: counts, tagsMerged };
}

/**
 * Unions the tag set across all contacts of the (already re-pointed) survivor
 * company. Tags are unique by id within the org; every tag that existed on
 * ANY of the company's contacts is connected to EVERY contact of the company,
 * guaranteeing no tag is lost in the merge. Returns the number of NEW
 * contact<->tag links created.
 */
async function mergeCompanyTags(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  orgId: string,
  targetId: string
): Promise<number> {
  const contacts: { id: string; tags: { id: string }[] }[] = await tx.contact.findMany({
    where: { organizationId: orgId, companyId: targetId },
    select: { id: true, tags: { select: { id: true } } },
  });
  const allTagIds = Array.from(
    new Set(contacts.flatMap((c) => c.tags.map((t) => t.id)))
  );
  if (allTagIds.length === 0) return 0;

  let created = 0;
  for (const c of contacts) {
    const existing = new Set(c.tags.map((t) => t.id));
    const toAdd = allTagIds.filter((id) => !existing.has(id));
    if (toAdd.length === 0) continue;
    await tx.contact.update({
      where: { id: c.id },
      data: { tags: { connect: toAdd.map((id) => ({ id })) } },
    });
    created += toAdd.length;
  }
  return created;
}
