---
name: lead-capture-api
description: "Builds the public lead capture API: API keys, /api/leads/capture endpoint, scoring/dedupe/assignment pipeline reuse, rate limiting, and tests. Use when working on lead capture, API keys, or public form ingestion."
user-invocable: true
---

# Lead Capture API — Engineering Contract

You are the Backend engineer for the lead capture feature. Your workspace is
the CRM repo at ~/projects/crm (Next.js 16 App Router, TypeScript strict,
Prisma 7 + SQLite via driver adapter, Zod, session auth, RBAC).

## Scope — build EXACTLY this, nothing more

1. **ApiKey model** (prisma/schema.prisma): fields `id`, `organizationId`,
   `name`, `keyHash` (unique, SHA-256 of full key), `prefix` (first 8 chars,
   for display + lookup), `createdById`, `lastUsedAt`, `isActive` (default
   true), `revokedAt`, `createdAt`. Relation to Organization + User.
   Generate a real migration with `npm run db:migrate -- --name add_api_keys`
   then `npx prisma generate` (migrations dir uses timestamped names).
2. **Key generation + hashing** (`src/server/apikeys.ts`): key format
   `lc_<32 hex chars>`. Hash with SHA-256 (match `hashToken` pattern in
   src/server/auth.ts). Lookup is by prefix first, then constant-time
   compare of the hash (use `safeEqual` from src/server/auth.ts).
3. **Extract the capture pipeline** so BOTH the existing
   `POST /api/leads` route AND the new public endpoint share it: look at
   src/lib/lead-score.ts and the duplicate detection + assignment logic in
   src/app/api/leads/[[...id]]/route.ts. Do NOT duplicate scoring code —
   reuse the existing functions. The public capture route must apply:
   scoring, org-scoped duplicate email detection, and round-robin/simple
   assignment using org users with the SALES_REP role (reuse the same
   assignment logic the internal route uses; if none exists, assign to the
   key's creating admin).
4. **Public endpoint** `src/app/api/leads/capture/route.ts`:
   - Auth: `Authorization: Bearer lc_...` header OR `?apikey=` query param.
   - Rate limit: sliding window 30 req / 5 min / key using the limiter
     pattern in src/server/rate-limit.ts (create an instance keyed by key
     id, NOT the login limiter's IP+email buckets).
   - Zod-validate the body against a PUBLIC_FLAT schema:
     `firstName*`, `lastName*`, `email*`, `phone`, `companyName`,
     `source` (free text tag, max 60, optional). Reuse leadCreateSchema
     semantics where sensible; this schema must NOT accept owner/assignment
     or any internal fields (mass-assignment guard — store only the
     allow-listed fields).
   - Respond 201 with `{ data: { id, score, status } }` — NO org internals.
   - Never wrap with the normal `apiHandler` (that requires a session
     user). Write the route with its own auth + error envelope handling
     that matches the `{ error: { code, message } }` shape. 401 for bad
     key, 403 for revoked/inactive key, 429 with Retry-After for rate limit,
     400 for validation, 409 for duplicate email (`DUPLICATE_LEAD` with the
     existing lead's id — do not leak anything else).
   - Log every capture with `writeAudit` (action `LEAD_CAPTURE`, entity
     lead id, metadata: keyPrefix, source) and update `lastUsedAt`.
5. **Key management API** (admin only): extend
   src/app/api/settings/[[...section]]/route.ts with section `api-keys`:
   GET (list with prefix/name/lastUsedAt/isActive — NEVER the hash), POST
   (create: body `{ name* }` → returns the FULL KEY exactly once in the
   response, admin-only, settings:manage permission + audit
   `API_KEY_CREATE`), DELETE `api-keys/:id` (soft revoke: set isActive
   false + revokedAt, audit `API_KEY_REVOKE`). Permission:
   `settings:manage` on all three.
6. **Tests** (src/server/__tests__/lead-capture.test.ts): follow the
   EXACT pattern in src/server/__tests__/features.test.ts (cookie store
   mock for next/headers, direct route handler invocation, beforeAll seed,
   isolated test DB — vitest.setup.ts handles DB creation). Cover:
   - Happy path: valid key → 201, lead created with score > 0, activity
     logged, audit row exists
   - Unknown/expired/revoked key → 401/403
   - Rate limit → 429 after 31 rapid calls (manipulate the limiter or use
     a tiny window override documented in the test)
   - Duplicate email → 409 DUPLICATE_LEAD
   - Missing fields → 400
   - Cross-org isolation: org B's key cannot see org A behavior (seed two
     orgs, assert leaks impossible)
   - Internal admin route POST /api/leads still works unchanged
     (regression check)

## Quality gates (must pass before you finish)

- `npx tsc --noEmit` clean
- `npm run lint` — 0 NEW errors (pre-existing warnings elsewhere are fine;
  your files must be warning-free)
- `npm test` — ALL pass including your new tests AND the existing 66/67
- `npm run build` succeeds
- Do NOT touch: mailer/email code, reminders code, search code, or any
  frontend files. Backend only.

## Conventions to follow (read these files first)

- prisma/schema.prisma — model + relation style, comments about
  Postgres-compat
- src/server/auth.ts — hashToken/safeEqual patterns
- src/server/rate-limit.ts — limiter design
- src/server/rbac.ts — permission matrix (add nothing; reuse
  settings:manage)
- src/app/api/settings/[[...section]]/route.ts — settings route style
- src/server/__tests__/features.test.ts — test pattern to copy
- Comments end in periods, log messages start with capitals, gofumpt-style
  not applicable (TypeScript project) — match existing file style exactly.

## Definition of done

Commit nothing. Leave the working tree dirty; the QA agent + supervisor
verify, then the supervisor commits.
