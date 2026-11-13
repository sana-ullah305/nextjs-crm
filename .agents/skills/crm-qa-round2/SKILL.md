---
name: crm-qa-round2
description: "Adversarial QA for the sequences + dedupe/merge + UI round. Verifies security, races, compliance, migrations, docs, gates."
user-invocable: true
---

# QA Round 2 — Verification Contract

You are the independent QA engineer. This workspace has the MERGED result
of: (1) duplicate detection & merge backend, (2) follow-up sequences
backend (incl. reply auto-stop + public unsubscribe), (3) frontend UI
(sequences tab, API-keys tab, merge dialog, enroll actions, unread
replies triage). Verify adversarially; mechanical fixes only (typos,
escaped apostrophes); substantive issues → report.

## Checklist

1. **Migrations & schema**: new migrations apply on a fresh DB
   (vitest bootstrap proves it); `npx prisma validate` +
   `prisma migrate diff --from-migrations ./prisma/migrations
   --to-schema ./prisma/schema.prisma` → no drift; no deleted migrations;
   unique constraints documented in code where load-bearing.
2. **Merge security**: merge is manager/admin-only (403 reps) with
   org-scoping (404 cross-org); loser records soft-deleted never hard-
   deleted; EVERY related row type actually re-pointed (verify each FK
   by test results + code read: activities, notes, tasks, deals,
   sentEmails, inboundEmails, contact links); audit RECORD_MERGE exists;
   no data duplication (counts before/after).
3. **Sequence safety** (the money section — try hard to break this):
   - **Double-send race**: two concurrent scans cannot send the same
     step twice (optimistic-lock claim verified — try invoking the scan
     twice on an adjacent clock boundary).
   - **Reply auto-stop**: inbound reply on a sender with an ACTIVE
     enrollment stops it — and DOESN'T touch other people's enrollments,
     other orgs, or UNSUBSCRIBED rows.
   - **Unsubscribe compliance chain**: token 404 on unknown; valid token
     flips to UNSUBSCRIBED and the suppression check then blocks re-
     enrollment (409); the unsubscribe footer URL uses APP_URL or
     localhost default; List-Unsubscribe header present on sequence
     sends; public routes bypass cookie middleware properly.
   - **Mass-assignment**: enroll/sequence routes accept only the
     documented fields; `steps` arrays validated ≤15, positions unique.
   - **No secrets**: unsubTokens/API keys/hashes never in any list
     response; no credential logging.
   - **Guard interplay**: assertNotAlreadyEnrolled prevents the same
     human (email) being enrolled in two ACTIVE sequences via different
     records (contact vs lead); after COMPLETED, re-enrollment is
     allowed (or cleanly 409 — verify whichever code says and that the
     docs match).
4. **UI correctness**: read the REAL backend route signatures and
   verify the frontend consumes exactly those (agent C documented them
   in its report — spot-check 3 of them in code). RBAC in UI matches
   backend (reps don't see admin tabs' write actions).
5. **Existing behavior**: 98 pre-round tests still pass (audit which
   files); internal POST /api/leads still 201/401.
6. **Gates**: tsc, lint (0 new), full npm test, npm run build.
7. **Docs**: README features + test counts; docs/api.md sequences +
   merge + unsubscribe sections incl. permissions +
   ALREADY_ENROLLED/UNSUBSCRIBED semantics; docs/security.md gains rows
   for sequences compliance + merge permission model; .env.example has
   APP_URL. Note gaps — do not write them yourself.

## Output

/tmp/qa2-report.md: PASS/FAIL per item with file:line evidence, verdict
SHIP or FIX-FIRST + numbered fixes. Probe tests allowed under
src/server/__tests__/qa2-*.test.ts — keep (skipped w/ comment) if they
document a bug, delete if they pass. No commits; no substantive edits.
