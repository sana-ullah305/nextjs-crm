---
name: inbound-email-tracking
description: "Builds inbound email reply tracking: IMAP idle polling, Message-ID matching to SentEmail, auto-logged activities, owner notifications, lead status transitions, and tests. Use when working on email reply tracking or IMAP ingestion."
user-invocable: true
---

# Inbound Email Tracking — Engineering Contract

You are the Backend engineer for inbound email reply tracking. Your
workspace is the CRM repo at ~/projects/crm (Next.js 16 App Router,
TypeScript strict, Prisma 7 + SQLite, nodemailer already installed).

DEPENDENCY: Another agent is concurrently building the lead capture API
(schema API keys model + /api/leads/capture + settings api-keys section).
To avoid migration/index conflicts you MUST coordinate: when you need a
schema change yourself, add ONLY the fields/columns listed below and run
your own migration. If `prisma migrate dev` reports drift or a pending
migration conflict, STOP, and retry after checking `ls
prisma/migrations/` — the other agent's migration may have landed; never
delete their migration files.

## Scope — build EXACTLY this, nothing more

1. **Schema additions** (prisma/schema.prisma):
   - `SentEmail.messageId String @default("")` — outbound Message-ID.
   - New model `InboundEmail`: `id`, `organizationId`, `fromEmail`,
     `fromName`, `subject`, `body` (text), `messageId` (unique per org —
     use @@unique([organizationId, messageId])), `inReplyTo`, `sentEmailId`
     (optional link to the matched outbound), `contactId`, `leadId`,
     `status` (UNREAD | READ | IGNORED, string, default UNREAD),
     `receivedAt`, `createdAt`. Indexes: org+receivedAt, contactId, leadId.
     Relations to Organization, Contact (SetNull), Lead (SetNull),
     SentEmail (SetNull).
   - Migration via `npm run db:migrate -- --name add_inbound_emails`, then
     `npx prisma generate`.
2. **IMAP service** (`src/server/inbound-mail.ts`):
   - New env vars: `IMAP_HOST`, `IMAP_PORT` (default 993), `IMAP_USER`,
     `IMAP_PASS`, `IMAP_TLS` (default true). Document in .env.example with
     a comment block matching existing style.
   - Use the `imapflow` package (install it: `npm install imapflow` and
     `npm install -D @types/imapflow` if types exist; imapflow ships its
     own types).
   - `runInboundScan(now?)`: connect, open INBOX, search UNSEEN messages
     newer than the newest stored `receivedAt` (watermark), for each:
     parse From/To/Subject/Message-ID/In-Reply-To/date via ImapFlow's
     parsed message object; skip messages whose Message-ID already exists
     for the org (idempotent).
   - **Matching**: exact route where possible — find `SentEmail` by
     messageId == inbound inReplyTo. Fallback when no match: match
     fromEmail → most recent open lead by email, else most recent contact
     by email. Never create InboundEmail rows for senders matching no lead
     AND no contact AND no sent-email thread (leave them seen/unlogged —
     do NOT store unrelated mail).
   - Object: setting store envelope. For all fields use `InboundEmail`
     instance. For all fields use `SentEmail` up to the known envelope reuse only.
   - Store the InboundEmail row (org resolved from the match; for a
     SentEmail-thread match use that send's organizationId).
   - Side effects on match: create an activity (type EMAIL, title
     "Email received: <subject>", on contactId or leadId as matched,
     userId = the system fallback — use the matched record's owner; if
     unowned use the org's first admin), bump the lead status NEW →
     CONTACTED only when matched to a lead with status NEW, and create a
     notification for the owner/assignee (type INFO, link to the record).
   - Mark the message seen when stored. Return a summary count object
     `{ stored, skipped, scannedAt }` for tests + endpoint.
3. **Trigger endpoint** `src/app/api/inbound/run/route.ts`:
   `POST /api/inbound/run` — same permission style as
   src/app/api/reminders/run/route.ts but with a new permission
   `inbound:run` added to src/server/rbac.ts PERMISSIONS list and granted
   to ADMIN + MANAGER (filter it out of SALES_REP explicitly in REP_PERMS
   and keep MANAGER_PERMS's existing filter logic working — it gets it by
   default because it only excludes users:/settings:/pipelines:/notes
   entries). Calls `runInboundScan()`, returns ok(result).
4. **List endpoint** `src/app/api/inbound/route.ts`:
   `GET /api/inbound?contactId=|leadId=&status=&page=&pageSize=` — list
   InboundEmail rows, org-scoped, owner-visible-only for reps (reps see
   rows whose matched contact.ownerId or lead.assignedUserId is theirs or
   null). Update unread→read semantics: endpoint accepts `POST /api/inbound`
   body `{ ids: string[] }` marking rows READ (org-scoped). Permission:
   reuse `activities:read` like the emails route does.
5. **Tests** (src/server/__tests__/inbound.test.ts): DO NOT connect to a
   real IMAP server. Export a test hook from inbound-mail.ts:
   `__testProcessMessage(parsed)` that runs the same
   matching/storage/side-effect logic on a parsed-message-shaped object.
   Test through that hook + direct db assertions + the routes (follow
   src/server/__tests__/features.test.ts patterns):
   - Message whose inReplyTo matches a SentEmail → row stored, activity
     logged, owner notified, lead kept
   - No thread match but sender matches an open lead → lead NEW →
     CONTACTED transition + activity + notification
   - Sender matches contact only → stored + activity, no lead change
   - Unknown sender with no thread → nothing stored
   - Duplicate Message-ID → stored once (idempotent)
   - POST /api/inbound/run requires inbound:run permission (rep 403,
     manager 200 — with IMAP env unset the scan returns { stored: 0,
     skipped: 0 } and a `configured: false` field rather than throwing)
   - GET /api/inbound scoping: rep sees only own matched records

## Quality gates

- `npx tsc --noEmit` clean; `npm run lint` 0 new issues in your files;
  `npm test` ALL pass; `npm run build` succeeds.
- If imapflow install fails, STOP and report — do not substitute a
  different library.
- Do NOT touch: lead capture files (src/server/apikeys.ts,
  src/app/api/leads/capture, settings api-keys sections) or frontend files.

## Definition of done

Commit nothing. Leave the working tree dirty for QA + supervisor.
