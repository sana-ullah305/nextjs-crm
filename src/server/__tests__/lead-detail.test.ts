/**
 * Integration tests for the Lead Detail page data surface.
 *
 * The page itself is a React Server Component, so these tests exercise the
 * same data the page assembles: the GET /api/leads/:id route (lead + relations),
 * the server-side duplicate finder used to render the warning banner, and the
 * task query the page runs for related open tasks.
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

import { GET as leadsGet } from "@/app/api/leads/[id]/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { findDuplicateCandidates } from "@/server/dedupe";
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

function ctx(segments: string | undefined) {
  return { params: Promise.resolve({ id: segments as string }) };
}

let orgId: string;
let adminId: string;
let leadId: string;
let dupLeadId: string;

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
  await db.followUpReminder.deleteMany();
  await db.sentEmail.deleteMany();
  await db.inboundEmail.deleteMany();
  await db.activity.deleteMany();
  await db.note.deleteMany();
  await db.task.deleteMany();
  await db.auditLog.deleteMany();
  await db.deal.deleteMany();
  await db.lead.deleteMany();
  await db.stage.deleteMany();
  await db.pipeline.deleteMany();
  await db.contact.deleteMany();
  await db.company.deleteMany();
  await db.user.deleteMany();
  await db.leadSource.deleteMany();
  await db.organization.deleteMany();

  orgId = (await db.organization.create({ data: { name: "Lead Detail Org" } })).id;
  const passwordHash = await hashPassword("password123");
  const admin = await db.user.create({
    data: {
      organizationId: orgId,
      name: "Admin",
      email: "admin@ld.test",
      passwordHash,
      role: "ADMIN",
    },
  });
  adminId = admin.id;

  const source = await db.leadSource.create({
    data: { organizationId: orgId, name: "Webinar" },
  });

  const company = await db.company.create({
    data: { organizationId: orgId, name: "Acme Inc" },
  });

  const lead = await db.lead.create({
    data: {
      organizationId: orgId,
      firstName: "Grace",
      lastName: "Hopper",
      email: "grace@acme.test",
      phone: "555-0100",
      companyName: "Acme Inc",
      companyId: company.id,
      sourceId: source.id,
      status: "QUALIFIED",
      score: 80,
      estimatedValue: 12000,
      assignedUserId: adminId,
      ownerId: adminId,
      summary: "Inbound from webinar",
    },
  });
  leadId = lead.id;

  // A near-duplicate lead (same email) to exercise the warning banner data.
  const dup = await db.lead.create({
    data: {
      organizationId: orgId,
      firstName: "Grace",
      lastName: "Hopper",
      email: "grace@acme.test",
      status: "NEW",
    },
  });
  dupLeadId = dup.id;

  // Activity + note + task + sent email + inbound email for the lead.
  await db.activity.create({
    data: {
      organizationId: orgId,
      type: "CALL",
      title: "Discovery call",
      description: "Discussed pricing",
      leadId: lead.id,
      userId: adminId,
    },
  });
  await db.note.create({
    data: {
      organizationId: orgId,
      body: "Very interested",
      leadId: lead.id,
      userId: adminId,
    },
  });
  await db.task.create({
    data: {
      organizationId: orgId,
      title: "Follow up with Grace",
      type: "FOLLOW_UP",
      priority: "HIGH",
      status: "PENDING",
      relatedType: "lead",
      relatedId: lead.id,
      createdById: adminId,
      assignedUserId: adminId,
    },
  });
  await db.sentEmail.create({
    data: {
      organizationId: orgId,
      userId: adminId,
      subject: "Welcome",
      body: "Hi Grace",
      recipientEmail: "grace@acme.test",
      recipientName: "Grace Hopper",
      leadId: lead.id,
      status: "SENT",
      sentAt: new Date(),
    },
  });
  await db.inboundEmail.create({
    data: {
      organizationId: orgId,
      fromEmail: "grace@acme.test",
      fromName: "Grace Hopper",
      subject: "Re: Welcome",
      body: "Thanks!",
      messageId: "<inbound-1@acme.test>",
      leadId: lead.id,
      status: "UNREAD",
    },
  });

  await loginAs("admin@ld.test");
});

afterAll(async () => {
  await db.session.deleteMany();
  await db.inboundEmail.deleteMany();
  await db.sentEmail.deleteMany();
  await db.activity.deleteMany();
  await db.note.deleteMany();
  await db.task.deleteMany();
  await db.lead.deleteMany();
  await db.company.deleteMany();
  await db.user.deleteMany();
  await db.leadSource.deleteMany();
  await db.organization.deleteMany();
});

describe("GET /api/leads/:id (lead detail data)", () => {
  it("returns the lead with its relations", async () => {
    const res = await call(leadsGet, makeRequest(`/api/leads/${leadId}`), ctx(leadId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        id: string;
        firstName: string;
        email: string;
        status: string;
        score: number;
        source: { name: string } | null;
        assignedUser: { name: string } | null;
        company: { name: string } | null;
      };
    };
    expect(body.data.id).toBe(leadId);
    expect(body.data.firstName).toBe("Grace");
    expect(body.data.status).toBe("QUALIFIED");
    expect(body.data.score).toBe(80);
    expect(body.data.source?.name).toBe("Webinar");
    expect(body.data.assignedUser?.name).toBe("Admin");
    expect(body.data.company?.name).toBe("Acme Inc");
  });

  it("404s for a missing lead", async () => {
    const res = await call(leadsGet, makeRequest("/api/leads/nope"), ctx("nope"));
    expect(res.status).toBe(404);
  });
});

describe("duplicate detection for the warning banner", () => {
  it("finds the near-duplicate lead by exact email", async () => {
    const candidates = await findDuplicateCandidates(orgId, "lead", leadId);
    const ids = candidates.map((c) => c.id);
    expect(ids).toContain(dupLeadId);
    const dup = candidates.find((c) => c.id === dupLeadId);
    expect(dup?.matchReasons).toContain("email_exact");
    expect(dup?.score).toBeGreaterThanOrEqual(100);
  });

  it("excludes the subject itself from candidates", async () => {
    const candidates = await findDuplicateCandidates(orgId, "lead", leadId);
    expect(candidates.map((c) => c.id)).not.toContain(leadId);
  });
});

describe("related tasks query used by the page", () => {
  it("returns open tasks linked via relatedType/relatedId", async () => {
    const tasks = await db.task.findMany({
      where: {
        organizationId: orgId,
        relatedType: "lead",
        relatedId: leadId,
        status: { in: ["PENDING", "IN_PROGRESS"] },
      },
      orderBy: { dueAt: "asc" },
      take: 20,
      include: { assignedUser: { select: { id: true, name: true, avatarColor: true } } },
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe("Follow up with Grace");
    expect(tasks[0]!.assignedUser?.name).toBe("Admin");
  });
});

describe("relations the page renders", () => {
  it("has activities, notes, sent + inbound emails attached to the lead", async () => {
    const [acts, notes, sent, inbound] = await Promise.all([
      db.activity.findMany({ where: { leadId } }),
      db.note.findMany({ where: { leadId } }),
      db.sentEmail.findMany({ where: { leadId } }),
      db.inboundEmail.findMany({ where: { leadId } }),
    ]);
    expect(acts).toHaveLength(1);
    expect(acts[0]!.type).toBe("CALL");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toBe("Very interested");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe("Welcome");
    expect(inbound).toHaveLength(1);
    expect(inbound[0]!.subject).toBe("Re: Welcome");
  });
});
