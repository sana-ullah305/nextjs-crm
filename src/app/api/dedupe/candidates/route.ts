import { NextRequest } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseQuery } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { findDuplicateCandidates, type CandidateRecord } from "@/server/dedupe";

/**
 * GET /api/dedupe/candidates?entityType=lead|contact&entityId=<id>&limit=<n>
 *
 * Server-side duplicate-candidate lookup. Replaces the client-side
 * duplicate-search.ts approach (which fetched up to 100 rows per search term
 * and scored them in the browser) with a single org-scoped query that runs
 * the same deterministic scoring algorithm (src/server/dedupe.ts):
 *
 *   normalized email exact match .................. 100
 *   same normalized email local-part + last name ..  55
 *   same normalized first+last name ................  45
 *   same company name (normalized) + last name .....  35
 *
 * Candidates are scored across BOTH contacts and leads in the caller
 * organization; soft-deleted rows, converted leads, and leads already linked
 * to a contact are excluded. Results are sorted by score (desc) then age.
 *
 * RBAC: dedupe:read - granted to every authenticated role (admin, manager,
 * sales rep). The subject record is loaded org-scoped, so an id from another
 * organization looks like 404 and never leaks existence.
 */

const candidatesQuerySchema = z.object({
  entityType: z.enum(["lead", "contact"]),
  entityId: z.string().trim().min(1),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export type CandidatesResponse = {
  candidates: CandidateRecord[];
  total: number;
};

export const GET = apiHandler(async (req: NextRequest) => {
  const user = await requireApiUserWith("dedupe:read");
  const params = parseQuery(req, candidatesQuerySchema);
  const all = await findDuplicateCandidates(
    user.organizationId,
    params.entityType,
    params.entityId
  );
  const limit = params.limit ?? all.length;
  const candidates = all.slice(0, limit);
  return ok<CandidatesResponse>({ candidates, total: all.length });
});
