/**
 * Integration tests for inbound email reply tracking. Runs against the
 * isolated test SQLite database using the same direct route-handler pattern
 * as features.test.ts. No real IMAP server is contacted: the matching /
 * storage / side-effect logic is exercised through the __testProcessMessage
 * test hook, and the scan endpoint's "IMAP not configured" path is verified
 * with the IMAP_* env vars unset.
 */
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

const cookieStore = new Map<string, { name: string; value: string }>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => cookieStore.get(name),
    set: (name: string, value: string) => cookieStore.set(name, { name, value }),
    delete: (name: string) => cookieStore.delete(name),
  }),
}));

import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as inboundRun } from "@/app/api/inbound/run/route";
import { GET as inboundGet, POST as inboundPost } from "@/app/api/inbound/route";
import { __testProcessMessage, runInboundScan } from "@/server/inbound-mail";
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

let orgId: string;
let adminId: string;
let repId: string;
let managerId: string;
let contactId: string;
let sentEmailId: string;
let messageIdOfSent: string;

async function loginAs(email: string) {
  cookieStore.clear();
  const res = await call(
    loginRoute,
    makeRequest("/api/auth/login", { method: "POST", json: { email, password: "password123" } }),
    { params: Promise.resolve({}) }
  );
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  await db.session.deleteMany();
  await db.notification.deleteMany();
  await db.followUpReminder.deleteMany();
  await db.inboundEmail.deleteMany();
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

  orgId = (await db.organization.create({ data: { name: "Inbound Org" } })).id;
  const passwordHash = await hashPassword("password123");
  adminId = (
    await db.user.create({
      data: { organizationId: orgId, name: "Admin", email: "admin@inbound.test", passwordHash, role: "ADMIN" },
    })
  ).id;
  repId = (
    await db.user.create({
      data: { organizationId: orgId, name: "Rep", email: "rep@inbound.test", passwordHash, role: "SALES_REP" },
    })
  ).id;
  managerId = (
    await db.user.create({
      data: { organizationId: orgId, name: "Manager", email: "manager@inbound.test", passwordHash, role: "MANAGER" },
    })
  ).id;

  const contact = await db.contact.create({
    data: {
      organizationId: orgId,
      firstName: "Grace",
      lastName: "Hopper",
      email: "grace@navy.mil",
      ownerId: repId,
    },
  });
  contactId = contact.id;

  // An outbound send with a known Message-ID: the exact-thread match anchor.
  messageIdOfSent = "<outbound-123@crm.test>";
  const sent = await db.sentEmail.create({
    data: {
      organizationId: orgId,
      userId: adminId,
      subject: "Outbound thread",
      body: "Original message",
      recipientEmail: "grace@navy.mil",
      recipientName: "Grace Hopper",
      contactId,
      status: "SENT",
      messageId: messageIdOfSent,
      sentAt: new Date(),
    },
  });
  sentEmailId = sent.id;
}, 120_000);

afterAll(async () => {
  await db.$disconnect();
});

