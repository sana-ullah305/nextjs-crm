import { db } from "@/server/db";
import { scoreLead } from "@/lib/lead-score";

// Shared lead-ingestion pipeline used by both the internal
// POST /api/leads route (session-authenticated users) and the public
// POST /api/leads/capture route (API-key callers). Scoring and duplicate
// detection live here so both entry points stay behaviorally identical.

export type CaptureInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  companyName: string;
  sourceName?: string | null;
};

export type CapturedLead = {
  lead: {
    id: string;
    status: string;
    score: number;
    firstName: string;
    lastName: string;
    email: string;
    companyId: string | null;
    sourceId: string | null;
  };
  duplicateOfId: string | null;
  assignedUserId: string;
  companyId: string | null;
};

type ScoreArgs = {
  estimatedValue?: number;
  hasFollowUp?: boolean;
};

/** Computes the 0-100 score exactly like the internal route does. */
export function captureScore(input: CaptureInput, extra: ScoreArgs = {}): number {
  return scoreLead({
    email: input.email,
    phone: input.phone,
    companyName: input.companyName,
    estimatedValue: extra.estimatedValue ?? 0,
    sourceName: input.sourceName ?? "",
    hasFollowUp: extra.hasFollowUp ?? false,
  });
}

/** Finds an active (non-deleted) lead with the same email in the org. */
export async function findDuplicateLeadByEmail(
  organizationId: string,
  email: string
): Promise<{ id: string } | null> {
  const lead = await db.lead.findFirst({
    where: { organizationId, email, deletedAt: null },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return lead;
}

/**
 * Round-robin assignment: picks the org user with the SALES_REP role who has
 * the fewest active leads (ties broken by oldest lead), falling back to the
 * key creator when the org has no sales reps. Keeps public captures spread
 * evenly without exposing internal user data to the caller.
 */
export async function pickAssignee(
  organizationId: string,
  fallbackUserId: string
): Promise<string> {
  const reps = await db.user.findMany({
    where: { organizationId, role: "SALES_REP", isActive: true },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (reps.length === 0) return fallbackUserId;
  const counts = await db.lead.groupBy({
    by: ["assignedUserId"],
    where: {
      organizationId,
      deletedAt: null,
      status: { notIn: ["CONVERTED", "UNQUALIFIED"] },
    },
    _count: { _all: true },
  });
  const countByUser = new Map<string, number>();
  for (const row of counts) {
    if (row.assignedUserId) countByUser.set(row.assignedUserId, row._count._all);
  }
  let best = reps[0]!.id;
  let bestCount = countByUser.get(best) ?? 0;
  for (const rep of reps.slice(1)) {
    const c = countByUser.get(rep.id) ?? 0;
    if (c < bestCount) {
      best = rep.id;
      bestCount = c;
    }
  }
  return best;
}

/** Resolves or creates the LeadSource row for a free-text capture source tag. */
export async function resolveCaptureSource(
  organizationId: string,
  source: string
): Promise<string | null> {
  const existing = await db.leadSource.findUnique({
    where: { organizationId_name: { organizationId, name: source } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await db.leadSource.create({
    data: { organizationId, name: source, description: "Created by lead capture API" },
  });
  return created.id;
}

/** Resolves or creates the Company row for a capture's companyName. */
export async function resolveCaptureCompany(
  organizationId: string,
  companyName: string
): Promise<string | null> {
  if (!companyName) return null;
  const existing = await db.company.findFirst({
    where: { organizationId, name: companyName, deletedAt: null },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await db.company.create({
    data: { organizationId, name: companyName },
  });
  return created.id;
}
