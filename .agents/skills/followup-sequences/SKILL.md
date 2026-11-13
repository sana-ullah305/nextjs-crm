---
name: followup-sequences
description: "Builds automated follow-up sequences: Sequence/Step/Enrollment models, scheduler with reply-based auto-stop, unsubscribe handling, tests. Backend only."
user-invocable: true
---

# Follow-Up Sequences — Engineering Contract

You are the Backend engineer for automated follow-up sequences. Workspace:
this repo (an isolated copy; another agent works in a separate copy on
duplicate merge — ignore coordination notes about them, you own this
workspace exclusively).

Stack: Next.js 16 App Router, TypeScript strict, Prisma 7 + SQLite, Zod,
nodemailer mailer (src/server/mailer.ts), IMAP inbound
(src/server/inbound-mail.ts), session auth, RBAC, audit.

READ FIRST: src/server/mailer.ts (sendEmail signature — you will call the
exported sendEmail, do NOT duplicate SMTP logic), src/server/reminders.ts
(scheduler pattern + dedupe style), src/server/inbound-mail.ts (how
replies are matched/stored — your auto-stop reads this),
src/server/rbac.ts, src/lib/schemas/index.ts (email template schema
style), prisma/schema.prisma.

## Scope — build EXACTLY this

1. **Schema** (prisma/schema.prisma):
   - `Sequence`: id, organizationId, name, description (default ""),
     isActive (default true), createdById, createdAt, updatedAt.
     Relations: organization, createdBy, steps, enrollments.
   - `SequenceStep`: id, sequenceId, position (int), delayHours (int,
     default 24; hours after previous step), subjectTemplate (string, max
     200), bodyTemplate (string), createdAt. Relation: sequence,
     enrollments. `@@unique([sequenceId, position])`.
   - `SequenceEnrollment`: id, organizationId, sequenceId, contactId?,
     leadId?, enrolledEmail (string — snapshot), currentStep (int, default
     0 — index of the NEXT step to send), nextSendAt (DateTime?),
     status (string, default ACTIVE — ACTIVE | COMPLETED | STOPPED |
     UNSUBSCRIBED), stoppedReason (string, default ""), responderUserId
     (string, null — who enrolled), unsubToken (string, unique — for the
     public unsubscribe link), createdAt, updatedAt. Indexes:
     (organizationId, status, nextSendAt), sequenceId, contactId, leadId,
     plus @@unique([sequenceId, contactId]) and @@unique([sequenceId,
     leadId]) — a record can be in one active enrollment per sequence
     (enforced in code as active-only; the DB unique is a safety net —
     comment that re-enrollment after completion raises duplicate →
     handle P2002 as 409 ALREADY_ENROLLED in the route).
   - Merge agent's hook: another agent exports
     `assertNotAlreadyEnrolled(organizationId, email)` from
     src/server/dedupe.ts. In THIS workspace that file does not exist —
     write a minimal stub `src/server/dedupe-guard-stub.ts` exporting the
     same signature that checks SequenceEnrollment (ACTIVE or UNSUBSCRIBED)
     by enrolledEmail (org-scoped) and throws MergeGuardError. The
     supervisor will swap dedupe.ts's real implementation at merge time.
     Import it via `@/server/dedupe-guard-stub` and keep the import path
     constant.
   - Migration: `npm run db:migrate -- --name add_sequences`, then
     `npx prisma generate`.
2. **Template rendering**: reuse `renderTemplate` from
   src/server/mailer.ts for {{token}} merging. Available vars per send:
   firstName, lastName, email, company (contact company name or lead
     companyName), ownerName, unsubscribeUrl. SUBJECT also renders tokens.
3. **Enrollment API** — `src/app/api/sequences/[[...id]]/route.ts`:
   - GET `/api/sequences` (list with steps + active enrollment counts;
     org-scoped). POST create `{ name*, description, steps: [{ position,
     delayHours, subjectTemplate*, bodyTemplate* }] }` (min 1, max 15
     steps; Zod). PATCH update sequence (name/description/isActive) and
     PATCH `/api/sequences/:id/steps` replaces the steps array wholesale
     (same schema). DELETE soft-only if it has enrollments (isActive =
     false); hard delete allowed only with zero enrollments ever.
   - POST `/api/sequences/:id/enroll` — body `{ contactId }` or
     `{ leadId }` (exactly one). Loads the record (org-scoped,
     not-soft-deleted), snapshots email (must be non-empty → 400),
     calls the enrollment guard (dedupe-guard-stub) → 409
     ALREADY_ENROLLED on MergeGuardError, computes nextSendAt = now +
     step[0].delayHours, generates unsubToken (32 hex, randomBytes),
     creates enrollment + audit SEQUENCE_ENROLL. Permission:
     `leads:update` (any role can enroll records they can access — reps
     own records only via canAccessRecord from rbac.ts).
   - GET `/api/sequences/:id/enrollments?status=` — list enrollments
     (reps see only their office records' rows: contact.ownerId or
     lead.assignedUserId is theirs; managers/admins all).
   - DELETE `/api/sequences/enrollments/:id` → cancel: status STOPPED,
     stoppedReason "cancelled by user", audit SEQUENCE_UNENROLL.
   - Sequences management permission: `settings:manage` for create/update/
     delete of sequences; enroll/unenroll: `leads:update`.
