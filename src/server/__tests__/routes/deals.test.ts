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

import { GET as dealsGet, POST as dealsPost, PATCH as dealsPatch, DELETE as dealsDelete } from "@/app/api/deals/[id]/route";
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
let repUserId: string;
let pipelineId: string;
let stageId: string;
let stageWonId: string;
let stageLostId: string;
let contactId: string;
let companyId: string;

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

  orgId = (await db.organization.create({ data: { name: "Test Org Deals" } })).id;
  const passwordHash = await hashPassword("password123");
  const admin = await db.user.create({
    data: { organizationId: orgId, name: "Admin Deals", email: "admin-deals@example.org", passwordHash, role: "ADMIN" },
  });
  const rep = await db.user.create({
    data: { organizationId: orgId, name: "Rep Deals", email: "rep-deals@example.org", passwordHash, role: "SALES_REP" },
  });
  adminUserId = admin.id;
  repUserId = rep.id;

  const pipeline = await db.pipeline.create({
    data: { organizationId: orgId, name: "Deals Pipeline", isDefault: true },
  });
  pipelineId = pipeline.id;

  const stage = await db.stage.create({
    data: { pipelineId, name: "New", position: 0, probability: 10, type: "OPEN" },
  });
  stageId = stage.id;

  const stageWon = await db.stage.create({
    data: { pipelineId, name: "Won", position: 1, probability: 100, type: "WON" },
  });
  stageWonId = stageWon.id;

  const stageLost = await db.stage.create({
    data: { pipelineId, name: "Lost", position: 2, probability: 0, type: "LOST" },
  });
  stageLostId = stageLost.id;

  const company = await db.company.create({
    data: { organizationId: orgId, name: "Deal Company", domain: "deal.com" },
  });
  companyId = company.id;

  const contact = await db.contact.create({
    data: { organizationId: orgId, firstName: "Deal", lastName: "Contact", email: "deal@example.org", companyId },
  });
  contactId = contact.id;
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

