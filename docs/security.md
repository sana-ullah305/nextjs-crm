# Security Requirements

Authored per the Security Architect persona (threat-model first,
defense-in-depth, every control mapped to a risk).

## Threat Model (abuse cases considered)

| Threat | Control |
|--------|---------|
| Credential stuffing / brute force | bcrypt (cost 12) hashes; login rate limiting (10 req / 5 min / IP+email); generic error messages |
| Session hijacking | 256-bit random tokens, hashed (SHA-256) at rest; HttpOnly + SameSite=Lax + Secure (prod) cookies; 7-day expiry; logout revokes server-side |
| CSRF | SameSite=Lax cookies + explicit JSON Content-Type requirement on mutations (form-encoded cross-site POSTs are rejected by the body parser) |
| XSS | React auto-escaping (no dangerouslySetInnerHTML); CSP header via next.config; HttpOnly cookies keep tokens out of JS |
| SQL injection | Prisma parameterized queries exclusively; no raw SQL with user input |
| IDOR / broken access control | Every route resolves the session, checks RBAC permission, and scopes all queries by organizationId; record-level ownership rules (reps see own data; managers/admins see all) |
| Mass assignment | Zod schemas strictly whitelist accepted fields on every endpoint |
| Enumeration | Uniform 401 messages for wrong email vs wrong password; duplicate detection is org-scoped and requires authentication |
| Audit gaps | audit_logs capture auth events and entity mutations with IP + actor |

## Controls Implemented

1. **Password storage**: bcryptjs, cost 12. Never logged, never returned by
   API (Prisma select excludes `passwordHash`).
2. **Session management**: DB-backed sessions; token = 32 bytes CSPRNG,
   stored as SHA-256 hash. Expired sessions purged on access and via seed
   reset. Sessions record IP + user agent for the account security page.
3. **RBAC**: three roles with a central permission matrix
   (`src/server/rbac.ts`):
   - ADMIN: everything incl. user management, settings, delete.
   - MANAGER: full CRM data access, reports, settings minus user
     management; can view all records.
   - SALES_REP: full CRUD on own records; read-only on others' within
     rules; no user management or destructive org settings.
4. **Validation**: every mutating endpoint validates with Zod; invalid
   payloads → 400 with per-field details. Query params validated too.
5. **Rate limiting**: sliding-window limiter on login
   (`src/server/rate-limit.ts`). In-memory (single-instance); swap to Redis
   for horizontal scale (noted limitation).
6. **Headers**: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
   `Referrer-Policy`, and a restrictive `Content-Security-Policy` set in
   `next.config.ts` (relaxed only for Next.js dev tools).
7. **Secrets**: `.env` for session secret + database URL; `.env.example`
   documents variables; `.env` is gitignored; seed passwords are dev-only
   and clearly labeled.
8. **Audit logging**: `audit_logs` rows for login, failed login, and all
   create/update/delete of core entities, with actor, IP, and metadata.
9. **Soft deletes**: destructive actions set `deletedAt`, preserving audit
   trails and preventing accidental cascading data loss.
10. **Data export hygiene**: CSV export escapes formula-injection prefixes
    (`=`, `+`, `-`, `@`) to prevent spreadsheet injection.

## Remaining Limitations (documented honestly)

- Rate limiting and session store are in-memory/DB-local; for multi-instance
  deployments back the limiter with Redis.
- Email sending is fully implemented (SMTP via nodemailer, per-send audit
  trail, failure recording) and configured through Settings > Email; the
  SMTP password is supplied via the `SMTP_PASS` environment variable and is
  never stored in the database or shown in the UI. Emails are sent as plain
  text only — user-authored HTML bodies would require sanitization that is
  deliberately not shipped.
- Reminder scans run when an authorized caller hits
  `POST /api/reminders/run` (cron/uptime-monitor driven); there is no
  in-process background worker, keeping single-instance deployments simple.
- CSP `unsafe-inline` style-src is required by Next.js styled-jsx in some
  flows; script-src remains locked down.
