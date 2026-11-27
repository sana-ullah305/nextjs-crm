import { db } from "@/server/db";
import {
  normalizeEmail,
  normalizeName,
  normalizeCompany,
  emailLocalPart,
} from "@/lib/dedupe-normalize";

/**
 * Cross-entity duplicate detection and merge guard.
 *
 * Duplicate candidates are found across BOTH contacts and leads within one
 * organization (soft-deleted rows never participate). Scoring is fully
 * deterministic — no ML, no fuzzy libraries:
 *
 *   normalized email exact match .................. 100
 *   same normalized email local-part + last name ..  55
 *   same normalized first+last name ................  45
 *   same company name (normalized) + last name .....  35
 *
 * Signals compose additively and the total is capped at 100. A record is a
 * candidate when its score is >= 35 (the "company + last name" floor).
 *
 * Normalization (lowercase, punctuation stripping, whitespace collapse,
 * and a small hardcoded diminutive map: Robert → Bob/Rob etc.) lives in
 * src/lib/dedupe-normalize.ts so the finder, the routes, and the tests all
 * share one definition of "the same value".
 */

export const CANDIDATE_THRESHOLD = 35;

export type CandidateRecord = {
  id: string;
  type: "contact" | "lead";
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: string;
  company: string;
  createdAt: Date;
  score: number;
  matchReasons: string[];
};

type ScoredFields = {
  firstName: string;
  lastName: string;
  email: string;
  companyName: string;
};

type CandidateRow = {
  firstName: string;
  lastName: string;
  email: string;
  type: "contact" | "lead";
  company?: { name: string } | null;
  companyName?: string;
};

/**
 * Additive duplicate score of `candidate` vs `subject`, capped at 100.
 * Pure function — both inputs are plain loaded rows.
 */
function scoreCandidate(
  subject: ScoredFields,
  candidate: CandidateRow
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const subjectEmail = normalizeEmail(subject.email);
  const candidateEmail = normalizeEmail(candidate.email);
  const subjectLastName = normalizeName(subject.lastName);
  const candidateLastName = normalizeName(candidate.lastName);

  if (subjectEmail && candidateEmail) {
    if (subjectEmail === candidateEmail) {
      score += 100;
      reasons.push("email_exact");
    } else if (
      emailLocalPart(subjectEmail) === emailLocalPart(candidateEmail) &&
      subjectLastName === candidateLastName
    ) {
      score += 55;
      reasons.push("email_local_part+last_name");
    }
  }

  const subjectFirstName = normalizeName(subject.firstName);
  const candidateFirstLast = normalizeName(
    `${candidate.firstName} ${candidate.lastName}`
  );
  if (
    subjectFirstName &&
    subjectLastName &&
    candidateFirstLast === normalizeName(`${subject.firstName} ${subject.lastName}`)
  ) {
    score += 45;
    reasons.push("first+last_name");
  }

  const subjectCompany = normalizeCompany(subject.companyName);
  const candidateCompany = normalizeCompany(
    candidate.type === "contact" ? candidate.company?.name ?? "" : candidate.companyName ?? ""
  );
  if (
    subjectCompany &&
    candidateCompany &&
    subjectCompany === candidateCompany &&
    subjectLastName === candidateLastName
  ) {
    score += 35;
    reasons.push("company+last_name");
  }

  return { score: Math.min(score, 100), reasons };
}

/**
 * Finds likely duplicates of one contact or lead across BOTH contacts and
 * leads in the same organization. Soft-deleted rows and already-converted
 * leads are excluded as candidates — a converted lead is already the same
 * person as its linked contact, and a lead still pointing at a contact
 * (contactId set) is that contact's own conversion record, not a duplicate.
 */
export async function findDuplicateCandidates(
  organizationId: string,
  entityType: "contact" | "lead",
  id: string
): Promise<CandidateRecord[]> {
  const isContact = entityType === "contact";
  const subject = isContact
    ? await db.contact.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          company: { select: { name: true } },
        },
      })
    : await db.lead.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          companyName: true,
        },
      });
  if (!subject) return [];

  const subjectFields: ScoredFields = {
    firstName: subject.firstName,
    lastName: subject.lastName,
    email: subject.email,
    companyName:
      "companyName" in subject ? subject.companyName ?? "" : (subject as { company?: { name: string } | null }).company?.name ?? "",
  };

  // Both candidate queries are org-scoped by construction, so records from
  // another organization can never leak into the results.
  const [contacts, leads] = await Promise.all([
    db.contact.findMany({
      where: { organizationId, deletedAt: null, id: { not: id } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
        company: { select: { name: true } },
      },
    }),
    db.lead.findMany({
      where: {
        organizationId,
        deletedAt: null,
        id: { not: id },
        status: { not: "CONVERTED" },
        contactId: null,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
        companyName: true,
      },
    }),
  ]);

  const candidates: CandidateRecord[] = [];
  for (const row of contacts) {
    const { score, reasons } = scoreCandidate(subjectFields, { ...row, type: "contact" });
    if (score >= CANDIDATE_THRESHOLD) {
      candidates.push(toCandidate(row, "contact", score, reasons));
    }
  }
  for (const row of leads) {
    const { score, reasons } = scoreCandidate(subjectFields, { ...row, type: "lead" });
    if (score >= CANDIDATE_THRESHOLD) {
      candidates.push(toCandidate(row, "lead", score, reasons));
    }
  }
  return candidates.sort(
    (a, b) => b.score - a.score || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)
  );
}

