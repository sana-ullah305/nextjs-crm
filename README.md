# Acme CRM

A complete, production-ready Customer Relationship Management application.
Modern SaaS-style UI, REST API, session authentication, role-based access
control, and a fully working database — no mocks.

Built with Next.js 16 (App Router), TypeScript, Tailwind CSS v4, Prisma,
Zod, Recharts, and Radix UI primitives.

## Features

- **Dashboard** — KPIs (customers, new leads, active deals, conversion rate,
  revenue, weighted pipeline), revenue trend chart, lead funnel, recent
  activity timeline, upcoming tasks, top performers.
- **Contacts** — CRUD, search/filter, tags, company association, owner
  assignment, CSV import (duplicate-safe) and CSV export (formula-injection
  safe), detail page with activity timeline, notes, tasks, and deals.
- **Companies** — CRUD, search, account ownership, associated contacts,
  activity history.
- **Leads** — capture with automatic scoring (reachability, value, source,
  engagement), duplicate detection, assignment, follow-up scheduling,
  one-click conversion to contact + deal.
- **Sales Pipeline** — multiple pipelines, drag-and-drop Kanban across
  stages, stage probabilities, weighted forecasting, win/loss tracking with
  reasons.
- **Tasks** — calls, meetings, follow-ups, to-dos; priorities, due dates,
  overdue tracking, complete/skip, assignment notifications.
- **Reports** — revenue by month, win rates, lead conversion funnel,
  acquisition by source, team performance; CSV export.
- **Email Outreach** — send email from any contact or lead through the
  org's SMTP settings (Settings > Email); template merge with `{{tokens}}`,
  delivery status tracking (queued/sent/failed), every send logged on the
  record's activity timeline and in the audit log.
- **Automated Follow-up Reminders** — a scheduler scan turns due lead
  follow-ups and overdue tasks into in-app notifications for the
  responsible rep. Deduplicated per day; trigger via
  `POST /api/reminders/run` from cron or an uptime monitor.
- **Lead Capture API** — public, API-key-authenticated ingestion at
  `POST /api/leads/capture` for websites and forms: keys hashed at rest,
  per-key rate limiting, strict allow-listed fields, reuse of the same
  scoring / duplicate-detection / assignment pipeline as the internal
  route.
- **Global Search / Command Palette** — `⌘K` (or Ctrl+K) from the topbar
  searches contacts, companies, leads, deals, and tasks at once, with
  keyboard navigation and RBAC-scoped results.
- **Inbound Email Tracking** — an IMAP scan (`POST /api/inbound/run`,
  cron-driven) matches inbox replies to CRM threads via Message-ID,
  auto-logs them on the matched contact/lead, notifies the owner, and
  flips NEW leads to CONTACTED — no rep action needed.
- **Users & Roles** — Admin / Manager / Sales Rep with a central permission
  matrix; admin-only user management; last-admin protection; audit log.
- **Settings** — organization profile, pipelines, lead sources, tags, email
  templates, custom field definitions, notification preferences.
- **Security** — bcrypt password hashing (cost 12), HttpOnly session
  cookies with hashed tokens, login rate limiting, Zod validation on every
  endpoint, org-scoped queries, record-level ownership rules, audit trail,
  security headers. See `docs/security.md`.

## Quick Start

Requirements: Node.js 22+, npm.

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env

# 3. Create the database and apply migrations
npm run db:migrate

# 4. Seed realistic demo data (5 users, 8 companies, 30+ contacts,
#    25 leads, 35+ deals, tasks, activities, templates, audit entries)
npm run db:seed

# 5. Run
npm run dev        # development (http://localhost:3000)
# or
npm run build && npm run start   # production
```

### Demo accounts (password: `password123`)

| Email | Role |
|-------|------|
| `admin@acme.test` | Administrator |
| `manager@acme.test` | Manager |
| `jamie@acme.test` | Sales Representative |
| `riley@acme.test` | Sales Representative |
| `casey@acme.test` | Sales Representative |

**These credentials are for development/demo only.** Change all passwords
before any real deployment.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run db:migrate` | Create/apply database migrations |
| `npm run db:seed` | Reset + seed demo data (destructive) |
| `npm run db:generate` | Regenerate Prisma client |
| `npm test` | Run test suite (98 tests) |
| `npm run test:coverage` | Tests with coverage report |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript strict check |

