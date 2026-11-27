# Database Schema

> Provider: PostgreSQL (Prisma 7, `@prisma/adapter-pg`). See `docs/database-postgresql.md` for setup and migration.

## Entity Relationship Overview

```
Organization 1───* User 1───* Session
Organization 1───* Tag
Organization 1───* LeadSource
Organization 1───* Pipeline 1───* Stage 1───* Deal
Organization 1───* Company 1───* Contact 1───* Note
Organization 1───* Lead ──→ Contact (conversion), Company (optional)
Organization 1───* Task (assigned to User; related to Contact/Deal/Lead)
Organization 1───* Activity (timeline events: calls, meetings, notes, emails, system events)
Organization 1───* Deal ──→ Contact (primary contact), Stage, User (owner)
Organization 1───* AuditLog
Organization 1───* Notification 1───* NotificationChannel
Organization 1───* EmailTemplate
Organization 1───* CustomField 1───* CustomFieldValue (polymorphic: contact/company/lead/deal)
Organization 1───* ApiKey (public lead-capture keys; SHA-256 hash at rest, soft revoke)
Organization 1───* InboundEmail (matched IMAP replies; threads to SentEmail via In-Reply-To)
```

## Tables

### users
| Column | Type | Notes |
|--------|------|-------|
| id | string PK | cuid |
| organizationId | string FK | organization |
| email | string | unique per organization |
| name | string | |
| passwordHash | string | bcrypt, cost 12 |
| role | string | ADMIN, MANAGER, SALES_REP (RBAC) |
| avatarColor | string | deterministic color seed |
| isActive | boolean | deactivation instead of delete |
| lastLoginAt | datetime? | |

### sessions
| Column | Type | Notes |
|--------|------|-------|
| id | string PK | |
| token | string unique | 256-bit random, hashed at rest |
| userId | string FK | |
| expiresAt | datetime | 7-day sliding |
| createdAt | datetime | |
| userAgent / ip | string? | for session management UI |

### organizations
Settings carrier for the tenant: name, industry, website, phone, address,
default pipeline flag, branding seed.

### companies
`id, organizationId, name, domain, industry, size, phone, website, address,
city, state, country, ownerId (User), notes, createdAt, updatedAt, deletedAt`

### contacts
`id, organizationId, companyId?, firstName, lastName, email, phone, mobile,
title/position, address fields, ownerId, status (LEAD/ACTIVE_CUSTOMER/
CHURNED etc.), avatarColor score fields, lastContactedAt, createdAt,
updatedAt, deletedAt`
- Unique composite index `(organizationId, email)` with null-safe filtering
  for duplicate detection.

### tags / taggings
Normalized many-to-many. `tagging` unique on `(tagId, targetType, targetId)`.

### lead_sources
Name + description (configurable in Settings).

### leads
`id, organizationId, firstName, lastName, email, phone, companyName?,
companyId?, contactId? (post-conversion), sourceId?, status (NEW/CONTACTED/
QUALIFIED/UNQUALIFIED/CONVERTED), score (0–100, computed on capture + edit),
assignedUserId?, estimatedValue?, expectedCloseDate?, followUpAt?, notes,
convertedAt?, createdAt, updatedAt, deletedAt`

### pipelines / stages
`Pipeline: id, organizationId, name, isDefault`
`Stage: id, pipelineId, name, position, probability (win %), type
(OPEN/WON/LOST)` — ordered by `position`; Kanban columns derive from this.

### deals
`id, organizationId, name, contactId?, companyId?, stageId, ownerId,
value (float), currency, status (OPEN/WON/LOST), expectedCloseDate,
actualCloseDate?, probability (denormalized from stage), wonAt?, lostAt?,
lostReason?, sourceId?, notes, nextStep, createdAt, updatedAt, deletedAt`

### tasks
`id, organizationId, title, description, type (CALL/MEETING/FOLLOW_UP/
EMAIL/TODO), priority (LOW/MEDIUM/HIGH/URGENT), status (PENDING/COMPLETED/
SKIPPED), dueAt?, completedAt?, reminderAt?, relatedType?, relatedId?
(contact/deal/lead/company), createdById, assignedUserId?, createdAt,
updatedAt`

### activities
Append-only timeline: `id, organizationId, type (CALL/EMAIL/MEETING/NOTE/
CREATED/UPDATED/STAGE_CHANGE/DEAL_WON/DEAL_LOST/CONVERTED), title,
description, contactId?, companyId?, dealId?, leadId?, userId, occurredAt,
durationMinutes?`

### notes
`id, organizationId, body, contactId?, companyId?, dealId?, leadId?,
userId, createdAt, updatedAt`

### audit_logs
`id, organizationId, userId, action (e.g. CONTACT_CREATE), entityType,
entityId, ipAddress, metadata (JSON string), createdAt`

### notifications / notification_channels
In-app notifications with per-user read state; `WEB`/`EMAIL` channels.

### email_templates
Subject + body (plain text), per organization; used in Communication module.

### custom_fields / custom_field_values
Custom field definitions: `entityType, name, dataType, options (JSON),
isRequired, position`. Values: polymorphic on `(fieldId, entityId)`.

## Indexes

- contacts: `(organizationId, email)`, `(organizationId, createdAt)`,
  `(organizationId, deletedAt)`, `(organizationId, companyId)`
- leads: `(organizationId, status)`, `(organizationId, deletedAt)`
- deals: `(organizationId, deletedAt)`, `(stageId)`, `(ownerId)`
- tasks: `(organizationId, assignedUserId, status, dueAt)`
- activities: `(organizationId, occurredAt)`, `(contactId, occurredAt)`
- sessions: unique `token`; index `userId, expiresAt`
- api_keys: unique `keyHash` (SHA-256 of the full key); `(organizationId, prefix)` for prefix-first lookup
- inbound_emails: unique `(organizationId, messageId)` (idempotent scan); `(organizationId, receivedAt)` watermark scan; `contactId` / `leadId` for record scoping


## Migration & Seed

- Migrations generated via `npx prisma migrate dev` and checked in
  (`prisma/migrations/`).
- `npm run db:seed` populates an organization, 5 users (one per role with
  password `password123` for development only), 8 companies, 30 contacts,
  25 leads in all statuses, a 2-pipeline setup (Default Sales + Enterprise),
  ~20 deals across all stages incl. won/lost history, tasks, activities
  spanning several months, tags, lead sources, notifications, email
  templates, custom fields, and audit entries.
