import { NextRequest } from "next/server";
import { z } from "zod";
import { apiHandler, ok, ApiNotFoundError, ApiValidationError } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { db } from "@/server/db";

/**
 * GET /api/merge/preview?type=contact|lead&id=<sourceId>&intoId=<targetId>
 *
 * Field-level diff of two records plus counts of related rows that would
 * move if the merge ran, and which record is recommended as the survivor.
 *
 * The caller may pass `intoId` from a duplicate-detection result OR pick it
 * manually — this endpoint never auto-detects, it only compares the two
 * records it is given. Both record types are guarded by `contacts:read` so
 * every role that can see a lead can preview its merge; the merge itself
 * (POST /api/merge) still requires `contacts:update_all`.
 */

const previewQuerySchema = z.object({
  type: z.enum(["contact", "lead"]),
  id: z.string().trim().min(1),
  intoId: z.string().trim().min(1),
});

export type MergePreviewField = {
  field: string;
  source: string;
  target: string;
  differs: boolean;
};

export type MergePreview = {
  source: {
    type: "contact" | "lead";
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    company: string;
    title: string;
    status: string;
    owner: string | null;
    createdAt: Date;
  };
  target: MergePreview["source"];
  fields: MergePreviewField[];
  relations: {
    activities: number;
    notes: number;
    tasks: number;
    deals: number;
    sentEmails: number;
    inboundEmails: number;
    leads: number;
  };
  recommendedSurvivor: "source" | "target";
};

type RecordShape = {
  id: string;
  type: "contact" | "lead";
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  title: string;
  status: string;
  ownerId: string | null;
  ownerName: string | null;
  createdAt: Date;
  activityCount: number;
};

