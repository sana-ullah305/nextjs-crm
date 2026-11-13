---
name: dedupe-merge
description: "Builds cross-entity duplicate detection and merge: candidate finder, merge preview, transactional FK re-pointing, audit, tests. Backend only."
user-invocable: true
---

# Cross-Entity Duplicate Detection & Merge — Engineering Contract

You are the Backend engineer for duplicate detection and merge. Workspace:
this repo (an isolated copy; another agent works in a separate copy on
follow-up sequences — ignore any coordination notes about them, you own
this workspace exclusively).

Stack: Next.js 16 App Router, TypeScript strict, Prisma 7 + SQLite (driver
adapter), Zod, session auth, RBAC, audit logging.

## Scope — build EXACTLY this

1. **Duplicate candidate finder** — `src/server/dedupe.ts`:
   - `findDuplicateCandidates(organizationId, entityType, id)` for a
     contact OR a lead: finds likely duplicates of that record across BOTH
     contacts and leads in the same org (excluding soft-deleted).
   - Scoring (deterministic, no ML): normalized email exact match → 100;
     same normalized email local-part + same last name → 55; same
     first+last name (normalized: lowercase, stripped whitespace, Robert→
     Bob/Rob/Alexander→Alex style common diminutives via a small hardcoded
     map, and trim punctuation) → 45; same company name + last name → 35.
     Compose additively but cap at 100. Threshold ≥35 to be a candidate.
   - Also `findDuplicateCandidatesByEmail(organizationId, email)` for the
     sequence-enrollment guard (for ANY caller): quick check if a
     contact OR lead with this email already exists (org-scoped).
   - Pure functions normalized in one place: `normalizeEmail`,
     `normalizeName` (export from `src/lib/dedupe-normalize.ts` so tests
     and the finder share them).
2. **Merge preview endpoint** —
   `src/app/api/merge/preview/route.ts`:
   - `GET /api/merge/preview?type=contact|lead&id=<id>&intoId=<id>` →
     field-level diff of the two records (name, email, phone, company,
     status, owner, createdAt) + counts of related rows that would move
     (activities, notes, tasks, deals, sentEmails, inboundEmails, leads
     for contact) + which record is recommended survivor (older createdAt,
     ties broken by more activities; CONTACT beats LEAD when merging a
     lead INTO a contact).
   - Not the result of auto-detection only — caller may pass intoId from a
     detection result OR discovered manually. Permission: `contacts:read`
     for both record types.
3. **Merge execution** — `src/app/api/merge/route.ts`:
   - `POST /api/merge` body: `{ type: "lead-into-contact" |
     "contact-into-contact" | "lead-into-lead", sourceId*, targetId*,
     fieldChoices?: { email?, firstName?, lastName?, phone?, title?,
     status? } }` — survivors chosen per-field when provided, else the
     target record's values win.
   - `lead-into-lead` and `contact-into-contact` only within same
     entity+org. `lead-into-contact` CONVERTS: the lead is marked
     CONVERTED (reuse the semantics of the existing convert route in
     src/app/api/leads/[[...id]]/route.ts read first), contactId set.
   - Transaction (`db.$transaction`): re-point every FK — activities,
     notes, tasks (relatedId when relatedType matches, or the task fields),
     deals (contactId/leadId as relevant), sentEmails, inboundEmails,
     and for lead→contact also leads' own contactId links. Set loser
     `deletedAt` (soft delete) + `summary` prefix "Merged into <target
     type> <targetId> on <date>". NEVER hard-delete.
   - On conflict between duplicate constraints (e.g. two sentEmail rows
     violate nothing — they move freely; only @@unique constraints to
     watch: none on the moved FKs — verify and document in code comment).
   - Side effects: audit `RECORD_MERGE` (metadata: sourceType/Id,
     targetType/Id, moved counts); notification to the survivor's owner
     "Records merged" linking to the survivor.
   - Permission: manager/admin only (`contacts:update_all`) — reps do NOT
     merge. 403 otherwise. All queries org-scoped; other org → 404.
4. **Merge guard for sequences (exported hook)** — from dedupe.ts export
   `assertNotAlreadyEnrolled(organizationId, email)` — throws
   `MergeGuardError` (define in same file) when a contact or lead with
   this email is enrolled in an ACTIVE sequence enrollment. The sequences
   agent's enrollment code calls this; you just own the export + its unit
   tests. Signature stable: `(organizationId: string, email: string) =>
   Promise<void>`.
5. **Tests** — `src/server/__tests__/dedupe-merge.test.ts` (pattern:
   src/server/__tests__/features.test.ts):
   - Normalization: diminitives (Robert/Rob/Bob), punctuation, emails
   - Candidate scoring: email dup, name dup, company+name, below-threshold
     negatives, converted leads excluded, soft-deleted excluded
   - Cross-org: candidates never leak across orgs
   - Preview: correct diff fields, relation counts, survivor recommend
   - Merge lead→contact: activities/notes/deals/tasks/sentEmails/
     inboundEmails re-pointed; loser soft-deleted + CONVERTED; contact
     keeps target field values; email field-choice override works; audit
     row written
   - Merge contact→contact and lead→lead happy paths
   - Rep permission → 403; cross-org ids → 404
   - Merge guard: enrolled email throws, non-enrolled passes

## Quality gates

`tsc --noEmit` clean; lint 0 errors + zero warnings in your files;
`npm test` all pass (existing 98 + yours); `npm run build` succeeds.
Do NOT touch: sequences files, mailer, inbound-mail, apikeys, capture,
or any frontend/`.tsx` file. Backend only.

## Definition of done

Nothing committed. Working tree dirty for the supervisor. Write your
report to /tmp/agent-logs/agent-a2-report.md (what you built, gate
results, notable decisions).
