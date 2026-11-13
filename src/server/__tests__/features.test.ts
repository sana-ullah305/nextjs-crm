/**
 * Integration tests for the email outreach, reminder scheduler, and global
 * search features. Runs against the isolated test SQLite database using the
 * same direct route-handler pattern as api-integration.test.ts.
 */
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

const cookieStore = new Map<string, { name: string; value: string }>();

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (_name: string) => null }),
  cookies: async () => ({
    get: (name: string) => cookieStore.get(name),
    set: (name: string, value: string) => cookieStore.set(name, { name, value }),
    delete: (name: string) => cookieStore.delete(name),
  }),
}));

vi.mock("@/server/mailer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/mailer")>();
  return {
    ...actual,
    // Stub the raw SMTP transport; the service logic around it (SentEmail
    // rows, activities, validation) is what these tests cover.
    sendEmail: actual.sendEmail,
  };
});

import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as emailPost } from "@/app/api/emails/[[...id]]/route";
import { POST as remindersRun } from "@/app/api/reminders/run/route";
import { GET as searchGet } from "@/app/api/search/route";
import { GET as notificationsGet } from "@/app/api/notifications/[[...id]]/route";
import { runReminderScan } from "@/server/reminders";
import { __testHooks, invalidateTransporterCache } from "@/server/mailer";
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

function ctx(_segments: string[] | undefined) {
  return { params: Promise.resolve({ id: _segments }) };
}
void ctx;

let orgId: string;
let adminId: string;
let contactId: string;
let stageId: string;

async function loginAs(email: string) {
  cookieStore.clear();
  const res = await call(
    loginRoute,
    makeRequest("/api/auth/login", { method: "POST", json: { email, password: "password123" } }),
    { params: Promise.resolve({}) }
  );
  expect(res.status).toBe(200);
}

async function seedLeadWithFollowUp(email: string, followUpAt: Date, assignedUserId?: string) {
  return db.lead.create({
    data: {
      organizationId: orgId,
      firstName: "Follow",
      lastName: "Up",
      email,
      status: "NEW",
      followUpAt,
      assignedUserId: assignedUserId ?? null,
    },
  });
}

beforeAll(async () => {
  await db.session.deleteMany();
  await db.notification.deleteMany();
  await db.followUpReminder.deleteMany();
  await db.sentEmail.deleteMany();
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

  orgId = (await db.organization.create({ data: { name: "Feature Org" } })).id;
  const passwordHash = await hashPassword("password123");
  const admin = await db.user.create({
    data: { organizationId: orgId, name: "Admin", email: "admin@feature.test", passwordHash, role: "ADMIN" },
  });
  adminId = admin.id;
  const rep = await db.user.create({
    data: { organizationId: orgId, name: "Rep", email: "rep@feature.test", passwordHash, role: "SALES_REP" },
  });
  void rep;

  const pipeline = await db.pipeline.create({
    data: { organizationId: orgId, name: "fp", isDefault: true },
  });
  stageId = (
    await db.stage.create({
      data: { pipelineId: pipeline.id, name: "fs", position: 0, probability: 10, type: "OPEN" },
    })
  ).id;

  const contact = await db.contact.create({
    data: {
      organizationId: orgId,
      firstName: "Grace",
      lastName: "Hopper",
      email: "grace@navy.mil",
      ownerId: adminId,
    },
  });
  contactId = contact.id;
}, 120_000);

afterAll(async () => {
  await db.$disconnect();
});

