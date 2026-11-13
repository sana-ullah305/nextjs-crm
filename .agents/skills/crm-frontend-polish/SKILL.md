---
name: crm-frontend-polish
description: "Builds the UI for sequences and duplicate merge plus API-key admin tab and unread-replies triage. Runs after backend agents merge."
user-invocable: true
---

# CRM Frontend — Sequences UI, Merge UI, Admin Tabs — Contract

You are the Frontend engineer. This workspace contains the MERGED backend
from two agents: duplicate detection & merge (src/server/dedupe.ts,
/api/merge endpoints, assertNotAlreadyEnrolled guard) and follow-up
sequences (Sequence/SequenceStep/SequenceEnrollment models,
/api/sequences routes, /api/unsubscribe, sequences:run + inbound reply
auto-stop + capture). Your job is UI only — the backend is frozen.

READ FIRST: src/components/topbar.tsx, src/components/entity-form.tsx,
src/components/compose-email.tsx, src/app/(app)/settings/page.tsx (tab
pattern + email tab example), src/app/(app)/leads/page.tsx (list style +
row actions), src/app/(app)/contacts/[id]/page.tsx (detail pattern),
src/components/sidebar-nav.tsx, src/lib/api-client.ts, src/lib/format.ts.
Match the existing design language EXACTLY: Tailwind classes, Card/
Button/Badge/Table/EmptyState/EntityForm primitives, lucide icons,
spacing, a11y (aria-label, role=alert on errors), dark mode (use semantic
tokens — border-border, bg-card, text-muted-foreground — never raw
colors).

## Scope — build EXACTLY this

1. **Settings tab: Sequences** (`src/app/(app)/settings/page.tsx`):
   - New tab "Sequences" (icon: Repeat from lucide) — list sequences with
     active/completed counts, create form (name + dynamic steps editor:
     position, delayHours, subject, body — use EntityForm's multi-field
     grid pattern or a small custom rows editor; min 1 max 15 step rows),
     activate/deactivate toggle, steps editor for existing sequences,
     delete (blocked-by-enrollments error surfaces as readable text).
   - Also new tab **API keys** (icon: KeyRound): list keys (name, prefix,
     lastUsedAt, active/revoked badge), create form (name → returns the
     full key ONCE in a highlighted code block with a copy button + a
     "you will not see this again" warning), revoke button (confirm
     dialog). Non-admins: both tabs render read-only or hidden per
     `settings:manage` rules used by the other tabs.
2. **Leads page** — add row action "Enroll in sequence" (icon: Repeat):
   dropdown/select of active sequences (fetch /api/sequences), enroll
   POST, success notice, 409 ALREADY_ENROLLED rendered as a friendly
   toast/notice not a crash. Also "Find duplicates" action per lead row
   (icon: Copy): opens the merge dialog (item 4).
3. **Contacts page + detail** — contacts/[id]/page.tsx: "Enroll in
   sequence" button in the header actions (next to Email/Edit) + a
   "Duplicates found" banner when `findDuplicateCandidates` returns hits
   (add a light-weight GET /api/merge/preview?lookup=<type>&id=<id> call —
   check the actual route signature in the merged backend first and use
   that) with a "Review & merge" button opening the merge dialog.
4. **Merge dialog component** (`src/components/merge-dialog.tsx`):
   - Props: open, onOpenChange, sourceType (contact|lead), sourceId.
   - Fetches candidates from the detection endpoint (read the real
     merged backend route and use the REAL response shape — do not
     guess). Candidate list with match-score badges (e.g. "87% match"),
     select target → preview (field diff table + counts of records that
     will move) → confirm panel: per-field radio selection for conflicts
     (email, firstName, lastName, phone, title, status) defaulting to
     the survivor recommendation → POST /api/merge → success → router
     refresh. Errors (403 rep, 404, guard) rendered as text.
5. **Unread replies triage** — dashboard or a new "Inbox" affordance in
   the topbar: a mail icon button with an unread count badge (poll
   /api/inbound?status=UNREAD like notifications polling — once a minute
   matched to the 60s pattern in topbar.tsx); dropdown lists unread
   inbound replies (from, subject, timeAgo) linking to the matched
   contact/lead; "Mark read" action posting to /api/inbound; link "View
   all" → a simple /inbox page OR a tab on the tasks page — your call,
     keep it minimal (one list, filter chips UNREAD|READ|ALL, click →
     linked record).

## Quality gates

- `npx tsc --noEmit` clean; `npm run lint` 0 errors and zero NEW
  warnings in files you touch; `npm test` all 130+ pass unchanged;
  `npm run build` succeeds.
- Backend files: ROUTE FILES READ ONLY. If something is genuinely
  missing in the backend that blocks UI (unlikely — verify twice),
  do NOT edit backend; instead write the gap to your report.
- No new dependencies. No raw color classes. Comments end with periods.

## Definition of done

Nothing committed. Write /tmp/agent-logs/agent-c-report.md: what you
built, the real backend route signatures you consumed (so QA can verify
they match), gate results, and any backend gaps found.