4. **Scheduler** — `src/server/sequences.ts`:
   - `runSequenceScan(now?)`: for each org (pattern from reminders.ts):
     find ACTIVE enrollments with nextSendAt <= now, load the step at
     currentStep (error → mark enrollment STOPPED "step missing"), render
     templates with the record's vars, send via the mailer's `sendEmail`
     with the unsubscribe footer APPENDED to the body:
     `\n\n—\nTo stop receiving these emails: <unsubscribeUrl>` — build the
     URL as `${process.env.APP_URL ?? "http://localhost:3000"}/unsubscribe?
     token=<unsubToken>`. Also pass templateId NOT set; set mailer's
     contactId/leadId fields so history lands on the record.
     On send success: audit SEQUENCE_STEP_SENT (metadata seqId, stepPos,
     enrollmentId); if currentStep+1 exists → currentStep+1, nextSendAt =
     now + next.delayHours; else status COMPLETED.
     On send failure (EmailConfigError/EmailSendError from mailer):
     retry logic NONE — mark the enrollment STOPPED, stoppedReason
     "send_failed: <message>" (operator can re-enroll).
     Idempotency: an enrollment whose nextSendAt is in the future never
     runs; concurrent scans — use an updateMany guard: `updateMany({
     where: { id, status: ACTIVE, nextSendAt: { lte: now } }, data: {
     nextSendAt: far-future-placeholder }})` as a claim, and only proceed
     when count===1 (optimistic lock; document with a comment).
   - **Reply-based auto-stop** — add to
     src/server/inbound-mail.ts processInboundMessage (after successful
     store): if the sender email (fromEmail) has any ACTIVE enrollment
     (org of the matched record), set status STOPPED, stoppedReason
     "replied". Write a test for this via the __testProcessMessage hook.
     This file is a shared surface — make ONLY this surgical addition,
     marked with a `// SEQUENCES:` comment.
   - Trigger: `src/app/api/sequences/run/route.ts` POST — permission
     `sequences:run` (new permission, ADMIN+MANAGER like inbound:run;
     add to PERMISSIONS list in rbac.ts mirroring inbound:run's comment
     style). Returns `{ sent, completed, stopped, scannedAt }`.
5. **Public unsubscribe** — `src/app/api/unsubscribe/route.ts`:
   - GET `/api/unsubscribe?token=<unsubToken>` — 404 on unknown token.
     Marks ALL enrollments with that unsubToken (could be one; token is
     per-enrollment) status UNSUBSCRIBED, stoppedReason
     "unsubscribed". Responds with a tiny HTML page (constants string,
     not JSX): `<html><body><h1>You're unsubscribed</h1><p>No more
     emails from this sender.</p></body></html>` with
     `Content-Type: text/html`. Add the path to the public prefixes in
     src/proxy.ts (comment style like the capture one).
   - Add `List-Unsubscribe` + `List-Unsubscribe-Post: One-Click` headers
     to sequence emails — extend `sendEmail` in src/server/mailer.ts
     with an OPTIONAL `headers?: Record<string,string>` param passed to
     nodemailer (shared surface — surgical, marked with a `// SEQUENCES:`
     comment; existing call sites unaffected).
   - Suppression check: enrollment API and the scan BOTH refuse when a
     person has ANY UNSUBSCRIBED enrollment with the same
     enrolledEmail in the org (409 UNSUBSCRIBED / skip with
     stoppedReason "unsubscribed").
6. **Tests** — `src/server/__tests__/sequences.test.ts` (features pattern;
   mock the mailer sendMail — use the existing __testHooks.captureNextSend
   from mailer.ts, do NOT hit SMTP):
   - Template render + unsubscribe footer appended + List-Unsubscribe
     header present
   - Enrollment: happy path (lead + contact), already-active → 409,
     unsubscribed email → 409, rep can enroll own record but 403 on
     others', missing email → 400
   - Scan: step 0 sent → nextSendAt advances, step 1 sent later →
     COMPLETED; send failure → STOPPED with reason; optimistic-lock guard
     (second simultaneous scan does not double-send)
   - Reply auto-stop: inbound __testProcessMessage for a sender with an
     ACTIVE enrollment flips it STOPPED "replied"
   - Unsubscribe: GET with valid token flips status; unknown token 404;
     html response content-type
   - Sequence CRUD: create with steps, update steps wholesale, delete
     blocked when enrollments exist, list scoped, routes guarded
     (`sequences:run` — rep 403, manager 200)

## Quality gates

`tsc --noEmit` clean; lint 0 errors + zero warnings in your files;
`npm test` all pass (98 existing + yours); `npm run build` succeeds.
If a migration name collides (add_sequences already exists), use
add_sequences_v2 — never delete existing migrations.

## Definition of done

Nothing committed. Working tree dirty for the supervisor. Write your
report to /tmp/agent-logs/agent-b2-report.md (what you built, gate
results, notable decisions, exact names/locations of the two shared-
surface edits in mailer.ts and inbound-mail.ts so the supervisor can
merge them precisely).
