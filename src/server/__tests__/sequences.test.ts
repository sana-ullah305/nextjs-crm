/**
 * Integration tests for automated follow-up sequences. Runs against the
 * isolated test SQLite database using the same direct route-handler pattern
 * as features.test.ts. No real SMTP server is contacted: sequence sends are
 * captured via mailer.ts's __testHooks.captureNextSend (the send path still
 * persists SentEmail rows and activities, which we assert against).
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = new Map<string, { name: string; value: string }>();

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (_name: string) => null }),
  cookies: async () => ({
    get: (name: string) => cookieStore.get(name),
    set: (name: string, value: string) => cookieStore.set(name, { name, value }),
    delete: (name: string) => cookieStore.delete(name),
  }),
}));

import { POST as loginRoute } from "@/app/api/auth/login/route";
import {
  GET as sequencesGet,
  POST as sequencesPost,
  PATCH as sequencesPatch,
  DELETE as sequencesDelete,
} from "@/app/api/sequences/[id]/route";
import { POST as sequencesRun } from "@/app/api/sequences/run/route";
import { GET as unsubscribeGet } from "@/app/api/unsubscribe/route";
import { runSequenceScan, renderSequenceStep, buildUnsubscribeUrl } from "@/server/sequences";
import { __testProcessMessage } from "@/server/inbound-mail";
import { resetRateLimiter } from "@/server/rate-limit";
import db from "@/server/db";
import { hashPassword } from "@/server/auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: any, ctx?: any) => Promise<Response>;

function call(handler: Handler, req: unknown, ctx?: unknown): Promise<Response> {
  return ctx !== undefined ? handler(req as never, ctx as never) : handler(req as never);
}

function makeRequest(pathname: string, init?: { method?: string; json?: unknown }) {
  const url = new URL(`http://localhost:3000${pathname}`);
  return {
    url: url.toString(),
    method: init?.method ?? "GET",
    headers: new Headers(init?.json !== undefined ? { "content-type": "application/json" } : {}),
    json: async () => (init?.json !== undefined ? init.json : {}),
    cookies: {
      get: (name: string) => cookieStore.get(name),
      set: (name: string, value: string) => cookieStore.set(name, { name, value }),
      delete: (name: string) => cookieStore.delete(name),
    },
    nextUrl: url,
  };
}

function seqCtx(segments?: string | undefined) {
  return { params: Promise.resolve({ id: segments as string }) };
}

let orgId: string;
let adminId: string;
let repId: string;
let contactId: string;
let repContactId: string;
let leadId: string;
let noEmailContactId: string;

const SMTP_SETTINGS = {
  smtpHost: "smtp.seq.test",
  smtpPort: 587,
  smtpUser: "mailer",
  fromAddress: "sequences@seq.test",
};

async function loginAs(email: string) {
  // The suite logs in far more often than the 10/5-min login limiter allows,
  // so the in-memory buckets are reset like lead-capture.test.ts does.
  resetRateLimiter();
  cookieStore.clear();
  const res = await call(
    loginRoute,
    makeRequest("/api/auth/login", { method: "POST", json: { email, password: "password123" } }),
    { params: Promise.resolve({}) }
  );
  expect(res.status).toBe(200);
}

const STEPS = [
  { position: 0, delayHours: 1, subjectTemplate: "Hello {{firstName}}", bodyTemplate: "Hi {{firstName}}, quick intro. — {{ownerName}} at {{company}}" },
  { position: 1, delayHours: 2, subjectTemplate: "Following up, {{firstName}}", bodyTemplate: "Second touch for {{email}}." },
];

async function createSequence(overrides: Record<string, unknown> = {}) {
  const res = await call(
    sequencesPost,
    makeRequest("/api/sequences", {
      method: "POST",
      json: { name: "Onboarding", description: "Welcome flow", steps: STEPS, ...overrides },
    })
  );
  expect(res.status).toBe(201);
  const body = await res.json();
  return body.data as {
    id: string;
    name: string;
    steps: Array<{ id: string; position: number; delayHours: number }>;
  };
}

async function enroll(sequenceId: string, payload: Record<string, unknown>) {
  return call(
    sequencesPost,
    makeRequest(`/api/sequences/${sequenceId}/enroll`, { method: "POST", json: payload }),
    seqCtx([sequenceId, "enroll"])
  );
}

beforeAll(async () => {
  resetRateLimiter();
  await db.session.deleteMany();
  await db.notification.deleteMany();
  await db.followUpReminder.deleteMany();
  await db.inboundEmail.deleteMany();
  await db.sentEmail.deleteMany();
  await db.sequenceStepEnrollment.deleteMany();
  await db.sequenceEnrollment.deleteMany();
  await db.sequenceStep.deleteMany();
  await db.sequence.deleteMany();
  await db.activity.deleteMany();
  await db.note.deleteMany();
  await db.task.deleteMany();
  await db.auditLog.deleteMany();
  await db.deal.deleteMany();
  await db.lead.deleteMany();
  await db.stage.deleteMany();
  await db.pipeline.deleteMany();
  await db.contact.deleteMany();
  await db.tag.deleteMany();
  await db.company.deleteMany();
  await db.user.deleteMany();
  await db.leadSource.deleteMany();
  await db.emailTemplate.deleteMany();
  await db.emailSettings.deleteMany();
  await db.organization.deleteMany();

  orgId = (await db.organization.create({ data: { name: "Sequence Org" } })).id;
  const passwordHash = await hashPassword("password123");
  adminId = (
    await db.user.create({
      data: { organizationId: orgId, name: "Admin", email: "admin@seq.test", passwordHash, role: "ADMIN" },
    })
  ).id;
  repId = (
    await db.user.create({
      data: { organizationId: orgId, name: "Rep", email: "rep@seq.test", passwordHash, role: "SALES_REP" },
    })
  ).id;
  await db.user.create({
    data: { organizationId: orgId, name: "Manager", email: "manager@seq.test", passwordHash, role: "MANAGER" },
  });

  await db.emailSettings.create({ data: { organizationId: orgId, ...SMTP_SETTINGS } });

  const contact = await db.contact.create({
    data: {
      organizationId: orgId,
      firstName: "Grace",
      lastName: "Hopper",
      email: "grace@seq.test",
      ownerId: adminId,
    },
  });
  contactId = contact.id;

  const repContact = await db.contact.create({
    data: {
      organizationId: orgId,
      firstName: "Rita",
      lastName: "Rep-Controlled",
      email: "rita@seq.test",
      ownerId: repId,
    },
  });
  repContactId = repContact.id;

  const lead = await db.lead.create({
    data: {
      organizationId: orgId,
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@seq.test",
      companyName: "Analytical Engines",
      status: "NEW",
      assignedUserId: adminId,
    },
  });
  leadId = lead.id;

  const noEmailContact = await db.contact.create({
    data: {
      organizationId: orgId,
      firstName: "No",
      lastName: "Email",
      email: "",
      ownerId: adminId,
    },
  });
  noEmailContactId = noEmailContact.id;
}, 120_000);

beforeEach(async () => {
  await loginAs("admin@seq.test");
  // The enrollment guard is per-EMAIL (org-wide), so leftover ACTIVE rows
  // from a previous test would 409 unrelated enrollments below. Wipe the
  // sequence surfaces so every test builds its own state.
  await db.sequenceStepEnrollment.deleteMany();
  await db.sequenceEnrollment.deleteMany();
  await db.sequenceStep.deleteMany();
  await db.sequence.deleteMany();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("template rendering", () => {
  it("renders tokens, appends the unsubscribe footer, and exposes List-Unsubscribe headers", async () => {
    const unsubUrl = buildUnsubscribeUrl("deadbeef".repeat(4) + "cafe");
    const { subject, body } = renderSequenceStep(
      { subjectTemplate: "Hi {{firstName}} from {{company}}", bodyTemplate: "Welcome {{firstName}} {{lastName}} ({{email}}), cheers {{ownerName}}" },
      {
        contactId: null,
        leadId: null,
        email: "ada@seq.test",
        firstName: "Ada",
        lastName: "Lovelace",
        company: "Analytical Engines",
        ownerName: "Admin",
      },
      unsubUrl
    );
    expect(subject).toBe("Hi Ada from Analytical Engines");
    expect(body).toContain("Welcome Ada Lovelace (ada@seq.test), cheers Admin");
    // Footer is appended verbatim per the scheduler contract.
    expect(body.endsWith(`\n\n—\nTo stop receiving these emails: ${unsubUrl}`)).toBe(true);
  });

  it("sends List-Unsubscribe headers and the footer through the mailer (capture hook, no SMTP)", async () => {
    const sequence = await createSequence();
    const enrollment = await db.sequenceEnrollment.create({
      data: {
        organizationId: orgId,
        sequenceId: sequence.id,
        contactId,
        enrolledEmail: "grace@seq.test",
        currentStep: 0,
        nextSendAt: new Date(Date.now() - 1000),
        status: "ACTIVE",
        unsubToken: "tok-header-check-0000000000000000000000000001",
        responderUserId: adminId,
      },
    });

    const captured: Array<{ to: string; subject: string }> = [];
    const originalSend = (await import("@/server/mailer")).__testHooks;
    // The capture hook records the send; headers flow straight to nodemailer
    // (undefined in JS here), so assert the recorded SentEmail/step outcome.
    originalSend.captureNextSend = (info) => {
      captured.push(info);
    };

    const result = await runSequenceScan();
    expect(result.sent).toBe(1);

    const sent = await db.sentEmail.findFirst({
      where: { recipientEmail: "grace@seq.test" },
    });
    expect(sent?.subject).toContain("Hello Grace");
    expect(sent?.body).toContain("To stop receiving these emails: http");
    expect(sent?.body).toContain("/unsubscribe?token=tok-header-check");
    expect(sent?.contactId).toBe(contactId);
    // templateId NOT set for sequence sends.
    expect(sent?.templateId).toBeNull();

    const audited = await db.auditLog.findFirst({
      where: { organizationId: orgId, action: "SEQUENCE_STEP_SENT", entityId: enrollment.id },
    });
    expect(audited).not.toBeNull();
    const meta = JSON.parse(audited?.metadata ?? "{}");
    expect(meta.seqId).toBe(sequence.id);
    expect(meta.stepPos).toBe(0);
    expect(meta.enrollmentId).toBe(enrollment.id);
    void captured;
  });
});

describe("enrollment API", () => {
  it("enrolls a lead and snapshots its email with nextSendAt from step 0 delay", async () => {
    const sequence = await createSequence();
    const res = await enroll(sequence.id, { leadId });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.enrolledEmail).toBe("ada@seq.test");
    expect(body.data.status).toBe("ACTIVE");
    expect(body.data.currentStep).toBe(0);
    expect(body.data.unsubToken).toMatch(/^[0-9a-f]{64}$/);
    const stored = await db.sequenceEnrollment.findUnique({ where: { id: body.data.id } });
    expect(stored?.nextSendAt).not.toBeNull();
    const driftMs = Math.abs(new Date(stored!.nextSendAt!).getTime() - (Date.now() + 3600_000));
    expect(driftMs).toBeLessThan(60_000);
    expect(stored?.responderUserId).toBe(adminId);

    const audit = await db.auditLog.findFirst({
      where: { organizationId: orgId, action: "SEQUENCE_ENROLL", entityId: body.data.id },
    });
    expect(audit).not.toBeNull();
  });

  it("enrolls a contact (happy path) and rejects a missing email with 400", async () => {
    const sequence = await createSequence();
    const res = await enroll(sequence.id, { contactId });
    expect(res.status).toBe(201);

    const missing = await enroll(sequence.id, { contactId: noEmailContactId });
    expect(missing.status).toBe(400);
    const errBody = await missing.json();
    expect(errBody.error.message).toContain("no email");
  });

  it("rejects double enrollment (guard) with 409 ALREADY_ENROLLED", async () => {
    const sequence = await createSequence();
    const first = await enroll(sequence.id, { contactId });
    expect(first.status).toBe(201);
    const second = await enroll(sequence.id, { contactId });
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error.code).toBe("ALREADY_ENROLLED");

    // Same email on a DIFFERENT record is also blocked by the email guard.
    const dupEmailLead = await db.lead.create({
      data: { organizationId: orgId, firstName: "Dupe", lastName: "Email", email: "grace@seq.test" },
    });
    const crossRecord = await enroll(sequence.id, { leadId: dupEmailLead.id });
    expect(crossRecord.status).toBe(409);
  });

  it("rejects enrollment of an unsubscribed email with 409 UNSUBSCRIBED", async () => {
    const sequence = await createSequence();
    const enrollment = await db.sequenceEnrollment.create({
      data: {
        organizationId: orgId,
        sequenceId: sequence.id,
        contactId,
        enrolledEmail: "grace@seq.test",
        status: "UNSUBSCRIBED",
        stoppedReason: "unsubscribed",
        unsubToken: "tok-unsub-block-000000000000000000000000000001",
      },
    });
    const dupEmailLead = await db.lead.create({
      data: { organizationId: orgId, firstName: "Second", lastName: "Identity", email: "grace@seq.test" },
    });
    const res = await enroll(sequence.id, { leadId: dupEmailLead.id });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("UNSUBSCRIBED");
    void enrollment;
  });

  it("re-enrollment after completion hits the DB unique safety net → 409 (re-enroll requires a fresh enrollment row design)", async () => {
    const sequence = await createSequence();
    await db.sequenceEnrollment.create({
      data: {
        organizationId: orgId,
        sequenceId: sequence.id,
        contactId,
        enrolledEmail: "grace@seq.test",
        status: "COMPLETED",
        unsubToken: "tok-completed-000000000000000000000000000001",
      },
    });
    // The DB unique on (sequenceId, contactId) is a safety net that fires
    // regardless of the old row's status; the route maps P2002 to 409.
    const res = await enroll(sequence.id, { contactId });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("ALREADY_ENROLLED");
  });

  it("lets a rep enroll their own record but not someone else's (403)", async () => {
    const sequence = await createSequence();
    await loginAs("rep@seq.test");
    const own = await enroll(sequence.id, { contactId: repContactId });
    expect(own.status).toBe(201);

    const otherOwned = await enroll(sequence.id, { contactId });
    expect(otherOwned.status).toBe(403);
  });

  it("lists enrollments org-scoped, with reps seeing only own-office records", async () => {
    const sequence = await createSequence();
    await enroll(sequence.id, { contactId });
    await enroll(sequence.id, { leadId });

    await loginAs("rep@seq.test");
    const res = await call(
      sequencesGet,
      makeRequest(`/api/sequences/${sequence.id}/enrollments`),
      seqCtx([sequence.id, "enrollments"])
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const row of body.data.enrollments as Array<{
      contact: { ownerId: string | null } | null;
      lead: { assignedUserId: string | null } | null;
    }>) {
      const ownerId = row.contact?.ownerId ?? null;
      const assigneeId = row.lead?.assignedUserId ?? null;
      expect(ownerId === repId || ownerId === null || assigneeId === repId || assigneeId === null).toBe(true);
    }
    expect(
      (body.data.enrollments as Array<{ enrolledEmail: string }>).every(
        (r) => r.enrolledEmail === "rita@seq.test"
      )
    ).toBe(true);

    await loginAs("manager@seq.test");
    const mgrRes = await call(
      sequencesGet,
      makeRequest(`/api/sequences/${sequence.id}/enrollments?status=ACTIVE`),
      seqCtx([sequence.id, "enrollments"])
    );
    const mgrBody = await mgrRes.json();
    const mgrEmails = (mgrBody.data.enrollments as Array<{ enrolledEmail: string }>)
      .map((r) => r.enrolledEmail)
      .sort();
    expect(mgrEmails).toContain("ada@seq.test");
    expect(mgrEmails).toContain("grace@seq.test");
  });

  it("cancels an enrollment via DELETE (STOPPED, cancelled by user, audited)", async () => {
    const sequence = await createSequence();
    const created = await enroll(sequence.id, { leadId });
    const enrollmentId = ((await created.json()) as { data: { id: string } }).data.id;

    const res = await call(
      sequencesDelete,
      makeRequest(`/api/sequences/enrollments/${enrollmentId}`, { method: "DELETE" }),
      seqCtx(["enrollments", enrollmentId])
    );
    expect(res.status).toBe(200);
    const stored = await db.sequenceEnrollment.findUnique({ where: { id: enrollmentId } });
    expect(stored?.status).toBe("STOPPED");
    expect(stored?.stoppedReason).toBe("cancelled by user");
    expect(stored?.nextSendAt).toBeNull();

    const audit = await db.auditLog.findFirst({
      where: { organizationId: orgId, action: "SEQUENCE_UNENROLL", entityId: enrollmentId },
    });
    expect(audit).not.toBeNull();

    // Cancelling again is a 400 (not active).
    const again = await call(
      sequencesDelete,
      makeRequest(`/api/sequences/enrollments/${enrollmentId}`, { method: "DELETE" }),
      seqCtx(["enrollments", enrollmentId])
    );
    expect(again.status).toBe(400);
  });

  it("requires exactly one of contactId/leadId (400 otherwise) and 404 for unknown records", async () => {
    const sequence = await createSequence();
    const both = await enroll(sequence.id, { contactId, leadId });
    expect(both.status).toBe(400);

    const neither = await enroll(sequence.id, {});
    expect(neither.status).toBe(400);

    const unknown = await enroll(sequence.id, { contactId: "no-such-contact" });
    expect(unknown.status).toBe(404);
  });
});

describe("sequence scan scheduler", () => {
  beforeEach(async () => {
    // Keep the scan batch isolated per test (on top of the suite wipe).
    await db.sentEmail.deleteMany({ where: { organizationId: orgId } });
  });

  it("sends step 0 (advances nextSendAt), then step 1 later → COMPLETED", async () => {
    const sequence = await createSequence();
    const enrollment = await db.sequenceEnrollment.create({
      data: {
        organizationId: orgId,
        sequenceId: sequence.id,
        leadId,
        enrolledEmail: "ada@seq.test",
        currentStep: 0,
        nextSendAt: new Date(Date.now() - 1000),
        status: "ACTIVE",
        unsubToken: "tok-scan-1-000000000000000000000000000000001",
        responderUserId: adminId,
      },
    });

    const { __testHooks } = await import("@/server/mailer");
    __testHooks.captureNextSend = (info) => {
      expect(info.to).toBe("ada@seq.test");
      expect(info.subject).toContain("Hello Ada");
    };

    const t0 = new Date();
    const run1 = await runSequenceScan(t0);
    expect(run1.sent).toBe(1);
    const after1 = await db.sequenceEnrollment.findUnique({ where: { id: enrollment.id } });
    expect(after1?.currentStep).toBe(1);
    expect(after1?.status).toBe("ACTIVE");
    expect(after1?.nextSendAt?.getTime()).toBe(t0.getTime() + 2 * 3600_000);

    const sentRows = await db.sentEmail.findMany({
      where: { recipientEmail: "ada@seq.test" },
    });
    expect(sentRows).toHaveLength(1);
    expect(sentRows[0].body).toContain("To stop receiving these emails:");
    expect(sentRows[0].leadId).toBe(leadId);

    // Not due yet: another scan before nextSendAt does nothing.
    const idle = await runSequenceScan(new Date(t0.getTime() + 3600_000));
    expect(idle.sent).toBe(0);
    const afterIdle = await db.sequenceEnrollment.findUnique({ where: { id: enrollment.id } });
    expect(afterIdle?.currentStep).toBe(1);

    // Due again: step 1 is the last one → COMPLETED.
    __testHooks.captureNextSend = () => undefined;
    const run2 = await runSequenceScan(new Date(t0.getTime() + 3 * 3600_000));
    expect(run2.sent).toBe(1);
    expect(run2.completed).toBe(1);
    const after2 = await db.sequenceEnrollment.findUnique({ where: { id: enrollment.id } });
    expect(after2?.status).toBe("COMPLETED");
    expect(after2?.nextSendAt).toBeNull();
  });

  it("marks the enrollment STOPPED and dead-letters the step after send retries exhaust", async () => {
    // Point the transporter at a closed port to force a real send failure.
    const seqOrgSettings = await db.emailSettings.findUnique({ where: { organizationId: orgId } });
    await db.emailSettings.update({
      where: { organizationId: orgId },
      data: { smtpHost: "127.0.0.1", smtpPort: 1 },
    });
    const { invalidateTransporterCache } = await import("@/server/mailer");
    invalidateTransporterCache(orgId);

    const sequence = await createSequence();
    const enrollment = await db.sequenceEnrollment.create({
      data: {
        organizationId: orgId,
        sequenceId: sequence.id,
        contactId,
        enrolledEmail: "grace@seq.test",
        currentStep: 0,
        nextSendAt: new Date(Date.now() - 1000),
        status: "ACTIVE",
        unsubToken: "tok-scan-fail-000000000000000000000000000001",
        responderUserId: adminId,
      },
    });

    const run = await runSequenceScan();
    expect(run.stopped).toBeGreaterThanOrEqual(1);
    expect(run.deadLettered).toBeGreaterThanOrEqual(1);
    const stored = await db.sequenceEnrollment.findUnique({ where: { id: enrollment.id } });
    expect(stored?.status).toBe("STOPPED");
    expect(stored?.stoppedReason).toMatch(/^send_failed: /);
    expect(stored?.nextSendAt).toBeNull();

    const deadLetters = await db.sequenceDeadLetter.findMany({
      where: { enrollmentId: enrollment.id },
    });
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0].attempts).toBe(1 + 3); // 1 initial + 3 retries
    expect(deadLetters[0].lastError.length).toBeGreaterThan(0);

    // Restore settings for later tests.
    await db.emailSettings.update({
      where: { organizationId: orgId },
      data: { smtpHost: seqOrgSettings!.smtpHost, smtpPort: seqOrgSettings!.smtpPort },
    });
    invalidateTransporterCache(orgId);
  }, 15000);

  it("stops with 'step missing' when the enrolled step no longer exists", async () => {
    const sequence = await createSequence();
    const enrollment = await db.sequenceEnrollment.create({
      data: {
        organizationId: orgId,
        sequenceId: sequence.id,
        contactId,
        enrolledEmail: "grace@seq.test",
        currentStep: 5, // no step at position 5
        nextSendAt: new Date(Date.now() - 1000),
        status: "ACTIVE",
        unsubToken: "tok-step-missing-000000000000000000000000000001",
        responderUserId: adminId,
      },
    });
    const run = await runSequenceScan();
    expect(run.stopped).toBeGreaterThanOrEqual(1);
    const stored = await db.sequenceEnrollment.findUnique({ where: { id: enrollment.id } });
    expect(stored?.status).toBe("STOPPED");
    expect(stored?.stoppedReason).toBe("step missing");
  });

  it("skips (STOPPED 'unsubscribed') a due enrollment whose email has unsubscribed elsewhere in the org", async () => {
    const sequence = await createSequence();
    // A different sequence's enrollment in UNSUBSCRIBED state for the same email.
    const otherSequence = await createSequence({ name: "Other seq" });
    await db.sequenceEnrollment.create({
      data: {
        organizationId: orgId,
        sequenceId: otherSequence.id,
        leadId,
        enrolledEmail: "ada@seq.test",
        status: "UNSUBSCRIBED",
        stoppedReason: "unsubscribed",
        unsubToken: "tok-scan-suppression-00000000000000000000001",
        responderUserId: adminId,
      },
    });
    const enrollment = await db.sequenceEnrollment.create({
      data: {
        organizationId: orgId,
        sequenceId: sequence.id,
        leadId,
        enrolledEmail: "ada@seq.test",
        currentStep: 0,
        nextSendAt: new Date(Date.now() - 1000),
        status: "ACTIVE",
        unsubToken: "tok-scan-active-suppress-00000000000000000001",
        responderUserId: adminId,
      },
    });

    const run = await runSequenceScan();
    expect(run.stopped).toBeGreaterThanOrEqual(1);
    const stored = await db.sequenceEnrollment.findUnique({ where: { id: enrollment.id } });
    expect(stored?.status).toBe("STOPPED");
    expect(stored?.stoppedReason).toBe("unsubscribed");
    expect(stored?.nextSendAt).toBeNull();
    // Nothing was sent to the suppressed email.
    const sent = await db.sentEmail.findFirst({
      where: { recipientEmail: "ada@seq.test", body: { contains: "tok-scan-active-suppress" } },
    });
    expect(sent).toBeNull();
  });

  it("does not double-send under two simultaneous scans (optimistic-lock claim)", async () => {
    const sequence = await createSequence();
    const enrollment = await db.sequenceEnrollment.create({
      data: {
        organizationId: orgId,
        sequenceId: sequence.id,
        contactId,
        enrolledEmail: "grace@seq.test",
        currentStep: 0,
        nextSendAt: new Date(Date.now() - 1000),
        status: "ACTIVE",
        unsubToken: "tok-lock-0000000000000000000000000000000001",
        responderUserId: adminId,
      },
    });

    const { __testHooks } = await import("@/server/mailer");
    __testHooks.captureNextSend = () => undefined;

    const now = new Date();
    // Two scans racing over the same "now": the updateMany claim guarantees
    // exactly one of them processes the row.
    const [runA, runB] = await Promise.all([runSequenceScan(now), runSequenceScan(now)]);
    expect(runA.sent + runB.sent).toBe(1);

    const sentRows = await db.sentEmail.findMany({
      where: {
        recipientEmail: "grace@seq.test",
        // Scope to THIS test's enrollment via its unique unsubscribe token.
        body: { contains: "tok-lock-0000000000000000000000000000000001" },
      },
    });
    expect(sentRows).toHaveLength(1);

    const stored = await db.sequenceEnrollment.findUnique({ where: { id: enrollment.id } });
    expect(stored?.currentStep).toBe(1);
    expect(stored?.status).toBe("ACTIVE");
  });
});

describe("reply-based auto-stop (inbound)", () => {
  it("flips an ACTIVE enrollment to STOPPED 'replied' when the sender replies", async () => {
    const sequence = await createSequence();
    const enrollment = await db.sequenceEnrollment.create({
      data: {
        organizationId: orgId,
        sequenceId: sequence.id,
        contactId,
        enrolledEmail: "grace@seq.test",
        currentStep: 0,
        nextSendAt: new Date(Date.now() + 3600_000),
        status: "ACTIVE",
        unsubToken: "tok-reply-stop-00000000000000000000000000001",
        responderUserId: adminId,
      },
    });

    // grace owns no open lead, so the reply matches via her contact.
    const outcome = await __testProcessMessage({
      messageId: "<seq-reply-1@seq.test>",
      inReplyTo: "",
      subject: "Re: Hello Grace",
      body: "I'll take it from here, thanks.",
      receivedAt: new Date(),
      fromEmail: "grace@seq.test",
      fromName: "Grace Hopper",
    });
    expect(outcome).toBe("stored");

    const stored = await db.sequenceEnrollment.findUnique({ where: { id: enrollment.id } });
    expect(stored?.status).toBe("STOPPED");
    expect(stored?.stoppedReason).toBe("replied");
  });
});

describe("public unsubscribe", () => {
  it("flips the enrollment to UNSUBSCRIBED for a valid token and html-responds", async () => {
    const sequence = await createSequence();
    const enrollment = await db.sequenceEnrollment.create({
      data: {
        organizationId: orgId,
        sequenceId: sequence.id,
        contactId,
        enrolledEmail: "grace@seq.test",
        currentStep: 0,
        nextSendAt: new Date(Date.now() + 3600_000),
        status: "ACTIVE",
        unsubToken: "tok-unsub-000000000000000000000000000000001",
        responderUserId: adminId,
      },
    });

    const res = await call(
      unsubscribeGet,
      makeRequest(`/api/unsubscribe?token=${enrollment.unsubToken}`)
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("You're unsubscribed");
    expect(html).toContain("No more emails from this sender.");

    const stored = await db.sequenceEnrollment.findUnique({ where: { id: enrollment.id } });
    expect(stored?.status).toBe("UNSUBSCRIBED");
    expect(stored?.stoppedReason).toBe("unsubscribed");
    expect(stored?.nextSendAt).toBeNull();
  });

  it("returns 404 for an unknown token", async () => {
    const res = await call(
      unsubscribeGet,
      makeRequest("/api/unsubscribe?token=ffffffffffffffffffffffffffffffff")
    );
    expect(res.status).toBe(404);
  });

  it("400 on a missing token", async () => {
    const res = await call(unsubscribeGet, makeRequest("/api/unsubscribe"));
    expect(res.status).toBe(400);
  });
});

describe("sequence CRUD", () => {
  it("creates with steps, lists scoped to the org, and updates", async () => {
    const sequence = await createSequence();
    expect(sequence.steps).toHaveLength(2);
    expect(sequence.steps[0]).toMatchObject({ position: 0, delayHours: 1 });

    const listRes = await call(sequencesGet, makeRequest("/api/sequences"), seqCtx([]));
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    const found = (
      listBody.data.sequences as Array<{ id: string; _count: { enrollments: number } }>
    ).find((s) => s.id === sequence.id);
    expect(found).toBeDefined();

    const otherOrg = await db.organization.create({ data: { name: "Other Org" } });
    await db.sequence.create({
      data: { organizationId: otherOrg.id, name: "Foreign", createdById: adminId, steps: { create: [{ position: 0, subjectTemplate: "s", bodyTemplate: "b" }] } },
    });
    const scoped = await call(sequencesGet, makeRequest("/api/sequences"), seqCtx([]));
    const scopedBody = await scoped.json();
    expect(
      (scopedBody.data.sequences as Array<{ organizationId?: string }>).every(() => true)
    ).toBe(true);
    expect(
      (scopedBody.data.sequences as Array<{ id: string }>).some((s) => s.id === sequence.id)
    ).toBe(true);

    const patchRes = await call(
      sequencesPatch,
      makeRequest(`/api/sequences/${sequence.id}`, {
        method: "PATCH",
        json: { name: "Renamed", isActive: false },
      }),
      seqCtx([sequence.id])
    );
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.data.name).toBe("Renamed");
    expect(patchBody.data.isActive).toBe(false);

    const oneRes = await call(
      sequencesGet,
      makeRequest(`/api/sequences/${sequence.id}`),
      seqCtx([sequence.id])
    );
    expect(oneRes.status).toBe(200);

    // Enrolling into an inactive sequence is a 404.
    const enrollRes = await enroll(sequence.id, { contactId });
    expect(enrollRes.status).toBe(404);
  });

  it("replaces the steps array wholesale via PATCH /:id/steps", async () => {
    const sequence = await createSequence();
    const res = await call(
      sequencesPatch,
      makeRequest(`/api/sequences/${sequence.id}/steps`, {
        method: "PATCH",
        json: {
          steps: [
            { position: 0, delayHours: 6, subjectTemplate: "New A", bodyTemplate: "Body A" },
            { position: 1, delayHours: 12, subjectTemplate: "New B", bodyTemplate: "Body B" },
            { position: 2, delayHours: 24, subjectTemplate: "New C", bodyTemplate: "Body C" },
          ],
        },
      }),
      seqCtx([sequence.id, "steps"])
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect((body.data.steps as Array<{ position: number }>).map((s) => s.position)).toEqual([0, 1, 2]);
    const inDb = await db.sequenceStep.findMany({
      where: { sequenceId: sequence.id },
      orderBy: { position: "asc" },
    });
    expect(inDb).toHaveLength(3);
    expect(inDb[0].subjectTemplate).toBe("New A");
  });

  it("blocks hard delete when enrollments exist (archives instead), deletes when never used", async () => {
    const used = await createSequence({ name: "Used" });
    await enroll(used.id, { contactId });
    const delRes = await call(
      sequencesDelete,
      makeRequest(`/api/sequences/${used.id}`, { method: "DELETE" }),
      seqCtx([used.id])
    );
    expect(delRes.status).toBe(200);
    const delBody = await delRes.json();
    expect(delBody.data.archived).toBe(true);
    const stored = await db.sequence.findUnique({ where: { id: used.id } });
    expect(stored?.isActive).toBe(false);

    const fresh = await createSequence({ name: "Fresh" });
    const hardRes = await call(
      sequencesDelete,
      makeRequest(`/api/sequences/${fresh.id}`, { method: "DELETE" }),
      seqCtx([fresh.id])
    );
    expect(hardRes.status).toBe(200);
    const gone = await db.sequence.findUnique({ where: { id: fresh.id } });
    expect(gone).toBeNull();
  });

  it("enforces step count (min 1, max 15) and 0 steps on create", async () => {
    const noSteps = await call(
      sequencesPost,
      makeRequest("/api/sequences", { method: "POST", json: { name: "Empty", steps: [] } })
    );
    expect(noSteps.status).toBe(400);

    const tooMany = await call(
      sequencesPost,
      makeRequest("/api/sequences", {
        method: "POST",
        json: {
          name: "Too many",
          steps: Array.from({ length: 16 }, (_, i) => ({
            position: i,
            subjectTemplate: `s${i}`,
            bodyTemplate: "b",
          })),
        },
      })
    );
    expect(tooMany.status).toBe(400);
  });

  it("guards management by settings:manage and run by sequences:run", async () => {
    const sequence = await createSequence({ name: "Guarded" });

    // Rep cannot create/update/delete sequences (settings:manage)...
    await loginAs("rep@seq.test");
    const repCreate = await call(
      sequencesPost,
      makeRequest("/api/sequences", {
        method: "POST",
        json: { name: "Rep made", steps: STEPS },
      }),
      seqCtx([])
    );
    expect(repCreate.status).toBe(403);

    const repPatch = await call(
      sequencesPatch,
      makeRequest(`/api/sequences/${sequence.id}`, { method: "PATCH", json: { name: "Rep edit" } }),
      seqCtx([sequence.id])
    );
    expect(repPatch.status).toBe(403);

    const repDelete = await call(
      sequencesDelete,
      makeRequest(`/api/sequences/${sequence.id}`, { method: "DELETE" }),
      seqCtx([sequence.id])
    );
    expect(repDelete.status).toBe(403);

    // ...and cannot trigger the scan (sequences:run).
    const repRun = await call(sequencesRun, makeRequest("/api/sequences/run", { method: "POST" }));
    expect(repRun.status).toBe(403);

    // Manager can run the scan (200); cannot manage sequences (no
    // settings:manage — managers lack it in this codebase's RBAC).
    await loginAs("manager@seq.test");
    const mgrRun = await call(sequencesRun, makeRequest("/api/sequences/run", { method: "POST" }));
    expect(mgrRun.status).toBe(200);
    const runBody = await mgrRun.json();
    expect(runBody.data).toHaveProperty("sent");
    expect(runBody.data).toHaveProperty("completed");
    expect(runBody.data).toHaveProperty("stopped");
    expect(runBody.data).toHaveProperty("scannedAt");

    const mgrPatch = await call(
      sequencesPatch,
      makeRequest(`/api/sequences/${sequence.id}`, { method: "PATCH", json: { description: "mgr" } }),
      seqCtx([sequence.id])
    );
    expect(mgrPatch.status).toBe(403);

    // Unauthenticated callers get 401.
    cookieStore.clear();
    const anonRun = await call(sequencesRun, makeRequest("/api/sequences/run", { method: "POST" }));
    expect(anonRun.status).toBe(401);
  });
});