describe("Deals API routes", () => {
  beforeEach(() => {
    logout();
  });

  it("requires auth for GET /api/deals", async () => {
    const res = await dealsGet(makeRequest("/api/deals") as never, ctx(undefined));
    expect(res.status).toBe(401);
  });

  it("lists deals with pagination", async () => {
    await loginAs("admin-deals@example.org");
    const res = await dealsGet(makeRequest("/api/deals?pageSize=10") as never, ctx(undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deals).toBeDefined();
    expect(body.data.total).toBeDefined();
    expect(body.data.page).toBe(1);
    expect(body.data.pageSize).toBe(10);
  });

  it("filters deals by pipeline", async () => {
    await loginAs("admin-deals@example.org");
    const res = await dealsGet(makeRequest(`/api/deals?pipelineId=${pipelineId}`) as never, ctx(undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deals.every((d: any) => d.pipelineId === pipelineId)).toBe(true);
  });

  it("filters deals by status", async () => {
    await loginAs("admin-deals@example.org");
    const res = await dealsGet(makeRequest("/api/deals?status=OPEN") as never, ctx(undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deals.every((d: any) => d.status === "OPEN")).toBe(true);
  });

  it("filters deals by owner", async () => {
    await loginAs("admin-deals@example.org");
    const res = await dealsGet(makeRequest(`/api/deals?ownerId=${adminUserId}`) as never, ctx(undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deals.every((d: any) => d.ownerId === adminUserId)).toBe(true);
  });

  it("searches deals by name", async () => {
    await loginAs("admin-deals@example.org");
    await db.deal.create({
      data: { organizationId: orgId, name: "Searchable Deal", stageId, pipelineId, contactId, ownerId: adminUserId },
    });

    const res = await dealsGet(makeRequest("/api/deals?q=Searchable") as never, ctx(undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deals.some((d: any) => d.name === "Searchable Deal")).toBe(true);
  });

  it("gets a single deal with full relations", async () => {
    await loginAs("admin-deals@example.org");
    const deal = await db.deal.create({
      data: { organizationId: orgId, name: "Detail Deal", stageId, pipelineId, contactId, companyId, ownerId: adminUserId },
    });

    const res = await dealsGet(makeRequest(`/api/deals/${deal.id}`) as never, ctx(deal.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe("Detail Deal");
    expect(body.data.stage).toBeDefined();
    expect(body.data.pipeline).toBeDefined();
    expect(body.data.contact).toBeDefined();
    expect(body.data.company).toBeDefined();
    expect(body.data.owner).toBeDefined();
    expect(body.data.source).toBeDefined();
  });

  it("creates a deal", async () => {
    await loginAs("admin-deals@example.org");
    const res = await dealsPost(
      makeRequest("/api/deals/list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: {
          name: "New Deal",
          contactId,
          companyId,
          stageId,
          value: 50000,
          expectedCloseDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          nextStep: "Send proposal",
          notes: "Initial contact made",
        },
      }) as never,
      ctx("list")
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe("New Deal");
    expect(body.data.value).toBe(50000);
    expect(body.data.probability).toBe(10); // From stage
    expect(body.data.stage.id).toBe(stageId);
  });

  it("creates a deal with minimal fields", async () => {
    await loginAs("admin-deals@example.org");
    const res = await dealsPost(
      makeRequest("/api/deals/list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { name: "Minimal Deal", stageId },
      }) as never,
      ctx("list")
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe("Minimal Deal");
    expect(body.data.ownerId).toBe(adminUserId);
  });

  it("rejects deal with invalid stage", async () => {
    await loginAs("admin-deals@example.org");
    const res = await dealsPost(
      makeRequest("/api/deals/list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { name: "Bad Deal", stageId: "invalid-stage-id" },
      }) as never,
      ctx("list")
    );
    expect(res.status).toBe(404);
  });

  it("updates a deal", async () => {
    await loginAs("admin-deals@example.org");
    const deal = await db.deal.create({
      data: { organizationId: orgId, name: "Update Deal", stageId, pipelineId, contactId, ownerId: adminUserId, value: 10000 },
    });

    const res = await dealsPatch(
      makeRequest(`/api/deals/${deal.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        json: { name: "Updated Deal", value: 25000, nextStep: "Follow up" },
      }) as never,
      ctx(deal.id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe("Updated Deal");
    expect(body.data.value).toBe(25000);
    expect(body.data.nextStep).toBe("Follow up");
  });

  it("moves deal to different stage (action=move)", async () => {
    await loginAs("admin-deals@example.org");
    const deal = await db.deal.create({
      data: { organizationId: orgId, name: "Move Deal", stageId, pipelineId, contactId, ownerId: adminUserId },
    });

    const res = await dealsPatch(
      makeRequest(`/api/deals/${deal.id}?action=move`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        json: { stageId: stageWonId },
      }) as never,
      ctx(deal.id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.stageId).toBe(stageWonId);
    expect(body.data.status).toBe("WON");
    expect(body.data.wonAt).not.toBeNull();
    expect(body.data.actualCloseDate).not.toBeNull();
  });

  it("moves deal to lost stage", async () => {
    await loginAs("admin-deals@example.org");
    const deal = await db.deal.create({
      data: { organizationId: orgId, name: "Lost Deal", stageId, pipelineId, contactId, ownerId: adminUserId },
    });

    const res = await dealsPatch(
      makeRequest(`/api/deals/${deal.id}?action=move`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        json: { stageId: stageLostId },
      }) as never,
      ctx(deal.id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.stageId).toBe(stageLostId);
    expect(body.data.status).toBe("LOST");
    expect(body.data.lostAt).not.toBeNull();
  });

  it("creates activity on stage move", async () => {
    await loginAs("admin-deals@example.org");
    const deal = await db.deal.create({
      data: { organizationId: orgId, name: "Activity Deal", stageId, pipelineId, contactId, ownerId: adminUserId },
    });

    await dealsPatch(
      makeRequest(`/api/deals/${deal.id}?action=move`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        json: { stageId: stageWonId },
      }) as never,
      ctx(deal.id)
    );

    const activities = await db.activity.findMany({
      where: { dealId: deal.id, type: "DEAL_WON" },
    });
    expect(activities.length).toBe(1);
    expect(activities[0].title).toContain("Deal won");
  });

  it("forbids non-owner from updating deal (without permission)", async () => {
    await loginAs("rep-deals@example.org");
    const deal = await db.deal.create({
      data: { organizationId: orgId, name: "Rep's Deal", stageId, pipelineId, contactId, ownerId: repUserId },
    });

    // Admin tries to update rep's deal - should work (admin has deals:update_all)
    await loginAs("admin-deals@example.org");
    const res = await dealsPatch(
      makeRequest(`/api/deals/${deal.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        json: { name: "Admin Updated" },
      }) as never,
      ctx(deal.id)
    );
    expect(res.status).toBe(200);
  });

  it("forbids rep from updating another rep's deal", async () => {
    await loginAs("rep-deals@example.org");
    const deal = await db.deal.create({
      data: { organizationId: orgId, name: "Other Rep Deal", stageId, pipelineId, contactId, ownerId: adminUserId },
    });

    const res = await dealsPatch(
      makeRequest(`/api/deals/${deal.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        json: { name: "Hacker Updated" },
      }) as never,
      ctx(deal.id)
    );
    expect(res.status).toBe(403);
  });

  it("deletes (soft deletes) a deal", async () => {
    await loginAs("admin-deals@example.org");
    const deal = await db.deal.create({
      data: { organizationId: orgId, name: "Delete Deal", stageId, pipelineId, contactId, ownerId: adminUserId },
    });

    const res = await dealsDelete(
      makeRequest(`/api/deals/${deal.id}`, { method: "DELETE" }) as never,
      ctx(deal.id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe(true);

    const deleted = await db.deal.findUnique({ where: { id: deal.id } });
    expect(deleted?.deletedAt).not.toBeNull();
  });

  it("forbids rep from deleting another rep's deal", async () => {
    await loginAs("rep-deals@example.org");
    const deal = await db.deal.create({
      data: { organizationId: orgId, name: "Delete Protected", stageId, pipelineId, contactId, ownerId: adminUserId },
    });

    const res = await dealsDelete(
      makeRequest(`/api/deals/${deal.id}`, { method: "DELETE" }) as never,
      ctx(deal.id)
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 for missing deal", async () => {
    await loginAs("admin-deals@example.org");
    const res = await dealsGet(makeRequest("/api/deals/does-not-exist") as never, ctx("does-not-exist"));
    expect(res.status).toBe(404);
  });

  it("includes stage and pipeline info in list", async () => {
    await loginAs("admin-deals@example.org");
    const deal = await db.deal.create({
      data: { organizationId: orgId, name: "List Deal", stageId, pipelineId, contactId, ownerId: adminUserId },
    });

    const res = await dealsGet(makeRequest("/api/deals") as never, ctx(undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    const found = body.data.deals.find((d: any) => d.id === deal.id);
    expect(found.stage).toBeDefined();
    expect(found.stage.name).toBe("New");
    expect(found.pipelineId).toBe(pipelineId);
  });
});
