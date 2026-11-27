import { NextRequest } from "next/server";
import { z } from "zod";
import { apiHandler, ok, ApiNotFoundError, ApiValidationError } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { db } from "@/server/db";

/**
 * GET /api/merge/companies/preview?id=<sourceId>&intoId=<targetId>
 *
 * Field-level diff of two companies plus counts of related rows that would
 * move if the merge ran, the tag union that would result, and which company
 * is recommended as the survivor (the older record keeps its history).
 *
 * Guarded by `companies:merge` (manager/admin) to match the POST endpoint —
 * the preview exposes the same cross-record data the merge acts on.
 */

const previewQuerySchema = z.object({
  id: z.string().trim().min(1),
  intoId: z.string().trim().min(1),
});

export type CompanyPreviewField = {
  field: string;
  source: string;
  target: string;
  differs: boolean;
};

export type CompanyMergePreview = {
  source: CompanySummary;
  target: CompanySummary;
  fields: CompanyPreviewField[];
  relations: {
    contacts: number;
    leads: number;
    deals: number;
    activities: number;
    notes: number;
    tasks: number;
  };
  tags: {
    source: string[];
    target: string[];
    combined: string[];
  };
  recommendedSurvivor: "source" | "target";
};

type CompanySummary = {
  id: string;
  name: string;
  domain: string;
  industry: string;
  size: string;
  phone: string;
  website: string;
  city: string;
  country: string;
  owner: string | null;
  createdAt: Date;
  contactCount: number;
};

const COMPANY_FIELDS = [
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
] as const;

async function loadCompany(
  id: string,
  organizationId: string
): Promise<CompanySummary | null> {
  const row = await db.company.findFirst({
    where: { id, organizationId, deletedAt: null },
    select: {
      id: true,
      name: true,
      domain: true,
      industry: true,
      size: true,
      phone: true,
      website: true,
      city: true,
      country: true,
      ownerId: true,
      owner: { select: { name: true } },
      createdAt: true,
      _count: { select: { contacts: true } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    industry: row.industry,
    size: row.size,
    phone: row.phone,
    website: row.website,
    city: row.city,
    country: row.country,
    owner: row.owner?.name ?? null,
    createdAt: row.createdAt,
    contactCount: row._count.contacts,
  };
}

export const GET = apiHandler(async (req: NextRequest) => {
  const user = await requireApiUserWith("companies:merge");
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const q = previewQuerySchema.safeParse(params);
  if (!q.success) {
    throw new ApiValidationError(q.error.issues);
  }

  const orgId = user.organizationId;
  const [source, target] = await Promise.all([
    loadCompany(q.data.id, orgId),
    loadCompany(q.data.intoId, orgId),
  ]);
  if (!source) throw new ApiNotFoundError("Source company not found");
  if (!target) throw new ApiNotFoundError("Target company not found");

  const fields: CompanyPreviewField[] = COMPANY_FIELDS.map((field) => {
    const a = String(source[field as keyof CompanySummary] ?? "");
    const b = String(target[field as keyof CompanySummary] ?? "");
    return { field, source: a, target: b, differs: a !== b };
  });

  const relations = await countRelations(source.id, target.id, orgId);
  const tags = await loadTags(source.id, target.id, orgId);

  const preview: CompanyMergePreview = {
    source,
    target,
    fields,
    relations,
    tags,
    recommendedSurvivor: recommendSurvivor(source, target),
  };
  return ok(preview);
});

function recommendSurvivor(
  source: CompanySummary,
  target: CompanySummary
): "source" | "target" {
  if (source.createdAt.getTime() !== target.createdAt.getTime()) {
    return source.createdAt < target.createdAt ? "source" : "target";
  }
  if (source.contactCount !== target.contactCount) {
    return source.contactCount > target.contactCount ? "source" : "target";
  }
  return "target";
}

async function countRelations(
  sourceId: string,
  targetId: string,
  organizationId: string
): Promise<CompanyMergePreview["relations"]> {
  // Counts are SOURCE-side rows that would move to the target.
  const [contacts, leads, deals, activities, notes, tasks] = await Promise.all([
    db.contact.count({ where: { organizationId, companyId: sourceId } }),
    db.lead.count({ where: { organizationId, companyId: sourceId } }),
    db.deal.count({ where: { organizationId, deletedAt: null, companyId: sourceId } }),
    db.activity.count({ where: { organizationId, companyId: sourceId } }),
    db.note.count({ where: { organizationId, companyId: sourceId } }),
    db.task.count({
      where: { organizationId, relatedType: "company", relatedId: sourceId },
    }),
  ]);
  void targetId;
  return { contacts, leads, deals, activities, notes, tasks };
}

/**
 * Tag names on each company's contacts, plus the deduped union that the
 * merge would apply across the combined company's contacts.
 */
async function loadTags(
  sourceId: string,
  targetId: string,
  organizationId: string
): Promise<CompanyMergePreview["tags"]> {
  const [sourceRows, targetRows] = await Promise.all([
    db.contact.findMany({
      where: { organizationId, companyId: sourceId },
      select: { tags: { select: { name: true } } },
    }),
    db.contact.findMany({
      where: { organizationId, companyId: targetId },
      select: { tags: { select: { name: true } } },
    }),
  ]);
  const source = Array.from(
    new Set(sourceRows.flatMap((r) => r.tags.map((t) => t.name)))
  ).sort();
  const target = Array.from(
    new Set(targetRows.flatMap((r) => r.tags.map((t) => t.name)))
  ).sort();
  const combined = Array.from(new Set([...source, ...target])).sort();
  return { source, target, combined };
}