function toCandidate(
  row: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    status: string;
    createdAt: Date;
    company?: { name: string } | null;
    companyName?: string;
  },
  type: "contact" | "lead",
  score: number,
  reasons: string[]
): CandidateRecord {
  const company =
    type === "contact" ? row.company?.name ?? "" : row.companyName ?? "";
  return {
    id: row.id,
    type,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    status: row.status,
    company,
    createdAt: row.createdAt,
    score,
    matchReasons: reasons,
  };
}

/**
 * Quick org-scoped existence check for an email across BOTH contacts and
 * leads (soft-deleted rows excluded). Used as a pre-flight "does this
 * person already exist" lookup by any caller, including the
 * sequence-enrollment guard below.
 */
export async function findDuplicateCandidatesByEmail(
  organizationId: string,
  email: string
): Promise<Array<{ id: string; type: "contact" | "lead" }>> {
  const normalized = normalizeEmail(email);
  if (!normalized) return [];
  const [contacts, leads] = await Promise.all([
    db.contact.findMany({
      where: { organizationId, email: normalized, deletedAt: null },
      select: { id: true },
    }),
    db.lead.findMany({
      where: { organizationId, email: normalized, deletedAt: null },
      select: { id: true },
    }),
  ]);
  return [
    ...contacts.map((c) => ({ id: c.id, type: "contact" as const })),
    ...leads.map((l) => ({ id: l.id, type: "lead" as const })),
  ];
}

/** Thrown by assertNotAlreadyEnrolled when the email is actively enrolled. */
export class MergeGuardError extends Error {
  constructor(
    public details: {
      enrollmentId?: string;
      contactId?: string | null;
      leadId?: string | null;
      sequenceId?: string | null;
    }
  ) {
    super("ALREADY_ENROLLED");
    this.name = "MergeGuardError";
  }
}

async function tableExists(tableName: string): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    tableName
  );
  return rows.length > 0;
}

/**
 * Merge guard for sequence enrollment: throws MergeGuardError when a
 * contact or lead with this email (org-scoped) is enrolled in an ACTIVE
 * sequence enrollment. A person can sit behind two records (a contact and
 * a lead), so the guard resolves EVERY record carrying the email and checks
 * enrollments linked to any of them, plus enrollments snapshotted with the
 * same enrolledEmail (covers enrollments orphaned by a later record edit).
 *
 * Stable signature for the sequences feature's enrollment code:
 *   (organizationId: string, email: string) => Promise<void>
 *
 * Implementation notes:
 * - The SequenceEnrollment table is defined by the sequences schema, which
 *   is merged into this tree separately. Its absence means no enrollment
 *   can exist, so the guard resolves cleanly instead of crashing — the
 *   export stays callable in every merged-tree configuration.
 * - The table is queried via raw SQL because this workspace's generated
 *   Prisma client predates the sequences schema; the columns used here
 *   (contactId, leadId, enrolledEmail, status, sequenceId) are pinned by
 *   the sequences schema contract.
 */
export async function assertNotAlreadyEnrolled(
  organizationId: string,
  email: string
): Promise<void> {
  if (!(await tableExists("SequenceEnrollment"))) {
    return;
  }
  const normalized = normalizeEmail(email);
  if (!normalized) return;

  const [contacts, leads] = await Promise.all([
    db.contact.findMany({
      where: { organizationId, email: normalized, deletedAt: null },
      select: { id: true },
    }),
    db.lead.findMany({
      where: { organizationId, email: normalized, deletedAt: null },
      select: { id: true },
    }),
  ]);
  const contactIds = contacts.map((c) => c.id);
  const leadIds = leads.map((l) => l.id);

  const conditions: string[] = [`"enrolledEmail" = ?`];
  const params: Array<string> = [organizationId, "ACTIVE", normalized];
  if (contactIds.length > 0) {
    conditions.push(`("contactId" IN (${contactIds.map(() => "?").join(", ")}))`);
    params.push(...contactIds);
  }
  if (leadIds.length > 0) {
    conditions.push(`("leadId" IN (${leadIds.map(() => "?").join(", ")}))`);
    params.push(...leadIds);
  }

  const rows = await db.$queryRawUnsafe<
    Array<{
      id: string;
      contactId: string | null;
      leadId: string | null;
      sequenceId: string | null;
    }>
  >(
    `SELECT "id", "contactId", "leadId", "sequenceId" FROM "SequenceEnrollment" ` +
      `WHERE "organizationId" = ? AND "status" = ? AND (${conditions.join(" OR ")}) LIMIT 1`,
    ...params
  );
  const enrollment = rows[0];
  if (enrollment) {
    throw new MergeGuardError({
      enrollmentId: enrollment.id,
      contactId: enrollment.contactId,
      leadId: enrollment.leadId,
      sequenceId: enrollment.sequenceId,
    });
  }
}
