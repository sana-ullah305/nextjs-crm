import { beforeAll, afterAll, describe, expect, it, vi, beforeEach } from "vitest";

const cookieStore = new Map<string, { name: string; value: string }>();

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (_name: string) => null }),
  cookies: async () => ({
    get: (name: string) => cookieStore.get(name),
    set: (name: string, value: string) => cookieStore.set(name, { name, value }),
    delete: (name: string) => cookieStore.delete(name),
  }),
}));

import { GET as activitiesGet, POST as activitiesPost, DELETE as activitiesDelete } from "@/app/api/activities/[id]/route";
import db from "@/server/db";
import { hashPassword } from "@/server/auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: any, ctx?: any) => Promise<Response>;

function call(handler: Handler, req: unknown, ctx?: unknown): Promise<Response> {
  return ctx !== undefined ? handler(req as never, ctx as never) : handler(req as never);
}

function makeRequest(pathname: string, init?: { method?: string; headers?: Record<string, string>; json?: unknown }) {
  const url = new URL(`http://localhost:3000${pathname}`);
  return {
    url: url.toString(),
    method: init?.method ?? "GET",
    headers: new Headers(init?.headers),
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
let adminUserId: string;
let contactId: string;
let companyId: string;
let dealId: string;
let leadId: string;

beforeAll(async () => {
  await db.session.deleteMany();
  await db.notification.deleteMany();
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
  await db.tag.deleteMany();
  await db.user.deleteMany();
  await db.leadSource.deleteMany();
  await db.organization.deleteMany();

  orgId = (await db.organization.create({ data: { name: "Test Org Activities" } })).id;
  const passwordHash = await hashPassword("password123");
  const admin = await db.user.create({
    data: { organizationId: orgId, name: "Admin Activities", email: "admin-activities@example.org", passwordHash, role: "ADMIN" },
  });
  adminUserId = admin.id;

  const pipeline = await db.pipeline.create({
    data: { organizationId: orgId, name: "P", isDefault: true },
  });
  const stage = await db.stage.create({
    data: { pipelineId: pipeline.id, name: "S1", position: 0, probability: 10, type: "OPEN" },
  });

  const company = await db.company.create({
    data: { organizationId: orgId, name: "Activity Company", domain: "activity.com" },
  });
  companyId = company.id;

  const contact = await db.contact.create({
    data: { organizationId: orgId, firstName: "Activity", lastName: "Contact", email: "activity@example.org", companyId },
  });
  contactId = contact.id;

  const deal = await db.deal.create({
    data: { organizationId: orgId, name: "Activity Deal", stageId: stage.id, pipelineId: pipeline.id, contactId },
  });
  dealId = deal.id;

  const lead = await db.lead.create({
    data: { organizationId: orgId, firstName: "Activity", lastName: "Lead", email: "lead@example.org", companyName: "Lead Co" },
  });
  leadId = lead.id;
}, 120_000);

afterAll(async () => {
  await db.$disconnect();
});

async function loginAs(email: string) {
  cookieStore.clear();
  const { POST: loginRoute } = await import("@/app/api/auth/login/route");
  const res = await call(loginRoute, makeRequest("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    json: { email, password: "password123" },
  }), { params: Promise.resolve({}) });
  expect(res.status).toBe(200);
  return res;
}

function logout() {
  cookieStore.clear();
}

describe("Activities/Notes API routes", () => {
  beforeEach(() => {
    logout();
  });

  it("requires auth for GET /api/activities", async () => {
    const res = await activitiesGet(makeRequest("/api/activities") as never, ctx(undefined));
    expect(res.status).toBe(401);
  });

  it("lists activities with filters", async () => {
    await loginAs("admin-activities@example.org");
    
    // Create some activities
    await db.activity.create({
      data: { organizationId: orgId, type: "CALL", title: "Test Call", contactId, userId: adminUserId },
    });
    await db.activity.create({
      data: { organizationId: orgId, type: "MEETING", title: "Test Meeting", companyId, userId: adminUserId },
    });

    const res = await activitiesGet(makeRequest("/api/activities") as never, ctx(undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.activities).toHaveLength(2);
    expect(body.data.total).toBe(2);
    expect(body.data.activities[0].user).toBeDefined();
  });

  it("filters activities by contactId", async () => {
    await loginAs("admin-activities@example.org");
    const res = await activitiesGet(makeRequest(`/api/activities?contactId=${contactId}`) as never, ctx(undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.activities.every((a: any) => a.contactId === contactId)).toBe(true);
  });

  it("filters activities by type", async () => {
    await loginAs("admin-activities@example.org");
    const res = await activitiesGet(makeRequest("/api/activities?type=CALL") as never, ctx(undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.activities.every((a: any) => a.type === "CALL")).toBe(true);
  });

  it("creates an activity (logActivity)", async () => {
    await loginAs("admin-activities@example.org");
    const res = await activitiesPost(
      makeRequest("/api/activities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: {
          type: "EMAIL",
          title: "Sent proposal",
          description: "Sent the Q4 proposal",
          contactId,
          companyId,
          dealId,
          durationMinutes: 30,
          occurredAt: new Date().toISOString(),
        },
      }) as never,
      ctx(undefined)
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.type).toBe("EMAIL");
    expect(body.data.title).toBe("Sent proposal");
    expect(body.data.contactId).toBe(contactId);
    expect(body.data.user.id).toBe(adminUserId);
  });

  it("creates a note", async () => {
    await loginAs("admin-activities@example.org");
    const res = await activitiesPost(
      makeRequest("/api/activities/note", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: {
          body: "This is a note about the contact",
          contactId,
        },
      }) as never,
      ctx("note")
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.body).toBe("This is a note about the contact");
    expect(body.data.contactId).toBe(contactId);
    expect(body.data.user.id).toBe(adminUserId);
  });

  it("rejects note without parent record", async () => {
    await loginAs("admin-activities@example.org");
    const res = await activitiesPost(
      makeRequest("/api/activities/note", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { body: "Orphan note" },
      }) as never,
      ctx("note")
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("creates note attached to company", async () => {
    await loginAs("admin-activities@example.org");
    const res = await activitiesPost(
      makeRequest("/api/activities/note", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { body: "Company note", companyId },
      }) as never,
      ctx("note")
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.companyId).toBe(companyId);
  });

  it("creates note attached to deal", async () => {
    await loginAs("admin-activities@example.org");
    const res = await activitiesPost(
      makeRequest("/api/activities/note", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { body: "Deal note", dealId },
      }) as never,
      ctx("note")
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.dealId).toBe(dealId);
  });

  it("creates note attached to lead", async () => {
    await loginAs("admin-activities@example.org");
    const res = await activitiesPost(
      makeRequest("/api/activities/note", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { body: "Lead note", leadId },
      }) as never,
      ctx("note")
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.leadId).toBe(leadId);
  });

  it("deletes a note (by owner)", async () => {
    await loginAs("admin-activities@example.org");
    const note = await db.note.create({
      data: { organizationId: orgId, body: "Note to delete", contactId, userId: adminUserId },
    });

    const res = await activitiesDelete(
      makeRequest(`/api/activities/${note.id}`, { method: "DELETE" }) as never,
      ctx(note.id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe(true);

    const deleted = await db.note.findUnique({ where: { id: note.id } });
    expect(deleted).toBeNull();
  });

  it("forbids deleting another user's note (non-admin)", async () => {
    await loginAs("admin-activities@example.org");
    const rep = await db.user.create({
      data: { organizationId: orgId, name: "Rep", email: "rep-activities@example.org", passwordHash: await hashPassword("password123"), role: "SALES_REP" },
    });
    const note = await db.note.create({
      data: { organizationId: orgId, body: "Rep's note", contactId, userId: rep.id },
    });

    // Login as admin (who has privilege)
    // Actually, ADMIN can delete, let's test with another SALES_REP
    const rep2 = await db.user.create({
      data: { organizationId: orgId, name: "Rep2", email: "rep2-activities@example.org", passwordHash: await hashPassword("password123"), role: "SALES_REP" },
    });
    
    await loginAs("rep2-activities@example.org");
    const res = await activitiesDelete(
      makeRequest(`/api/activities/${note.id}`, { method: "DELETE" }) as never,
      ctx(note.id)
    );
    expect(res.status).toBe(403);
  });

  it("allows admin to delete any note", async () => {
    await loginAs("admin-activities@example.org");
    const rep = await db.user.create({
      data: { organizationId: orgId, name: "Rep", email: "rep-activities2@example.org", passwordHash: await hashPassword("password123"), role: "SALES_REP" },
    });
    const note = await db.note.create({
      data: { organizationId: orgId, body: "Rep's note for admin", contactId, userId: rep.id },
    });

    const res = await activitiesDelete(
      makeRequest(`/api/activities/${note.id}`, { method: "DELETE" }) as never,
      ctx(note.id)
    );
    expect(res.status).toBe(200);
  });

  it("returns 404 for deleting non-existent note", async () => {
    await loginAs("admin-activities@example.org");
    const res = await activitiesDelete(
      makeRequest("/api/activities/does-not-exist", { method: "DELETE" }) as never,
      ctx("does-not-exist")
    );
    expect(res.status).toBe(404);
  });

  it("rejects deleting activity endpoint (only notes)", async () => {
    await loginAs("admin-activities@example.org");
    const activity = await db.activity.create({
      data: { organizationId: orgId, type: "CALL", title: "Activity", contactId, userId: adminUserId },
    });

    const res = await activitiesDelete(
      makeRequest(`/api/activities/${activity.id}`, { method: "DELETE" }) as never,
      ctx(activity.id)
    );
    // The DELETE endpoint only handles notes, activities should 404
    expect(res.status).toBe(404);
  });

  it("includes user info in activity list", async () => {
    await loginAs("admin-activities@example.org");
    const res = await activitiesGet(makeRequest("/api/activities") as never, ctx(undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    body.data.activities.forEach((a: any) => {
      expect(a.user).toBeDefined();
      expect(a.user.id).toBeDefined();
      expect(a.user.name).toBeDefined();
      expect(a.user.avatarColor).toBeDefined();
    });
  });

  it("supports pagination", async () => {
    await loginAs("admin-activities@example.org");
    // Create multiple activities
    for (let i = 0; i < 5; i++) {
      await db.activity.create({
        data: { organizationId: orgId, type: "TASK", title: `Task ${i}`, contactId, userId: adminUserId },
      });
    }

    const res = await activitiesGet(makeRequest("/api/activities?page=1&pageSize=3") as never, ctx(undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.activities.length).toBe(3);
    expect(body.data.page).toBe(1);
    expect(body.data.pageSize).toBe(3);
    expect(body.data.total).toBeGreaterThanOrEqual(5);
  });
});
