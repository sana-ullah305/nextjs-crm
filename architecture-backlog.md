# Phase 2 – Architecture & Implementation Backlog

**Source**: Consolidated from three discovery audits (arch/backend/db, frontend/ux, qa/security/devops)

---

## 1. Architecture Decisions

### Module Boundaries
| Module | Location | Responsibility |
|--------|----------|----------------|
| `auth` | `src/server/auth.ts`, `src/app/api/auth/*` | Sessions, bcrypt, login/logout, rate limiting |
| `rbac` | `src/server/rbac.ts` | Permission matrix, record-level access (`canAccessRecord`), role enforcement |
| `contacts` | `src/app/api/contacts/*`, `src/lib/lead-pipeline.ts` (shared) | CRUD, CSV import/export, duplicate detection |
| `companies` | `src/app/api/companies/*` | CRUD (currently missing ownership scoping) |
| `leads` | `src/app/api/leads/*`, `src/lib/lead-score.ts` | CRUD, scoring, capture API, conversion |
| `deals` (opportunities) | `src/app/api/deals/*` | Pipeline, Kanban, stage transitions, won/lost |
| `tasks` | `src/app/api/tasks/*` | Activity scheduling, completion, reminders |
| `activities` | `src/app/api/activities/*` | Timeline logging (calls, meetings, emails, notes) |
| `sequences` | `src/server/sequences.ts`, `src/app/api/sequences/*` | Automated outreach, enrollment, scheduler |
| `email` | `src/server/mailer.ts`, `src/app/api/emails/*` | SMTP send, templates, SentEmail audit |
| `inbound` | `src/server/inbound-mail.ts`, `src/app/api/inbound/*` | IMAP scan, thread matching, auto-log |
| `reminders` | `src/server/reminders.ts`, `src/app/api/reminders/*` | Follow-up scan, notifications |
| `notifications` | `src/app/api/notifications/*` | In-app notification center |
| `search` | `src/app/api/search/*` | Global Cmd+K search (correct RBAC nesting) |
| `reports` | `src/app/api/reports/*` | Revenue, funnel, team performance, CSV export |
| `settings` | `src/app/api/settings/*` | Org profile, pipelines, tags, sources, templates, custom fields, API keys, users |
| `merge` | `src/app/api/merge/*` | Cross-entity deduplication (transactional) |
| `audit` | `src/server/audit.ts` | Append-only audit log (failures swallowed) |

### Shared Services (extract from inline route logic)
1. **RecordScopeService** – centralize `canAccessRecord` + org scoping for all entities
2. **TransactionHelper** – wrap multi-write flows (lead conversion, sequence create, import)
3. **DuplicateEngine** – single source of truth for scoring (merge server + client logic)
4. **SchedulerAuth** – replace session-cookie cron with service-token auth
5. **EmailProvider** – per-org encrypted SMTP credentials (replace global `SMTP_PASS`)

### API Contract Standards
- All routes: `apiHandler` wrapper → `{data}` / `{error:{code,message,details}}`
- Pagination: `page`, `pageSize` (max 100/200), return `{items,total,page,pageSize}`
- Filtering: explicit allow-listed fields, no raw `where` spread
- Sorting: explicit enum allow-list per entity
- Zod validation on body + query params

### Database Schema Finalization (Prisma)
| Model | Action |
|-------|--------|
| `StageHistory` | **ADD** – capture every stage change (dealId, fromStage, toStage, userId, at, wonAt/lostAt snapshot) |
| `LostReason` | **ADD** – taxonomy table; `Deal.lostReasonId` FK (replace free-text) |
| `Team` + `TeamMember` | **ADD** – sales teams, team-scoped visibility |
| `Product` / `PriceList` / `DealLineItem` | **ADD** – for quotations/orders |
| `Quotation` / `SalesOrder` | **ADD** – linked to Deal, line items, PDF generation |
| `Attachment` | **ADD** – polymorphic (note/activity/deal/email), S3/local storage |
| `CustomFieldValue` | **WIRE UP** – read/write in entity CRUD, SELECT options editor |
| `Note` | **ADD API** – read/update endpoints (model exists) |
| `SequenceEnrollment` | **FIX** – partial unique index or archive-old-row on re-enroll |
| `Deal.stage` / `Deal.pipeline` | **MIGRATE** – `onDelete: Restrict` + reassignment flow before stage CRUD |

