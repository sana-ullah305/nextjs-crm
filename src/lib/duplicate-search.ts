import { api } from "@/lib/api-client";

export const CANDIDATE_THRESHOLD = 35;

export type DuplicateSubject = {
  id: string;
  type: "contact" | "lead";
  firstName: string;
  lastName: string;
  email: string;
  companyName: string;
};

export type DuplicateCandidate = {
  id: string;
  type: "contact" | "lead";
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: string;
  company: string;
  createdAt: string;
  score: number;
  matchReasons: string[];
};

type CandidatesResponse = {
  candidates: DuplicateCandidate[];
  total: number;
};

/**
 * Fetches scored duplicate candidates for one contact or lead from the
 * server-side dedupe endpoint (GET /api/dedupe/candidates).
 *
 * The server runs the same deterministic scoring algorithm as
 * src/server/dedupe.ts (email 100, local-part+lastname 55, name 45,
 * company+lastname 35) across BOTH contacts and leads in the caller
 * organization. This replaces the previous client-side approach that fetched
 * up to 100 rows per search term and scored them in the browser.
 *
 * The subject fields (firstName/lastName/email/companyName) are no longer
 * needed by the client — the server loads the subject org-scoped from
 * entityType + entityId — but the parameter is kept for source
 * compatibility with existing callers.
 */
export async function findDuplicateCandidatesClient(
  subject: DuplicateSubject
): Promise<DuplicateCandidate[]> {
  const params = new URLSearchParams({
    entityType: subject.type,
    entityId: subject.id,
  });
  try {
    const res = await api.get<CandidatesResponse>(
      `/api/dedupe/candidates?${params.toString()}`
    );
    return res.candidates ?? [];
  } catch {
    // A failed lookup just yields no candidates; callers degrade gracefully.
    return [];
  }
}