## Database

SQLite via Prisma (driver adapters) so the app runs anywhere with zero
external services. The schema avoids Postgres-specific features, so
switching to PostgreSQL in production is a one-line change:

```env
DATABASE_URL="postgresql://user:pass@host:5432/crm"
```

…then set the `sqlite` → `postgresql` provider in `prisma/schema.prisma`,
swap the Prisma adapter in `src/server/db.ts` (e.g.
`@prisma/adapter-pg`), and run `prisma migrate dev`. No application code
changes. Schema documentation: `docs/database-schema.md`.

## Testing

98 automated tests across 10 files, all run against a real (isolated)
database — no mocked data layer:

- **Unit** — lead scoring model, Zod validation schemas, RBAC permission
  matrix, record-level access rules, password hashing, rate limiter
  (sliding window), email template merge renderer.
- **Integration** — login flow (valid/invalid/rate-limited), contact CRUD
  lifecycle with soft-delete verification, lead creation with scoring +
  duplicate detection, task creation/completion, permission enforcement
  (401/403/404/400 envelopes), dashboard and reports endpoints, email
  send + failure recording + RBAC checks, reminder scheduler dedupe,
  global search scoping.

```bash
npm test
```

## Project Structure

```
docs/                    Architecture, schema, plan, security docs
prisma/
  schema.prisma          17-model database schema
  migrations/            SQL migrations
  seed.ts                Realistic seed data
src/
  app/(app)/             Authenticated app shell (dashboard, contacts,
                         companies, leads, pipeline, tasks, reports,
                         settings)
  app/api/               REST API routes
  components/            UI primitives + feature components
  lib/                   Client-safe shared code (schemas, api client,
                         formatting, lead scoring)
  server/                Server-only modules (db, auth, rbac, rate limit,
                         audit, api wrapper)
  proxy.ts               Cookie-presence route protection
```

Full architecture notes: `docs/architecture.md`.
API reference: `docs/api.md`.

## Deployment

### Any Node host (recommended for this setup)

```bash
npm ci
npm run build
DATABASE_URL="file:./data/crm.db" npm run db:migrate
npm run start   # set PORT if needed
```

Run behind a TLS-terminating reverse proxy (Caddy, nginx). Cookies are
`Secure`-flagged automatically in production.

### PostgreSQL production

1. Provision PostgreSQL and set `DATABASE_URL` to the Postgres URL.
2. Change the provider in `prisma/schema.prisma` to `postgresql`.
3. Swap the adapter in `src/server/db.ts` to `@prisma/adapter-pg`.
4. `npm run db:migrate && npm run start`.

### Scaling notes

- The login rate limiter is in-memory (single instance). For horizontal
  scaling, back it with Redis — `src/server/rate-limit.ts` is the single
  integration point.
- Email sending goes through the org's SMTP settings (`EmailSettings`).
  The SMTP password comes from the `SMTP_PASS` environment variable and is
  never stored in the database. When SMTP is not configured, sends fail
  fast with `EMAIL_NOT_CONFIGURED` and the attempt is still recorded.
- Reminder scans run when `POST /api/reminders/run` is called (requires
  MANAGER/ADMIN). Point a cron job at it every 15 minutes, or use an uptime
  monitor's webhook with a service account session.
- Global search hits indexed columns (`email`, `name`) per entity; the
  SQLite `contains` filter is case-insensitive. For large Postgres
  deployments consider trigram indexes per entity.

## Documentation

- [Architecture](docs/architecture.md)
- [Database schema](docs/database-schema.md)
- [Implementation plan](docs/implementation-plan.md)
- [Security](docs/security.md)
- [API reference](docs/api.md)