---

## 2. Prioritized Backlog (with S/M/L effort, dependencies)

### P0 – Critical (Security / Compliance / Data Integrity)
| ID | Task | Effort | Depends On | Acceptance |
|----|------|--------|------------|------------|
| B-01 | Fix broken unsubscribe link (`/unsubscribe` page or change URL to `/api/unsubscribe`) | S | – | Opt-out works in sequence emails |
| B-02 | Fix RBAC filter-override in contacts & leads list (wrap `q` OR in `AND`) | S | – | Reps cannot see org-wide records via `?q=` |
| B-03 | Add record-level read scoping to: getLead, getDeal, deals list, companies ALL, merge/preview | S–M | B-02 | 403 for unauthorized record access |
| B-04 | Wrap lead conversion, sequence create+steps, contact import in `db.$transaction` | S | – | Partial failure → full rollback |
| B-05 | Revoke all sessions on password change; purge expired sessions; Secure flag from config | M | – | Demoted admin loses access immediately |
| B-06 | Add CSP + HSTS headers; fix `docs/security.md` drift | S | – | Security headers present |
| B-07 | Validate owner/assignee reassignment (active same-org user; `*_all` holders only) | M | B-03 | Unauthorized reassignment → 403 |

### P1 – Core CRM Completion
| ID | Task | Effort | Depends On | Acceptance |
|----|------|--------|------------|------------|
| B-08 | Add `StageHistory` model + migration; record on every stage change; stop erasing `wonAt/lostAt` on reopen; require structured `lostReasonId` | M | – | Full stage audit trail queryable |
| B-09 | Stage & pipeline management API: add/rename/reorder/delete stages, probability edit; change cascade to Restrict | M | B-08 | Stage CRUD works, deals protected |
| B-10 | Notes read/update API + timeline integration on detail pages | S–M | – | Notes editable in contact/lead/deal detail |
| B-11 | Fix SequenceEnrollment re-enrollment (partial unique or archive old row) | S | – | Re-enroll after COMPLETED works |
| B-12 | Real scheduler: service-token auth + retry/backoff for sequence send failures | M | B-05 | Cron no longer needs manager session |
| B-13 | Per-org SMTP credentials (encrypted at rest) + test-send endpoint | M | – | Each org manages own SMTP |
| B-14 | Wire `CustomFieldValue` read/write into entity CRUD + forms + SELECT options editor | M | – | Custom fields visible on records |

### P2 – Major Features
| ID | Task | Effort | Depends On | Acceptance |
|----|------|--------|------------|------------|
| F-01 | Attachments: model + upload/storage + link to notes/activities/deals | L | – | Files attach to records |
| F-02 | Products & price lists → deal line items | M | – | Deal value from line items |
| F-03 | Quotations (PDF) & Sales Orders | L | F-02 | Generate PDF from deal |
| F-04 | Sales teams model + team-scoped visibility + team reports | M | B-03 | Team assignment & reporting |
| F-05 | Campaigns model (link leads/deals/sources) | M–L | – | Campaign ROI tracking |
| F-06 | Custom roles/permissions tables (replace hardcoded map) | M | – | Admin UI for roles |
| F-07 | Lead/Deal detail pages (`/leads/[id]`, `/deals/[id]`) + notification deep-links | M | – | Full detail views |
| F-08 | Company merge, merge tags, trash/restore UI for soft-deleted rows | M | – | Admin cleanup tools |

### P3 – Polish / Scale
| ID | Task | Effort | Depends On |
|----|------|--------|------------|
| P-01 | First-class Meetings/Calls (attendees, outcome, recording, calendar) | L | – |
| P-02 | Import/export for leads/companies/deals; bulk actions; consistent pagination | M | – |
| P-03 | Notification preferences, email-channel reminders, mark-one-read, paging | S–M | B-13 |
| P-04 | Server-side duplicate-candidates endpoint (retire client-side duplicate-search.ts) | S–M | – |
| P-05 | PostgreSQL migration path (replace raw SQL, Float→Decimal, Redis rate limiter) | L | – |

---

## 3. Frontend Backlog (from UX audit)

