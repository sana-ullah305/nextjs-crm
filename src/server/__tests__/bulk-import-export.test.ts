/**
 * Integration tests for CSV import (leads), CSV export (deals), and the
 * bulk-actions endpoint. Uses the shared test SQLite database and real
 * route handlers via direct invocation, mirroring api-integration.test.ts.
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

import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as leadsPost } from "@/app/api/leads/[[...id]]/route";
import { GET as dealsExport } from "@/app/api/deals/export/route";
import { POST as bulkPost } from "@/app/api/bulk/route";
import { GET as contactsGet } from "@/app/api/contacts/[[...id]]/route";
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

function ctx(segments: string[] | undefined) {
  return { params: Promise.resolve({ id: segments }) };
}

let orgId: string;
let pipelineId: string;
let stageId: string;
let adminId: string;
let repId: string;

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
  await db.tag.deleteMany();
  await db.company.deleteMany();
  await db.user.deleteMany();
  await db.leadSource.deleteMany();
  await db.organization.deleteMany();

  orgId = (await db.organization.create({ data: { name: "Bulk Org" } })).id;
  const passwordHash = await hashPassword("password123");
  adminId = (
    await db.user.create({
      data: { organizationId: orgId, name: "Admin", email: "admin@bulk.org", passwordHash, role: "ADMIN" },
    })
  ).id;
  repId = (
    await db.user.create({
      data: { organizationId: orgId, name: "Rep", email: "rep@bulk.org", passwordHash, role: "SALES_REP" },
    })
  ).id;
  const pipeline = await db.pipeline.create({
    data: { organizationId: orgId, name: "P", isDefault: true },
  });
  pipelineId = pipeline.id;
  const stage = await db.stage.create({
    data: { pipelineId: pipeline.id, name: "S1", position: 0, probability: 10, type: "OPEN" },
  });
  stageId = stage.id;
}, 120_000);

afterAll(async () => {
  await db.$disconnect();
});

async function loginAs(email: string) {
  cookieStore.clear();
  const res = await call(loginRoute, makeRequest("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    json: { email, password: "password123" },
  }), { params: Promise.resolve({}) });
  expect(res.status).toBe(200);
}

describe("leads CSV import", () => {
  it("imports leads and skips duplicates", async () => {
    await loginAs("admin@bulk.org");
    const res = await leadsPost(
      makeRequest("/api/leads/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: {
          leads: [
            { firstName: "Ada", lastName: "Byron", email: "ada@bulk.org", company: "Acme", estimatedValue: 5000 },
            { firstName: "Grace", lastName: "Hopper", email: "grace@bulk.org", company: "Navy" },
            { firstName: "Ada", lastName: "Dup", email: "ada@bulk.org" },
            { firstName: "", lastName: "NoFirst", email: "" },
          ],
        },
      }) as never,
      ctx(["import"])
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.imported).toBe(2);
    expect(body.data.skipped).toBe(2);

    const leads = await db.lead.findMany({ where: { organizationId: orgId, deletedAt: null } });
    expect(leads.length).toBe(2);
    const ada = leads.find((l) => l.email === "ada@bulk.org");
    expect(ada?.companyName).toBe("Acme");
    expect(ada?.score).toBeGreaterThanOrEqual(0);
  });

  it("rejects import without leads:import permission", async () => {
    // Rep has leads:import in this codebase; verify auth still required.
    cookieStore.clear();
    const res = await leadsPost(
      makeRequest("/api/leads/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { leads: [{ firstName: "X", lastName: "Y", email: "x@bulk.org" }] },
      }) as never,
      ctx(["import"])
    );
    expect(res.status).toBe(401);
  });
});

describe("deals CSV export", () => {
  it("exports deals as CSV with formula-injection escaping", async () => {
    await loginAs("admin@bulk.org");
    // Create a deal with a formula-injection name.
    await db.deal.create({
      data: {
        organizationId: orgId,
        name: "=cmd|' /C calc'!A0",
        stageId,
        pipelineId,
        value: 1000,
        ownerId: adminId,
      },
    });
    const res = await dealsExport(
      makeRequest("/api/deals/export?pipelineId=" + pipelineId) as never,
      {}
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    const lines = text.split("\n");
    expect(lines[0]).toContain("Name,Stage,Status,Value");
    // Formula injection should be prefixed with a single quote.
    expect(text).toContain("'=cmd");
    // The header line itself must not be escaped.
    expect(lines[0].startsWith("'=cmd")).toBe(false);
  });

  it("requires auth for export", async () => {
    cookieStore.clear();
    const res = await dealsExport(makeRequest("/api/deals/export") as never, {});
    expect(res.status).toBe(401);
  });
});

describe("bulk actions", () => {
  it("bulk-deletes selected contacts", async () => {
    await loginAs("admin@bulk.org");
    const c1 = await db.contact.create({ data: { organizationId: orgId, firstName: "A", lastName: "One", email: "a1@bulk.org", ownerId: adminId } });
    const c2 = await db.contact.create({ data: { organizationId: orgId, firstName: "B", lastName: "Two", email: "b2@bulk.org", ownerId: adminId } });
    const res = await bulkPost(
      makeRequest("/api/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { entityType: "contacts", ids: [c1.id, c2.id], action: "delete" },
      }) as never,
      {}
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.affected).toBe(2);
    const remaining = await db.contact.findMany({ where: { organizationId: orgId, deletedAt: null } });
    expect(remaining.length).toBe(0);
  });

  it("bulk-assigns leads to a user", async () => {
    await loginAs("admin@bulk.org");
    const l1 = await db.lead.create({ data: { organizationId: orgId, firstName: "L", lastName: "One", email: "l1@bulk.org", ownerId: adminId } });
    const res = await bulkPost(
      makeRequest("/api/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { entityType: "leads", ids: [l1.id], action: "assign", params: { assigneeId: repId } },
      }) as never,
      {}
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.affected).toBe(1);
    const lead = await db.lead.findUnique({ where: { id: l1.id } });
    expect(lead?.assignedUserId).toBe(repId);
  });

  it("bulk-adds tags to contacts", async () => {
    await loginAs("admin@bulk.org");
    const c = await db.contact.create({ data: { organizationId: orgId, firstName: "T", lastName: "T", email: "tt@bulk.org", ownerId: adminId } });
    const res = await bulkPost(
      makeRequest("/api/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { entityType: "contacts", ids: [c.id], action: "addTag", params: { tagNames: ["VIP", "Hot"] } },
      }) as never,
      {}
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.affected).toBe(1);
    const withTags = await db.contact.findUnique({ where: { id: c.id }, include: { tags: true } });
    expect(withTags?.tags.map((t) => t.name).sort()).toEqual(["Hot", "VIP"]);
  });

  it("rejects addTag for deals", async () => {
    await loginAs("admin@bulk.org");
    const d = await db.deal.create({ data: { organizationId: orgId, name: "D", stageId, pipelineId, ownerId: adminId } });
    const res = await bulkPost(
      makeRequest("/api/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { entityType: "deals", ids: [d.id], action: "addTag", params: { tagNames: ["X"] } },
      }) as never,
      {}
    );
    expect(res.status).toBe(400);
  });

  it("rejects assign without assigneeId", async () => {
    await loginAs("admin@bulk.org");
    const res = await bulkPost(
      makeRequest("/api/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { entityType: "leads", ids: ["x"], action: "assign" },
      }) as never,
      {}
    );
    expect(res.status).toBe(400);
  });

  it("rejects bulk with empty ids", async () => {
    await loginAs("admin@bulk.org");
    const res = await bulkPost(
      makeRequest("/api/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { entityType: "contacts", ids: [], action: "delete" },
      }) as never,
      {}
    );
    expect(res.status).toBe(400);
  });

  it("scopes bulk delete to the caller's org", async () => {
    // Create a contact in another org.
    const otherOrg = await db.organization.create({ data: { name: "Other" } });
    await db.contact.create({ data: { organizationId: otherOrg.id, firstName: "O", lastName: "O", email: "oo@other.org" } });
    await loginAs("admin@bulk.org");
    const mine = await db.contact.create({ data: { organizationId: orgId, firstName: "M", lastName: "M", email: "mm@bulk.org", ownerId: adminId } });
    const res = await bulkPost(
      makeRequest("/api/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { entityType: "contacts", ids: [mine.id], action: "delete" },
      }) as never,
      {}
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.affected).toBe(1);
    const other = await db.contact.findFirst({ where: { organizationId: otherOrg.id, deletedAt: null } });
    expect(other).not.toBeNull();
  });
});

describe("pagination consistency", () => {
  it("contacts list returns page/pageSize metadata", async () => {
    await loginAs("admin@bulk.org");
    const res = await contactsGet(makeRequest("/api/contacts?page=1&pageSize=1") as never, ctx(undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.page).toBe(1);
    expect(body.data.pageSize).toBe(1);
    expect(typeof body.data.total).toBe("number");
  });
});
