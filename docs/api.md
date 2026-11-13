# API Reference

Base URL: `/api`. All endpoints require the `crm_session` HttpOnly cookie
except where noted. Responses use a consistent envelope:

```jsonc
// success
{ "data": { ... } }

// error
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }
```

| Status | Meaning |
|--------|---------|
| 200 / 201 | Success |
| 400 | Validation failed (`details` lists Zod issue paths) |
| 401 | Not authenticated |
| 403 | Role/permission or ownership denied |
| 404 | Entity not found |
| 429 | Rate limited (login only; includes `Retry-After`) |
| 500 | Unexpected error (logged server-side, never leaks internals) |

Common query params for list endpoints: `q` (search), `page`, `pageSize`,
plus resource-specific filters noted below.

## Auth

### `POST /api/auth/login` — public
Body: `{ "email": string, "password": string }`.
Sets the session cookie. Rate limited to 10 attempts per 5 min per IP+email.
→ `{ id, organizationId, email, name, role, avatarColor, title }`

### `GET /api/auth/me`
→ current session user.

### `POST /api/auth/logout`
Revokes the session server-side and clears the cookie.

## Contacts — `/api/contacts`

| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | List. Filters: `q`, `status`, `companyId`, `ownerId`, `sort` (`recent`/`name`/`lastContacted`) |
| GET | `/:id` | Detail (company, owner, tags included) |
| POST | `/` | Create. Fields: `firstName*`, `lastName*`, `email`, `phone`, `mobile`, `title`, `status`, `companyId`, `ownerId`, `address`, `city`, `state`, `country`, `tags: string[]` |
| PATCH | `/:id` | Partial update (owner or manager+) |
| DELETE | `/:id` | Soft delete (owner or manager+) |
| GET | `/export` | CSV download (formula-injection escaped) |
| POST | `/import` | Body `{ contacts: [{ firstName, lastName, email, phone, title, company }] }` — skips duplicates & rows missing names, auto-creates companies |

## Companies — `/api/companies`

| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | List. Filters: `q`, `industry`, `ownerId`, `sort` |
| GET | `/:id` | Detail incl. associated contacts |
| POST | `/` | `name*`, `domain`, `industry`, `size`, `phone`, `website`, address fields, `ownerId` |
| PATCH | `/:id` | Partial update |
| DELETE | `/:id` | Soft delete |

## Leads — `/api/leads`

| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | List. Filters: `q`, `status`, `sourceId`, `assignedUserId`, `minScore`, `sort` (`score`) |
| GET | `/check-duplicate?email=` | → `{ isDuplicate, lead?, contact? }` |
| GET | `/:id` | Detail |
| POST | `/` | Capture. `firstName*`, `lastName*`, `email*`, `phone`, `companyName`, `sourceId`, `status`, `estimatedValue`, `expectedCloseDate`, `followUpAt`, `notes`, `assignedUserId`. Score is computed server-side. Company auto-created by name. |
| POST | `/:id` | **Convert**: `{ createDeal?: boolean, dealName?, dealValue?, pipelineId?, expectedCloseDate? }` → creates contact (+ optional deal in default pipeline's first stage), marks lead `CONVERTED` |
| PATCH | `/:id` | Partial update; rescoring is automatic |
| DELETE | `/:id` | Soft delete |

## Deals — `/api/deals`

| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | List. Filters: `pipelineId`, `status`, `ownerId`, `q` |
| GET | `/:id` | Detail incl. full pipeline/stage set |
| POST | `/` | `name*`, `stageId*`, `value`, `contactId`, `companyId`, `ownerId`, `sourceId`, `expectedCloseDate`, `nextStep`, `notes` |
| PATCH | `/:id` | Partial update |
| PATCH | `/:id?action=move` | Kanban move: `{ stageId }` — updates probability/status, sets won/lost timestamps, logs activity |
| DELETE | `/:id` | Soft delete |

## Tasks — `/api/tasks`

| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | Filters: `status`, `assignedUserId`, `type`, `priority`, `relatedType`, `relatedId`, `due` (`overdue`/`today`/`week`) |
| POST | `/` | `title*`, `type` (CALL/MEETING/FOLLOW_UP/EMAIL/TODO), `priority`, `dueAt`, `reminderAt`, `relatedType`, `relatedId`, `assignedUserId`. Notifies the assignee. |
| PATCH | `/:id` | Partial update; `status: "COMPLETED"` stamps `completedAt` and logs activity |
| DELETE | `/:id` | Hard delete |

## Activities & Notes — `/api/activities`

| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | Filters: `contactId`, `companyId`, `dealId`, `leadId`, `type` |
| POST | `/` | Log activity: `type*` (CALL/EMAIL/MEETING/NOTE/stamp types), `title*`, `description`, one of `contactId`/`companyId`/`dealId`/`leadId`, `durationMinutes`, `occurredAt`. Updates the contact's `lastContactedAt`. |
| POST | `/note` | Create note attached to a record: `{ body*, contactId? | companyId? | dealId? | leadId? }` |
| DELETE | `/:id` | Delete a note (author, manager, or admin) |

## Notifications — `/api/notifications`

| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | Latest 20 for the current user + `unreadCount` |
| POST | `/` | Mark all read |
| DELETE | `/:id` or `/` | Delete one / all |

## Dashboard & Reports

- `GET /api/dashboard` → KPI bundle, 6-month revenue trend, lead funnel,
  recent activities, upcoming tasks, top performers. Permission:
  `contacts:read`.
- `GET /api/reports?period=month|quarter|year&format=json|csv` → summary,
  monthly revenue, team performance, funnel, acquisition by source.
  Permission: `reports:read` (admin, manager). CSV export adds
  `Content-Disposition`.

## Email Outreach — `/api/emails`

| Method | Path | Notes |
|--------|------|-------|
| POST | `/` | Send an email. Body: `to*` (email), `toName`, `subject*`, `body*`, plus optional `contactId` / `leadId` / `dealId` / `templateId`. Uses the org's SMTP settings; records a `SentEmail` row + EMAIL activity + audit entry, bumps `lastContactedAt` on the contact. Permission: `email:send` (all roles). Errors: `409 EMAIL_NOT_CONFIGURED`, `502 EMAIL_SEND_FAILED` (attempt still recorded with status `FAILED`). |
| GET | `/` | Sent history (latest 50). Managers/admins see org-wide; reps see their own sends. Filters: `contactId`, `leadId`, `dealId`. Permission: `activities:read`. |

### `PATCH /api/settings/email` — SMTP config

Body: `{ smtpHost, smtpPort, smtpUser, fromAddress, notificationsEnabled }`.
Permission: `settings:manage` (admin) to write, `settings:read` to read.
The SMTP password is never stored in the database — it is read from the
`SMTP_PASS` environment variable at send time.

## Reminders — `/api/reminders/run`

| Method | Path | Notes |
|--------|------|-------|
| POST | `/` | Trigger a reminder scan (idempotent, deduplicated). Creates in-app notifications for: lead follow-ups that are due (`followUpAt` passed, lead still open) and tasks that are due or overdue. Reminders go to the lead's assignee (fallback: owner) and the task's assignee (fallback: creator). Intended to be called by cron / an uptime monitor every ~15 minutes. Permission: `reminders:run` (admin, manager). Returns `{ leadsReminded, tasksReminded, remindersCreated, scannedAt }`. |

## Global Search — `/api/search`

| Method | Path | Notes |
|--------|------|-------|
| GET | `/?q=<term>&limit=5` | Cross-entity search over contacts (name, email), companies (name, domain), leads (name, email, company — excludes converted), deals (name, open only), and tasks (title, open only). Results are labeled and href-linked for direct navigation. RBAC-scoped: reps only see records they own (or unowned/unassigned). Permission: `contacts:read`. Min term length: 2 characters. |

## Users — `/api/users` (admin only unless noted)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | Team list (contact fields, no password hashes) |
| GET | `/audit` | Audit log. Filters: `action`, `page`, `pageSize` (admin/manager) |
| POST | `/` | Create: `name*`, `email*` (unique per org), `password*` (min 8), `role*`, `title`, `phone` |
| PATCH | `/:id` | Update `name`/`role`/`isActive`/`password`. Deactivation revokes sessions. Guards the last active admin. |
| DELETE | `/:id` | Deactivate (soft delete) — guards self-removal and last admin |

## Settings — `/api/settings/:section`

| Method | Path | Permission |
|--------|------|-----------|
| GET | `/organization` · `/users` (id/name list) · `/tags` · `/lead-sources` · `/pipelines` · `/email-templates` · `/custom-fields` | `settings:read` |
| PATCH | `/organization` — org profile | `settings:manage` |
| POST / DELETE | `/tags`, `/lead-sources` (blocked when in use), `/email-templates`, `/custom-fields` | `settings:manage` |
| POST | `/pipelines` — create pipeline + stages `{ name, stages: [{ name, probability, type }] }` | `pipelines:manage` (admin) |
| PATCH | `/pipelines/:id` — rename / set default | `pipelines:manage` |
| DELETE | `/pipelines/:id` — blocked when it has deals or is the last pipeline | `pipelines:manage` |

## Roles & Permissions

| Permission group | ADMIN | MANAGER | SALES_REP |
|---|---|---|---|
| User management | ✔ | — | — |
| Org settings (write) | ✔ | ✔ | — |
| Pipelines (write) | ✔ | — | — |
| See all records | ✔ | ✔ | own + unassigned |
| Contacts / Leads / Deals / Tasks CRUD | ✔ | ✔ | own records |
| Leads: convert | ✔ | ✔ | ✔ |
| Import / export contacts | ✔ | ✔ | ✔ |
| Reports | ✔ | ✔ | — |
| Audit log | ✔ | ✔ | — |
| Delete others' notes | ✔ | ✔ | own |
| Send email | ✔ | ✔ | ✔ |
| Trigger reminder scan | ✔ | ✔ | — |

Full matrix: `src/server/rbac.ts`.