describe("email outreach API", () => {
  it("rejects sending when SMTP is not configured (409 EMAIL_NOT_CONFIGURED)", async () => {
    await loginAs("admin@feature.test");
    const res = await call(
      emailPost,
      makeRequest("/api/emails", {
        method: "POST",
        json: {
          to: "grace@navy.mil",
          subject: "Test subject",
          body: "Hello Grace",
          contactId,
        },
      })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("EMAIL_NOT_CONFIGURED");

    // The failed attempt is still recorded for the audit trail.
    const failed = await db.sentEmail.findFirst({
      where: { organizationId: orgId, recipientEmail: "grace@navy.mil" },
    });
    expect(failed?.status).toBe("FAILED");
    expect(failed?.error).toContain("SMTP is not configured");
  });

  it("rejects invalid payloads with 400", async () => {
    const res = await call(
      emailPost,
      makeRequest("/api/emails", {
        method: "POST",
        json: { to: "not-an-email", subject: "", body: "" },
      })
    );
    expect(res.status).toBe(400);
  });

  it("blocks unauthenticated sends with 401", async () => {
    cookieStore.clear();
    const res = await call(
      emailPost,
      makeRequest("/api/emails", {
        method: "POST",
        json: { to: "x@y.zz", subject: "s", body: "b" },
      })
    );
    expect(res.status).toBe(401);
  });

  it("forbids sending to a contact outside the user's access (403)", async () => {
    await loginAs("rep@feature.test");
    // Contact owned by admin; rep doesn't own it and record is owned.
    const res = await call(
      emailPost,
      makeRequest("/api/emails", {
        method: "POST",
        json: {
          to: "grace@navy.mil",
          subject: "Hello",
          body: "There",
          contactId,
        },
      })
    );
    expect(res.status).toBe(403);
  });

  it("sends and records when SMTP is configured", async () => {
    await loginAs("admin@feature.test");
    await db.emailSettings.create({
      data: {
        organizationId: orgId,
        smtpHost: "smtp.test.local",
        smtpPort: 587,
        smtpUser: "mailer",
        fromAddress: "sales@test.local",
      },
    });
    invalidateTransporterCache(orgId);
    let captured: { to: string; subject: string } | undefined;
    __testHooks.captureNextSend = (info) => {
      captured = info;
    };

    const res = await call(
      emailPost,
      makeRequest("/api/emails", {
        method: "POST",
        json: {
          to: "grace@navy.mil",
          toName: "Grace Hopper",
          subject: "Follow-up on our chat",
          body: "Hi Grace, following up.",
          contactId,
        },
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe("SENT");
    expect(body.data.recipientEmail).toBe("grace@navy.mil");
    expect(captured?.subject).toBe("Follow-up on our chat");

    // EMAIL activity logged on the contact
    const activity = await db.activity.findFirst({
      where: { contactId, type: "EMAIL" },
    });
    expect(activity?.title).toContain("Follow-up on our chat");

    // lastContactedAt bumped
    const contact = await db.contact.findUnique({ where: { id: contactId } });
    expect(contact?.lastContactedAt).not.toBeNull();

    // Audit trail has EMAIL_SEND
    const audit = await db.auditLog.findFirst({
      where: { organizationId: orgId, action: "EMAIL_SEND" },
    });
    expect(audit).not.toBeNull();
  });

  it("reports delivery failure as 502 and records FAILED status", async () => {
    await loginAs("admin@feature.test");
    // Point the transporter at a closed local port to force a socket error.
    await db.emailSettings.update({
      where: { organizationId: orgId },
      data: { smtpHost: "127.0.0.1", smtpPort: 1, fromAddress: "x@t.local" },
    });

    const res = await call(
      emailPost,
      makeRequest("/api/emails", {
        method: "POST",
        json: {
          to: "someone@example.org",
          subject: "Will fail",
          body: "This will fail to deliver",
        },
      })
    );
    expect([502, 500]).toContain(res.status);
    const failed = await db.sentEmail.findFirst({
      where: { recipientEmail: "someone@example.org", status: "FAILED" },
    });
    expect(failed).not.toBeNull();
  });
});

describe("reminder scheduler", () => {
  it("creates notifications for due lead follow-ups once (dedupe)", async () => {
    await loginAs("admin@feature.test");
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const lead = await seedLeadWithFollowUp("due-lead@feature.test", yesterday, adminId);

    const run1 = await runReminderScan();
    expect(run1.leadsReminded).toBeGreaterThanOrEqual(1);
    expect(run1.remindersCreated).toBeGreaterThanOrEqual(1);

    // Second run same day: deduped, no new reminders for the same lead.
    await runReminderScan();
    const remindersForLead = await db.followUpReminder.count({
      where: { leadId: lead.id },
    });
    expect(remindersForLead).toBe(1);

    // The assignee got an in-app notification.
    const notif = await db.notification.findFirst({
      where: { userId: adminId, type: "WARNING", title: { contains: "Follow-up" } },
    });
    expect(notif).not.toBeNull();
  });

  it("creates notifications for overdue tasks and dedupes", async () => {
    const task = await db.task.create({
      data: {
        organizationId: orgId,
        title: "Call Grace",
        status: "PENDING",
        dueAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        createdById: adminId,
        assignedUserId: adminId,
      },
    });
    const before = await db.followUpReminder.count({ where: { taskId: task.id } });
    expect(before).toBe(0);

    const run1 = await runReminderScan();
    expect(run1.tasksReminded).toBeGreaterThanOrEqual(1);
    await runReminderScan();
    const count = await db.followUpReminder.count({ where: { taskId: task.id } });
    expect(count).toBe(1);
  });

  it("skips completed tasks and converted leads", async () => {
    await db.task.create({
      data: {
        organizationId: orgId,
        title: "Done task",
        status: "COMPLETED",
        dueAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        createdById: adminId,
      },
    });
    await seedLeadWithFollowUp("converted-lead@feature.test", new Date(Date.now() - 48 * 3600_000)).then((lead) =>
      db.lead.update({ where: { id: lead.id }, data: { status: "CONVERTED" } })
    );
    await runReminderScan();
    const doneTaskReminder = await db.followUpReminder.findFirst({
      where: { organizationId: orgId, title: { contains: "Done task" } },
    });
    expect(doneTaskReminder).toBeNull();
    const convertedLeadReminder = await db.followUpReminder.findFirst({
      where: { organizationId: orgId, title: { contains: "converted" } },
    });
    expect(convertedLeadReminder).toBeNull();
  });

  it("reminders:run endpoint requires manager/admin permission", async () => {
    await loginAs("rep@feature.test");
    const res = await call(remindersRun, makeRequest("/api/reminders/run", { method: "POST" }));
    expect(res.status).toBe(403);

    await loginAs("admin@feature.test");
    const okRes = await call(remindersRun, makeRequest("/api/reminders/run", { method: "POST" }));
    expect(okRes.status).toBe(200);
    const body = await okRes.json();
    expect(body.data).toHaveProperty("leadsReminded");
    expect(body.data).toHaveProperty("tasksReminded");
    expect(body.data).toHaveProperty("remindersCreated");
  });
});

describe("global search API", () => {
  it("finds contacts by name across the org", async () => {
    await loginAs("admin@feature.test");
    const res = await call(searchGet, makeRequest("/api/search?q=Grace"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.results.contacts.length).toBeGreaterThan(0);
    expect(body.data.results.contacts[0].label).toContain("Grace");
    expect(body.data.results.contacts[0].href).toBe(`/contacts/${contactId}`);
  });

  it("respects rep visibility (owned records only)", async () => {
    // Contact owned by admin; a rep must not see it in search results.
    await loginAs("rep@feature.test");
    const res = await call(searchGet, makeRequest("/api/search?q=Grace"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.results.contacts).toHaveLength(0);
  });

  it("finds deals, tasks, and leads by term", async () => {
    await loginAs("admin@feature.test");
    await db.deal.create({
      data: {
        organizationId: orgId,
        name: "Navy systems deal",
        stageId,
        pipelineId: (await db.pipeline.findFirst({ where: { organizationId: orgId } }))!.id,
        ownerId: adminId,
      },
    });
    await db.task.create({
      data: {
        organizationId: orgId,
        title: "Quarterly navy review",
        status: "PENDING",
        createdById: adminId,
      },
    });
    await seedLeadWithFollowUp("navylead@feature.test", new Date(Date.now() + 86400_000), adminId);

    const res = await call(searchGet, makeRequest("/api/search?q=navy"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.results.deals.length).toBeGreaterThan(0);
    expect(body.data.results.tasks.length).toBeGreaterThan(0);
    expect(body.data.results.leads.length).toBeGreaterThan(0);
  });

  it("requires authentication and a search term", async () => {
    cookieStore.clear();
    const res = await call(searchGet, makeRequest("/api/search?q=test"));
    expect(res.status).toBe(401);

    await loginAs("admin@feature.test");
    const empty = await call(searchGet, makeRequest("/api/search"));
    expect(empty.status).toBe(400);
    const short = await call(searchGet, makeRequest("/api/search?q=a"));
    expect(short.status).toBe(400);
  });

  it("notifications endpoint surfaces scheduler-created reminders", async () => {
    await loginAs("admin@feature.test");
    // Run a scan so a fresh reminder notification exists for the admin.
    await runReminderScan();
    const res = await call(notificationsGet, makeRequest("/api/notifications"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(
      body.data.notifications.some(
        (n: { title: string }) =>
          n.title.includes("Follow-up") || n.title.includes("Task due") || n.title.includes("Task overdue")
      )
    ).toBe(true);
  });
});
