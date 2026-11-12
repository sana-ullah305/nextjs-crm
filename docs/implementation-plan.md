# Implementation Plan

Phased roadmap (per Project Manager persona: functional first, polish
second, no gold-plating). Status legend: [x] done, [ ] pending.

## Phase 1: Repository inspection and architecture — [x]
- [x] Inspect ~/projects directory (existing repos unrelated to CRM; new
      project created at ~/projects/crm)
- [x] Clone agency-agents, read specialist definitions
- [x] Environment audit (Node 22 available; no Postgres/Docker → SQLite via
      Prisma, Postgres-compatible schema)
- [x] docs/architecture.md, docs/database-schema.md, docs/security.md

## Phase 2: Project setup and database design — [x]
- [x] Next.js 16 + TypeScript + Tailwind v4 scaffold
- [x] Dependencies: Prisma, Zod, Recharts, Radix primitives, bcryptjs,
      next-themes, lucide-react, Vitest
- [x] Prisma schema (17 models), migrations, seed with realistic data
- [x] Error envelope + API wrapper middleware

## Phase 3: Authentication and user management — [x]
- [x] Session auth: login/logout, bcrypt hashing, HttpOnly cookie,
      256-bit hashed session tokens, 7-day expiry
- [x] Rate limiting on login
- [x] RBAC: ADMIN / MANAGER / SALES_REP + permission matrix
- [x] User management UI (admin), audit logging
- [x] Middleware route protection

## Phase 4: Dashboard and application layout — [x]
- [x] App shell: sidebar, topbar, command search, theme toggle
- [x] Dashboard: KPI cards (customers, new leads, active deals, conversion
      rate, revenue), revenue trend chart, pipeline chart, recent activity,
      upcoming tasks, top performers

## Phase 5: Contacts, companies and leads — [x]
- [x] Contacts: table with search/filter, create/edit/delete, detail page
      with activity timeline, notes, tasks; CSV import/export; tags
- [x] Companies: CRUD + detail with associated contacts, activity
- [x] Leads: capture, scoring, assignment, follow-up scheduling,
      duplicate detection (email match), conversion to contact+deal
- [x] Ownership-based access control on all records

## Phase 6: Sales pipeline and deals — [x]
- [x] Kanban board per pipeline, drag-and-drop stage moves
- [x] Deal CRUD, win/loss tracking with reasons, forecast view

## Phase 7: Tasks and activities — [x]
- [x] Task board (grouped by status/due), CRUD, complete/skip
- [x] Activity logging (calls, meetings, notes, system events) across
      contact/company/deal/lead detail pages

## Phase 8: Reports and analytics — [x]
- [x] Sales report, lead conversion funnel, revenue report, team
      performance, acquisition by source — all with CSV export

## Phase 9: Settings and integrations — [x]
- [x] Organization settings, user management (roles), custom fields,
      pipeline configuration, lead sources, tags, email templates,
      notification settings

## Phase 10: Testing, security review, optimization — [x]
- [x] Unit tests: auth (hashing, sessions, RBAC), validation schemas,
      lead scoring, duplicate detection, forecast math, rate limiter
- [x] API integration tests against real SQLite test DB: CRUD for
      contacts/companies/leads/deals/tasks, permission enforcement (403),
      unauthorized (401), validation (400)
- [x] Build passes; lint passes

## Phase 11: Documentation and deployment — [x]
- [x] README.md (installation, env, scripts)
- [x] .env.example
- [x] API documentation (docs/api.md)
- [x] Deployment instructions (README + Docker-less notes; Postgres swap
      documented)

## Verification commands

```bash
npm run db:seed        # reset + seed database
npm run test           # vitest suite
npm run build          # production build
npm run lint           # eslint
```
