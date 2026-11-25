# CRM Completion Program — Supervisor Task Board

Program: Odoo-inspired CRM completion per multi-agent-crm-development-orchestration.md
Repo: ~/projects/nextjs-crm (container ubuntu) | GitHub: sana-ullah305/nextjs-crm
Branches: main (production) ← develop (integration) ← feature/* (agent workstreams)
Supervisor: Crush (orchestrator). Implementation delegated to specialized subagents.

## Agent Roster

| Agent | Role | Skill basis | Status |
|-------|------|-------------|--------|
| geraldo-audit-arch-backend-db | Architect + Backend + DB audit | software-architect / backend-architect / database-optimizer | Phase 1 running |
| kieran-audit-frontend-ux | Frontend + UX audit | frontend-developer / ui-designer | Phase 1 running |
| athena-audit-qa-security-devops | QA + Security + DevOps audit | senior-secops-engineer / devops-automator / api-tester | Phase 1 running |

## Phase Status

| Phase | Status |
|-------|--------|
| 1 Discovery | COMPLETE |
| 2 Architecture & backlog | COMPLETE |
| 3 Core CRM completion | IN PROGRESS (10 implementation agents launched) |
| 4 Advanced features | PENDING |
| 5 Integration | PENDING |
| 6 QA & optimization | PENDING |
| 7 Final delivery | PENDING |

## Task Board

| ID | Description | Agent | Deps | Priority | Status | Branch | Acceptance criteria | Tests |
|----|-------------|-------|------|----------|--------|--------|---------------------|-------|
| T1 | Architecture/backend/DB audit | geraldo | — | P0 | COMPLETE (audits/arch-backend-db-audit.md) | — | Full API inventory, entity matrix, gap backlog | report ✓ |
| T2 | Frontend/UX audit | kieran | — | P0 | COMPLETE (audits/frontend-ux-audit.md) | — | Page matrix, placeholder findings, missing-UI backlog | report ✓ |
| T3 | QA/security/devops audit | athena | — | P0 | COMPLETE (audits/qa-security-devops-audit.md) | — | Test run results, ranked security findings, CI assessment | npm test/typecheck/lint ✓ |
| T4 | Security hardening (unsubscribe, RBAC fix, scoping, transactions, session revoke, CSP, reassignment validation) | felipe | — | P0 | in progress | feature/security-hardening | All 7 fixes implemented + tests | unit/integration |
| T5 | Transactional flows (lead convert, sequence create, contact import, set-default-pipeline) | jan | — | P0 | in progress | feature/transactional-flows | All 4 flows wrapped in $transaction | unit |
| T6 | Record scoping (shared helper, all entities, companies perms, deals scoping, merge preview) | chuck | T4 | P0 | in progress | feature/record-scoping | Consistent org+ownership scoping | unit/integration |
| T7 | Scheduler auth (service token, retry/backoff, dead-letter) | constance | — | P0 | in progress | feature/scheduler-auth | Cron works without manager session | unit |
| T8 | Per-org SMTP (encrypted password, test-send, remove global) | paulo | — | P0 | in progress | feature/per-org-smtp | Each org manages own SMTP | unit/integration |
| T9 | Stage history + pipeline mgmt (StageHistory, LostReason, stage CRUD, cascade Restrict) | noemie | — | P1 | in progress | feature/stage-history | Full audit trail, stage management UI | unit/integration |
| T10 | Deal detail UI (detail page, won/lost flow, edit, deep links) | joakim | T9 | P1 | in progress | feature/deal-detail-ui | Full deal lifecycle in UI | component/e2e |
| T11 | Toast/confirm system (replace banners/window.confirm, fix silent saves) | athena | — | P1 | in progress | feature/toast-system | Consistent feedback everywhere | component |
| T12 | Fix dead links (sidebar, ?deal=, ?q=, settings tabs) | valentina | — | P1 | in progress | feature/fix-dead-links | All deep links work | component |
| T13 | Test infra + CI (vitest split, bcrypt test env, component tests, CI on develop, .env.example) | sasha | — | P1 | in progress | feature/test-infra | Fast CI, full coverage | all tests pass |

## Verified Existing Functionality (do not rebuild)

- Auth: bcrypt(12), HttpOnly hashed-token sessions, X-Forwarded-Proto aware Secure flag, login rate limiting
- RBAC: Admin/Manager/Sales Rep permission matrix, last-admin protection, audit log
- Modules: Dashboard, Contacts (CSV import/export), Companies, Leads (scoring, dup detection, conversion), Pipeline (Kanban DnD, probabilities, win/loss), Tasks, Reports, Settings
- Email outreach (SMTP org settings, templates, status tracking), follow-up reminders scheduler, lead capture API (hashed keys, rate limit), inbound IMAP tracking, sequences, cross-entity duplicate merge, global search (Cmd+K)
- CI: typegen → typecheck workflow green on main @ 9db226b

## Environment Notes

- Dev server: background shell runs `npm run start` (prod build) on :3000; restart via persistent background shell (nohup dies with proot login)
- DB: prisma/dev.db (freshly migrated + seeded); demo accounts password123
- .env exists (DATABASE_URL, APP_URL) — never commit
- package-lock.json has uncommitted name-sync change (crm→nextjs-crm + MIT license) from npm install; preserve