async function loadContact(id: string, organizationId: string): Promise<RecordShape | null> {
  const row = await db.contact.findFirst({
    where: { id, organizationId, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      title: true,
      status: true,
      ownerId: true,
      owner: { select: { name: true } },
      createdAt: true,
      company: { select: { name: true } },
      _count: { select: { activities: true } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    type: "contact",
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    company: row.company?.name ?? "",
    title: row.title,
    status: row.status,
    ownerId: row.ownerId,
    ownerName: row.owner?.name ?? null,
    createdAt: row.createdAt,
    activityCount: row._count.activities,
  };
}

async function loadLead(id: string, organizationId: string): Promise<RecordShape | null> {
  const row = await db.lead.findFirst({
    where: { id, organizationId, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      companyName: true,
      status: true,
      ownerId: true,
      owner: { select: { name: true } },
      createdAt: true,
      _count: { select: { activities: true } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    type: "lead",
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    company: row.companyName,
    title: "",
    status: row.status,
    ownerId: row.ownerId,
    ownerName: row.owner?.name ?? null,
    createdAt: row.createdAt,
    activityCount: row._count.activities,
  };
}

function toSummary(record: RecordShape): MergePreview["source"] {
  return {
    type: record.type,
    id: record.id,
    firstName: record.firstName,
    lastName: record.lastName,
    email: record.email,
    phone: record.phone,
    company: record.company,
    title: record.title,
    status: record.status,
    owner: record.ownerName,
    createdAt: record.createdAt,
  };
}

/**
 * Survivor recommendation: the older record wins (it carries the history);
 * exact createdAt ties break by more activities. When merging a lead INTO a
 * contact the CONTACT is always recommended — conversion semantics mean
 * the lead's rows all re-point to the contact either way.
 */
function recommendSurvivor(
  source: RecordShape,
  target: RecordShape
): "source" | "target" {
  if (source.type === "lead" && target.type === "contact") return "target";
  if (source.type === "contact" && target.type === "lead") return "source";
  if (source.createdAt.getTime() !== target.createdAt.getTime()) {
    return source.createdAt < target.createdAt ? "source" : "target";
  }
  if (source.activityCount !== target.activityCount) {
    return source.activityCount > target.activityCount ? "source" : "target";
  }
  return "target";
}

export const GET = apiHandler(async (req) => {
  const user = await requireApiUserWith("contacts:read");
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const q = previewQuerySchema.safeParse(params);
  if (!q.success) {
    throw new ApiValidationError(q.error.issues);
  }

  const [source, target] = await Promise.all([
    q.data.type === "contact"
      ? loadContact(q.data.id, user.organizationId)
      : loadLead(q.data.id, user.organizationId),
    // The target is loaded by its own natural type from the id pair: a lead
    // may merge into a lead or a contact; a contact into a contact. The
    // caller may also pass ?targetType=contact|lead explicitly (used by the
    // lead-into-contact flow); when absent both tables are probed in order.
    loadTarget(req, q.data, user.organizationId),
  ]);
  if (!source) throw new ApiNotFoundError("Source record not found");
  if (!target) throw new ApiNotFoundError("Target record not found");

  const fields: MergePreviewField[] = [
    ["firstName", source.firstName, target.firstName],
    ["lastName", source.lastName, target.lastName],
    ["email", source.email, target.email],
    ["phone", source.phone, target.phone],
    ["company", source.company, target.company],
    ["title", source.title, target.title],
    ["status", source.status, target.status],
    ["owner", source.ownerName ?? "", target.ownerName ?? ""],
    ["createdAt", source.createdAt.toISOString(), target.createdAt.toISOString()],
  ].map(([field, a, b]) => ({
    field: field as string,
    source: a as string,
    target: b as string,
    differs: a !== b,
  }));

  const relations = await countRelations(source, target, user.organizationId);

  const preview: MergePreview = {
    source: toSummary(source),
    target: toSummary(target),
    fields,
    relations,
    recommendedSurvivor: recommendSurvivor(source, target),
  };
  return ok(preview);
});

async function loadTarget(
  req: NextRequest,
  q: z.infer<typeof previewQuerySchema>,
  organizationId: string
): Promise<RecordShape | null> {
  const explicit = new URL(req.url).searchParams.get("targetType");
  if (explicit === "contact") return loadContact(q.intoId, organizationId);
  if (explicit === "lead") return loadLead(q.intoId, organizationId);
  // Default: prefer a matching contact (the stronger entity), fall back to
  // a lead. Covers contact-into-contact, lead-into-lead, and lead-into-
  // contact without forcing the caller to know the target's type.
  return (await loadContact(q.intoId, organizationId)) ?? loadLead(q.intoId, organizationId);
}

/**
 * Counts of source-side related rows that a merge would re-point at the
 * target. `leads` counts leads whose contactId points at the SOURCE contact
 * (they would be re-linked to the target contact in a lead-into-contact or
 * contact-into-contact merge); it is 0 when the source is a lead.
 */
async function countRelations(
  source: RecordShape,
  target: RecordShape,
  organizationId: string
): Promise<MergePreview["relations"]> {
  const sourceContactId = source.type === "contact" ? source.id : null;
  const sourceLeadId = source.type === "lead" ? source.id : null;
  // Deals are soft-deletable; activities, notes, sentEmails, and
  // inboundEmails have no deletedAt column, so they scope by org only.
  const personOr = [
    ...(sourceContactId ? [{ contactId: sourceContactId }] : []),
    ...(sourceLeadId ? [{ leadId: sourceLeadId }] : []),
  ];

  const [activities, notes, tasks, deals, sentEmails, inboundEmails, leads] =
    await Promise.all([
      db.activity.count({ where: { organizationId, OR: personOr } }),
      db.note.count({ where: { organizationId, OR: personOr } }),
      db.task.count({
        where: {
          organizationId,
          relatedType: source.type,
          relatedId: source.id,
        },
      }),
      db.deal.count({
        where: { organizationId, deletedAt: null, OR: personOr },
      }),
      db.sentEmail.count({ where: { organizationId, OR: personOr } }),
      db.inboundEmail.count({ where: { organizationId, OR: personOr } }),
      sourceContactId
        ? db.lead.count({
            where: { organizationId, contactId: sourceContactId, deletedAt: null },
          })
        : Promise.resolve(0),
    ]);

  void target;
  return { activities, notes, tasks, deals, sentEmails, inboundEmails, leads };
}