| ID | Task | Effort | Depends On |
|----|------|--------|------------|
| FE-01 | Deal detail view + won/lost flow + lost-reason capture | M | B-08 |
| FE-02 | Fix dead links: `/settings/organization`, `?deal=`, `?q=` deep links | S | – |
| FE-03 | Deal edit/delete + contact/company/owner assignment on deal form | M | B-03 |
| FE-04 | Custom-field values on forms/details + SELECT options editor | M | B-14 |
| FE-05 | Lead detail/edit page | M | – |
| FE-06 | Company detail actions (edit, notes, log activity, deals list) | M | B-10 |
| FE-07 | Inbox message reader + pagination + bulk mark-read | S–M | – |
| FE-08 | Toast/notification system (replace banners + `window.confirm`) | M | – |
| FE-09 | Opportunity stage-history timeline (uses StageHistory) | S | B-08 |
| FE-10 | Email template create/edit UI | S | – |
| FE-11 | Kanban: touch support + keyboard alternative for stage change | M | – |
| FE-12 | Replace 5 hand-rolled modals with Radix Dialog (focus trap, Escape, labels) | S | – |
| FE-13 | Shared confirm dialog (AlertDialog) for all destructive actions | S | – |
| FE-14 | Dashboard date-range & team/owner filters; reports lost-reason breakdown | M | B-08 |
| FE-15 | Notification center page (full history) | S | – |
| FE-16 | Mobile drawer: add Inbox, respect roles, focus management | S | – |
| FE-17 | Route-level loading/error/404 boundaries | M | – |

---

## 4. QA / DevOps Backlog

| ID | Task | Effort |
|----|------|--------|
| QA-01 | Switch vitest server tests to `environment: 'node'` (no jsdom), `isolate: false`, `pool: 'vmThreads'` | S |
| QA-02 | Raise testTimeout for bcrypt loop test; lower bcrypt cost in test env | S |
| QA-03 | Add component tests (React Testing Library) for merge-dialog, command-palette, entity-form | M |
| QA-04 | Add route tests for uncovered: users, settings sections, companies, activities, deals, auth/me/logout | M |
| QA-05 | CI on `develop` branch; replace `prisma migrate dev` → `migrate deploy` | S |
| QA-06 | Add `.env.example` (DATABASE_URL, APP_URL, SMTP_PASS, IMAP_*) | S |
| QA-07 | Dockerfile + docker-compose + SQLite backup procedure (litestream or cron `.backup`) | M |
| QA-08 | Lint cleanup: `argsIgnorePattern: "^_"` for 32 unused-var warnings | S |

---

## 5. Execution Order (Suggested)

1. **P0 security/compliance** (B-01 through B-07) – can run in parallel on separate branches
2. **P1 core CRM** (B-08 through B-14) – sequential where deps exist
3. **Frontend P0/P1** (FE-01 through FE-10) – pair with backend tasks
4. **P2 major features** (F-01 through F-08) – after core stable
5. **P3 + FE-11 through FE-17 + QA** – polish & scale

---

## 6. Branch Strategy

| Workstream | Branch | Base |
|------------|--------|------|
| Security hardening | `feature/security-hardening` | `develop` |
| Record scoping fix | `feature/record-scoping` | `develop` |
| Transactions | `feature/transactional-flows` | `develop` |
| Stage history + pipeline mgmt | `feature/stage-history` | `develop` |
| Scheduler auth | `feature/scheduler-auth` | `develop` |
| Per-org SMTP | `feature/per-org-smtp` | `develop` |
| Custom fields wiring | `feature/custom-fields` | `develop` |
| Deal detail UI | `feature/deal-detail-ui` | `develop` |
| Lead/Company detail UI | `feature/entity-detail-ui` | `develop` |
| Toast/confirm system | `feature/toast-system` | `develop` |
| Kanban accessibility | `feature/kanban-a11y` | `develop` |
| Test infra + CI | `feature/test-infra` | `develop` |
| Docker/backup | `feature/docker-backup` | `develop` |

Each branch → PR → review → merge to `develop` → CI gate → deploy preview.

---

## 7. Definition of Done per Task

- [ ] Code implements spec
- [ ] Unit/integration tests added (where applicable)
- [ ] Manual verification against acceptance criteria
- [ ] No console errors, no broken routes
- [ ] Migration runs cleanly (if schema change)
- [ ] Docs updated (if API change)
- [ ] PR approved, CI green, merged to `develop`

---

*Generated from audit reports. Update as tasks are clarified or split.*