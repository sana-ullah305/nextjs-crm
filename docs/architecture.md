# CRM Architecture

## Specialist Roles Applied

Development was coordinated using specialist personas from
[agency-agents](https://github.com/msitarzewski/agency-agents). The personas
provide instructions, not execution — all implementation was performed by the
coordinating agent applying each specialist's workflows:

| Role | Persona file | Applied to |
|------|--------------|------------|
| Project Manager | `project-management/project-manager-senior.md` | Phase breakdown, task checklist, scope control |
| Product Manager | `product/product-manager.md` | Module requirements, outcomes |
| UX Architect | `design/design-ux-architect.md` | Layout system, light/dark theme, responsive strategy |
| Frontend Developer | `engineering/engineering-frontend-developer.md` | Component architecture, accessibility |
| Backend Architect | `engineering/engineering-backend-architect.md` | API layer, validation, error handling |
| Database Architect | `engineering/engineering-database-optimizer.md` | Schema, indexes, query patterns |
| Identity/Access | `engineering/engineering-identity-access-engineer.md` | Sessions, RBAC |
| Security Architect | `security/security-architect.md` | Threat model (docs/security.md) |
| QA Engineer | `testing/testing-test-automation-engineer.md` | Test strategy: deterministic tests, own-their-data |
| DevOps | `engineering/engineering-devops-automator.md` | Deployment config |
| Technical Writer | `engineering/engineering-technical-writer.md` | README, API docs |

## Technology Stack

- **Framework**: Next.js 16 (App Router) — unified frontend + API routes.
- **Language**: TypeScript (strict).
- **UI**: Tailwind CSS v4 + shadcn/ui-style components built on Radix UI
  primitives. Icons: lucide-react. Charts: Recharts.
- **Database**: SQLite via Prisma ORM (see "Database Decision").
- **Auth**: Session-based authentication with HttpOnly, SameSite=Lax cookies;
  bcrypt password hashing.
- **Validation**: Zod schemas shared between API routes and client forms.
- **Testing**: Vitest + React Testing Library.

## Database Decision (documented trade-off)

The specification prefers PostgreSQL. The build environment has no
PostgreSQL server, no Docker, and no system-package install rights. Per the
execution rules ("if a dependency or service is unavailable, implement a
practical alternative and explain the limitation"):

- **Prisma + SQLite** is used so the application ships with a fully working
  database (real Prisma migrations, real SQL, no mocks).
- The schema avoids Postgres-only features (no enums — string fields with
  Zod-validated values instead, no arrays — normalized join tables instead).
- Switching to PostgreSQL in production requires only changing
  `DATABASE_URL` and regenerating the client. No application code changes.

## Modular Architecture

```
src/
  app/
    (auth)/            Login page (public)
    (app)/             Authenticated application shell: sidebar + topbar
      dashboard/       KPIs, charts, recent activity
      contacts/        Contact CRUD, detail, import/export
      companies/       Company CRUD + detail
      leads/           Lead capture, scoring, conversion, duplicate detection
      pipeline/        Kanban board with drag-and-drop deals
      tasks/           Task/activity management
      reports/         Reports & analytics with CSV export
      settings/        Organization, users, roles, tags, pipelines, sources
    api/               REST API routes (server actions are NOT used;
                       all mutations go through REST endpoints)
  components/          UI components (ui/ primitives + feature components)
  server/              Server-only modules (never imported by client code)
    auth.ts            Session management, password hashing, getCurrentUser
    rbac.ts            Role → permission mapping, permission checks
    rate-limit.ts      In-memory sliding-window rate limiter
    audit.ts           Audit log writer
    api.ts             Route handler wrapper: auth, validation, error envelope
  lib/                 Shared (client-safe) modules
    schemas/          Zod validation schemas
    api-client.ts      Typed fetch wrapper for the UI
    format.ts          Formatting helpers
prisma/
  schema.prisma        Database schema
  migrations/          Generated migrations
  seed.ts              Realistic seed data
```

### Key decisions

1. **REST API only.** The spec asks for a documented REST API. All CRUD
   mutations go through `/api/*` route handlers. Server components fetch
   directly via Prisma for initial renders; client interactions call REST.
2. **Server-only module boundary.** `src/server/*` uses Prisma and bcrypt
   and must never be imported into client components. Client code uses
   `src/lib/*`.
3. **Error envelope.** All API errors return a consistent JSON shape:
   `{ error: { code, message, details? } }`.
4. **Soft deletes.** Contacts, companies, leads, and deals use `deletedAt`
   timestamps so history is preserved and the UI shows "deleted" state
   rather than cascading data loss.
5. **Multitenancy.** All domain data is scoped by `organizationId`, ready
   for a multi-tenant SaaS deployment.

## Data Access Control

Every authenticated API route:
1. Resolves the session cookie → user (or 401).
2. Checks the required permission against the user's role (403).
3. Validates the request body with Zod (400 with field details).
4. Scopes Prisma queries by the user's `organizationId`.

## Rate Limiting

An in-memory sliding-window limiter is applied to the login endpoint
(10 attempts / 5 min / IP + username). In a multi-instance deployment this
should be backed by Redis (noted in docs/security.md).

## Notification System

In-app notifications are stored in the database and polled by the client
every 60 seconds. Email delivery is an architecture-level integration point:
`NotificationChannel` records are created per user/notification, and an
`EmailSettings` model with SMTP configuration exists; a background mailer
hook is documented as the extension point (no external SMTP credentials are
available in this environment).