describe("inbound reply matching (via test hook)", () => {
  it("stores a reply whose In-Reply-To matches a SentEmail: row + activity + notification, lead untouched", async () => {
    const outcome = await __testProcessMessage({
      messageId: "<reply-thread-1@sender.test>",
      inReplyTo: messageIdOfSent,
      subject: "Re: Outbound thread",
      body: "Thanks, interested!",
      receivedAt: new Date("2026-11-13T10:00:00Z"),
      fromEmail: "grace@navy.mil",
      fromName: "Grace Hopper",
    });
    expect(outcome).toBe("stored");

    const row = await db.inboundEmail.findUnique({
      where: { organizationId_messageId: { organizationId: orgId, messageId: "<reply-thread-1@sender.test>" } },
    });
    expect(row).not.toBeNull();
    expect(row?.subject).toBe("Re: Outbound thread");
    expect(row?.body).toContain("interested");
    expect(row?.sentEmailId).toBe(sentEmailId);
    expect(row?.contactId).toBe(contactId);
    expect(row?.fromEmail).toBe("grace@navy.mil");
    expect(row?.status).toBe("UNREAD");

    const activity = await db.activity.findFirst({
      where: { organizationId: orgId, type: "EMAIL", title: { contains: "Re: Outbound thread" } },
    });
    expect(activity?.contactId).toBe(contactId);
    // System fallback for a SentEmail-thread match on a contact: the matched
    // record's owner (the rep), not the sender.
    expect(activity?.userId).toBe(repId);

    const notif = await db.notification.findFirst({
      where: { organizationId: orgId, userId: repId, type: "INFO", title: { contains: "Re: Outbound thread" } },
    });
    expect(notif).not.toBeNull();
    expect(notif?.link).toBe(`/contacts/${contactId}`);
  });

  it("matches a NEW lead by sender email and transitions it to CONTACTED", async () => {
    const lead = await db.lead.create({
      data: {
        organizationId: orgId,
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@analytical.test",
        status: "NEW",
        assignedUserId: repId,
      },
    });

    const outcome = await __testProcessMessage({
      messageId: "<reply-lead-1@sender.test>",
      inReplyTo: "", // no thread — exercises the sender fallback
      subject: "Your demo sounds great",
      body: "Let's talk next week.",
      receivedAt: new Date(),
      fromEmail: "ada@analytical.test",
      fromName: "Ada Lovelace",
    });
    expect(outcome).toBe("stored");

    const row = await db.inboundEmail.findFirst({
      where: { organizationId: orgId, messageId: "<reply-lead-1@sender.test>" },
    });
    expect(row?.leadId).toBe(lead.id);
    expect(row?.contactId).toBeNull();
    expect(row?.sentEmailId).toBeNull();
    expect(row?.status).toBe("UNREAD");

    const updated = await db.lead.findUnique({ where: { id: lead.id } });
    expect(updated?.status).toBe("CONTACTED");

    const activity = await db.activity.findFirst({
      where: { organizationId: orgId, type: "EMAIL", title: { contains: "Your demo sounds great" } },
    });
    expect(activity?.leadId).toBe(lead.id);
    expect(activity?.userId).toBe(repId); // lead assignee as system user

    const notif = await db.notification.findFirst({
      where: { organizationId: orgId, userId: repId, link: `/leads/${lead.id}` },
    });
    expect(notif).not.toBeNull();
  });

  it("matches a contact-only sender: stored + activity, no lead change", async () => {
    const lead = await db.lead.create({
      data: {
        organizationId: orgId,
        firstName: "Ghost",
        lastName: "Lead",
        email: "ghost@old.test",
        status: "UNQUALIFIED", // closed lead must NOT match; contact must win
      },
    });

    const outcome = await __testProcessMessage({
      messageId: "<reply-contact-1@sender.test>",
      inReplyTo: "",
      subject: "Quick question",
      body: "About my subscription",
      receivedAt: new Date(),
      fromEmail: "grace@navy.mil", // matches the contact (and no open lead)
      fromName: "Grace Hopper",
    });
    expect(outcome).toBe("stored");

    const row = await db.inboundEmail.findFirst({
      where: { organizationId: orgId, messageId: "<reply-contact-1@sender.test>" },
    });
    expect(row?.contactId).toBe(contactId);
    expect(row?.leadId).toBeNull();

    const untouched = await db.lead.findUnique({ where: { id: lead.id } });
    expect(untouched?.status).toBe("UNQUALIFIED");

    const activity = await db.activity.findFirst({
      where: { organizationId: orgId, type: "EMAIL", title: { contains: "Quick question" } },
    });
    expect(activity?.contactId).toBe(contactId);
  });

  it("stores nothing for an unknown sender with no thread", async () => {
    const before = await db.inboundEmail.count({ where: { organizationId: orgId } });
    const outcome = await __testProcessMessage({
      messageId: "<stray-1@nowhere.test>",
      inReplyTo: "<no-such-thread@elsewhere.test>",
      subject: "Totally unrelated",
      body: "Buy my product",
      receivedAt: new Date(),
      fromEmail: "stranger@nowhere.test",
      fromName: "Stranger",
    });
    expect(outcome).toBe("unmatched");
    const after = await db.inboundEmail.count({ where: { organizationId: orgId } });
    expect(after).toBe(before);

    const activity = await db.activity.findFirst({
      where: { organizationId: orgId, title: { contains: "Totally unrelated" } },
    });
    expect(activity).toBeNull();
  });

  it("is idempotent for a duplicate Message-ID (stored once)", async () => {
    const first = await __testProcessMessage({
      messageId: "<dup-1@sender.test>",
      inReplyTo: messageIdOfSent,
      subject: "Re: Outbound thread (dup)",
      body: "First delivery",
      receivedAt: new Date(),
      fromEmail: "grace@navy.mil",
      fromName: "Grace Hopper",
    });
    expect(first).toBe("stored");

    const second = await __testProcessMessage({
      messageId: "<dup-1@sender.test>",
      inReplyTo: messageIdOfSent,
      subject: "Re: Outbound thread (dup)",
      body: "Second delivery (same Message-ID)",
      receivedAt: new Date(),
      fromEmail: "grace@navy.mil",
      fromName: "Grace Hopper",
    });
    expect(second).toBe("skipped");

    const rows = await db.inboundEmail.findMany({
      where: { organizationId: orgId, messageId: "<dup-1@sender.test>" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe("First delivery");

    const activities = await db.activity.findMany({
      where: { organizationId: orgId, title: { contains: "Re: Outbound thread (dup)" } },
    });
    expect(activities).toHaveLength(1);
  });
});

describe("inbound scan endpoint", () => {
  it("rejects reps with 403 (inbound:run required)", async () => {
    await loginAs("rep@inbound.test");
    const res = await call(inboundRun, makeRequest("/api/inbound/run", { method: "POST" }));
    expect(res.status).toBe(403);
  });

  it("lets managers run the scan; without IMAP env it reports configured: false", async () => {
    const hadEnv = ["IMAP_HOST", "IMAP_PORT", "IMAP_USER", "IMAP_PASS", "IMAP_TLS"].map((k) => [k, process.env[k]]);
    for (const [key] of hadEnv) delete process.env[key as keyof NodeJS.ProcessEnv];

    await loginAs("manager@inbound.test");
    const res = await call(inboundRun, makeRequest("/api/inbound/run", { method: "POST" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ stored: 0, skipped: 0, configured: false });
    expect(body.data.scannedAt).toBeDefined();

    const direct = await runInboundScan();
    expect(direct.configured).toBe(false);
    expect(direct.stored).toBe(0);
    expect(direct.skipped).toBe(0);

    for (const [key, value] of hadEnv) {
      if (value !== undefined) process.env[key as keyof NodeJS.ProcessEnv] = value;
    }
  });

  it("rejects unauthenticated callers with 401", async () => {
    cookieStore.clear();
    const res = await call(inboundRun, makeRequest("/api/inbound/run", { method: "POST" }));
    expect(res.status).toBe(401);
  });
});

describe("inbound list endpoint", () => {
  it("scopes reps to their own matched records only", async () => {
    // Owner-admin row: rep must not see it.
    await db.contact.create({
      data: {
        organizationId: orgId,
        firstName: "Alan",
        lastName: "Turing",
        email: "alan@bletchley.test",
        ownerId: managerId,
      },
    });
    const adminOwnedRow = await db.inboundEmail.create({
      data: {
        organizationId: orgId,
        fromEmail: "alan@bletchley.test",
        fromName: "Alan Turing",
        subject: "For manager eyes",
        body: "Hello",
        messageId: "<rep-scope-2@sender.test>",
        contactId: (await db.contact.findFirst({ where: { email: "alan@bletchley.test" } }))!.id,
      },
    });
    void adminOwnedRow;

    await loginAs("rep@inbound.test");
    const res = await call(inboundGet, makeRequest("/api/inbound"));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Every returned row must be rep-visible (their contact or their lead).
    for (const email of body.data.emails as Array<{
      contact: { ownerId: string | null } | null;
      lead: { assignedUserId: string | null } | null;
    }>) {
      const ownerId = email.contact?.ownerId ?? null;
      const assigneeId = email.lead?.assignedUserId ?? null;
      expect(ownerId === repId || ownerId === null || assigneeId === repId || assigneeId === null).toBe(true);
    }
    const subjects: string[] = (body.data.emails as Array<{ subject: string }>).map((e) => e.subject);
    expect(subjects).not.toContain("For manager eyes");
    expect(subjects).toContain("Re: Outbound thread"); // rep-owned contact
    expect(subjects).toContain("Your demo sounds great"); // rep-assigned lead

    // Admin sees the whole org.
    await loginAs("admin@inbound.test");
    const adminRes = await call(inboundGet, makeRequest("/api/inbound"));
    const adminBody = await adminRes.json();
    const adminSubjects: string[] = (adminBody.data.emails as Array<{ subject: string }>).map((e) => e.subject);
    expect(adminSubjects).toContain("For manager eyes");
  });

  it("filters by contactId / leadId / status and pages", async () => {
    await loginAs("admin@inbound.test");
    const byContact = await call(inboundGet, makeRequest(`/api/inbound?contactId=${contactId}`));
    const contactBody = await byContact.json();
    for (const email of contactBody.data.emails as Array<{ contactId: string | null }>) {
      expect(email.contactId).toBe(contactId);
    }

    const byStatus = await call(inboundGet, makeRequest("/api/inbound?status=UNREAD&pageSize=1"));
    const statusBody = await byStatus.json();
    expect(statusBody.data.page).toBe(1);
    expect(statusBody.data.emails).toHaveLength(1);
    expect((statusBody.data.emails as Array<{ status: string }>)[0].status).toBe("UNREAD");
    expect(statusBody.data.total).toBeGreaterThan(1);
  });

  it("marks rows READ via POST /api/inbound (org-scoped, unread only)", async () => {
    await loginAs("admin@inbound.test");
    const unread = await db.inboundEmail.findMany({
      where: { organizationId: orgId, status: "UNREAD" },
      take: 2,
    });
    expect(unread.length).toBe(2);

    const res = await call(
      inboundPost,
      makeRequest("/api/inbound", { method: "POST", json: { ids: unread.map((r) => r.id) } })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.updated).toBe(2);

    const recheck = await db.inboundEmail.findMany({
      where: { id: { in: unread.map((r) => r.id) } },
    });
    for (const row of recheck) expect(row.status).toBe("READ");

    // Marking again is a no-op (only UNREAD rows transition).
    const again = await call(
      inboundPost,
      makeRequest("/api/inbound", { method: "POST", json: { ids: unread.map((r) => r.id) } })
    );
    const againBody = await again.json();
    expect(againBody.data.updated).toBe(0);
  });

  it("requires authentication for the list route", async () => {
    cookieStore.clear();
    const res = await call(inboundGet, makeRequest("/api/inbound"));
    expect(res.status).toBe(401);
  });
});
