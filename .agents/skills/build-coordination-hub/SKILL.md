---
name: build-coordination-hub
description: "Coordination hub for the CRM feature build: kickoff, status checks, handoff management, blocker escalation. Used by the supervising agent to track agent progress."
user-invocable: true
---

# Build Coordination Hub

## Plan (supervisor-maintained)

Phase 1 (parallel): lead-capture-api agent + inbound-email-tracking agent
Phase 2 (serial, after both finish): crm-qa-verifier agent
Phase 3: supervisor commits + runs full gates one final time

## Handoff contracts

- Backend A (lead capture) owns: prisma/schema.prisma API-key model,
  src/server/apikeys.ts, src/app/api/leads/capture/,
  settings api-keys sections, lead-capture tests.
- Backend B (inbound email) owns: SentEmail.messageId + InboundEmail
  schema additions, src/server/inbound-mail.ts, src/app/api/inbound/,
  rbac inbound:run permission, inbound tests, .env.example IMAP docs.
- Shared surfaces (risk): prisma/schema.prisma + migrations +
  src/server/rbac.ts. Both agents regenerate prisma client. If migrate
  dev conflicts, land the earlier migration first (git working-tree
  conflicts resolved by supervisor).
- QA owns: verification only, mechanical fixes allowed.

## Status log

- [ ] A: lead capture API — in progress
- [ ] B: inbound email tracking — in progress
- [ ] QA: verification — pending
- [ ] Supervisor: final gates + commit — pending
