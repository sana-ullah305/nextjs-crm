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

import { GET as companiesGet, POST as companiesPost, PATCH as companiesPatch, DELETE as companiesDelete } from "@/app/api/companies/[[...id]]/route";
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
let adminUserId: string;

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

  orgId = (await db.organization.create({ data: { name: "Test Org Companies" } })).id;
  const passwordHash = await hashPassword("password123");
  const admin = await db.user.create({
    data: { organizationId: orgId, name: "Admin Companies", email: "admin-companies@example.org", passwordHash, role: "ADMIN" },
  });
  adminUserId = admin.id;
  const pipeline = await db.pipeline.create({
    data: { organizationId: orgId, name: "P", isDefault: true },
  });
  await db.stage.create({
    data: { pipelineId: pipeline.id, name: "S1", position: 0, probability: 10, type: "OPEN" },
  });
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

describe("Companies API routes", () => {
  beforeEach(() => {
    logout();
  });

  it("requires auth for GET /api/companies", async () => {
    const res = await companiesGet(makeRequest("/api/companies") as never, ctx(undefined));
    expect(res.status).toBe(401);
  });

  it("lists companies with pagination", async () => {
    await loginAs("admin-companies@example.org");
    const res = await companiesGet(makeRequest("/api/companies?pageSize=5") as never, ctx(undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.companies).toBeDefined();
    expect(body.data.total).toBeDefined();
    expect(body.data.page).toBe(1);
    expect(body.data.pageSize).toBe(5);
  });

  it("filters companies by search query", async () => {
    await loginAs("admin-companies@example.org");
    // Create a test company
    await db.company.create({
      data: { organizationId: orgId, name: "Acme Corp", domain: "acme.com", industry: "Software" },
    });

    const res = await companiesGet(makeRequest("/api/companies?q=Acme") as never, ctx(undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.companies.some((c: any) => c.name === "Acme Corp")).toBe(true);
  });

  it("filters companies by industry", async () => {
    await loginAs("admin-companies@example.org");
    const res = await companiesGet(makeRequest("/api/companies?industry=Software") as never, ctx(undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.companies.every((c: any) => c.industry === "Software")).toBe(true);
  });

  it("sorts companies by name", async () => {
    await loginAs("admin-companies@example.org");
    const res = await companiesGet(makeRequest("/api/companies?sort=name") as never, ctx(undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.data.companies.map((c: any) => c.name);
    expect(names).toEqual([...names].sort());
  });

  it("creates a company", async () => {
    await loginAs("admin-companies@example.org");
    const res = await companiesPost(
      makeRequest("/api/companies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: {
          name: "New Company Inc",
          domain: "newcompany.com",
          industry: "Technology",
          size: "51-200",
          phone: "555-1234",
          website: "https://newcompany.com",
          address: "123 Main St",
          city: "San Francisco",
          state: "CA",
          country: "USA",
          summary: "A great company",
        },
      }) as never,
      ctx(undefined)
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe("New Company Inc");
    expect(body.data.domain).toBe("newcompany.com");
    expect(body.data.ownerId).toBe(adminUserId);
  });

  it("creates a company with minimal fields", async () => {
    await loginAs("admin-companies@example.org");
    const res = await companiesPost(
      makeRequest("/api/companies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { name: "Minimal Company" },
      }) as never,
      ctx(undefined)
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe("Minimal Company");
  });

  it("gets a single company with contacts", async () => {
    await loginAs("admin-companies@example.org");
    const company = await db.company.create({
      data: { organizationId: orgId, name: "Detail Company", domain: "detail.com" },
    });
    await db.contact.create({
      data: { organizationId: orgId, firstName: "John", lastName: "Doe", email: "john@detail.com", companyId: company.id },
    });

    const res = await companiesGet(makeRequest(`/api/companies/${company.id}`) as never, ctx([company.id]));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe("Detail Company");
    expect(body.data.contacts).toHaveLength(1);
    expect(body.data.contacts[0].email).toBe("john@detail.com");
  });

  it("updates a company", async () => {
    await loginAs("admin-companies@example.org");
    const company = await db.company.create({
      data: { organizationId: orgId, name: "Update Company", domain: "update.com" },
    });

    const res = await companiesPatch(
      makeRequest(`/api/companies/${company.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        json: { name: "Updated Company", industry: "Finance", size: "201-500" },
      }) as never,
      ctx([company.id])
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe("Updated Company");
    expect(body.data.industry).toBe("Finance");
    expect(body.data.size).toBe("201-500");
  });

  it("updates company owner", async () => {
    await loginAs("admin-companies@example.org");
    const company = await db.company.create({
      data: { organizationId: orgId, name: "Owner Company", domain: "owner.com", ownerId: adminUserId },
    });
    const rep = await db.user.create({
      data: { organizationId: orgId, name: "Rep", email: "rep-companies@example.org", passwordHash: await hashPassword("password123"), role: "SALES_REP" },
    });

    const res = await companiesPatch(
      makeRequest(`/api/companies/${company.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        json: { ownerId: rep.id },
      }) as never,
      ctx([company.id])
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ownerId).toBe(rep.id);
  });

  it("clears company owner when null provided", async () => {
    await loginAs("admin-companies@example.org");
    const company = await db.company.create({
      data: { organizationId: orgId, name: "Clear Owner", domain: "clear.com", ownerId: adminUserId },
    });

    const res = await companiesPatch(
      makeRequest(`/api/companies/${company.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        json: { ownerId: null },
      }) as never,
      ctx([company.id])
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ownerId).toBeNull();
  });

  it("deletes (soft deletes) a company", async () => {
    await loginAs("admin-companies@example.org");
    const company = await db.company.create({
      data: { organizationId: orgId, name: "Delete Company", domain: "delete.com" },
    });

    const res = await companiesDelete(
      makeRequest(`/api/companies/${company.id}`, { method: "DELETE" }) as never,
      ctx([company.id])
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe(true);

    const deleted = await db.company.findUnique({ where: { id: company.id } });
    expect(deleted?.deletedAt).not.toBeNull();
  });

  it("returns 404 for missing company", async () => {
    await loginAs("admin-companies@example.org");
    const res = await companiesGet(makeRequest("/api/companies/does-not-exist") as never, ctx(["does-not-exist"]));
    expect(res.status).toBe(404);
  });

  it("returns 404 for updating missing company", async () => {
    await loginAs("admin-companies@example.org");
    const res = await companiesPatch(
      makeRequest("/api/companies/does-not-exist", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        json: { name: "Test" },
      }) as never,
      ctx(["does-not-exist"])
    );
    expect(res.status).toBe(404);
  });

  it("includes contact and deal counts in list", async () => {
    await loginAs("admin-companies@example.org");
    const company = await db.company.create({
      data: { organizationId: orgId, name: "Count Company", domain: "count.com" },
    });
    await db.contact.create({
      data: { organizationId: orgId, firstName: "Contact", lastName: "One", email: "c1@count.com", companyId: company.id },
    });
    await db.contact.create({
      data: { organizationId: orgId, firstName: "Contact", lastName: "Two", email: "c2@count.com", companyId: company.id },
    });

    const res = await companiesGet(makeRequest("/api/companies") as never, ctx(undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    const found = body.data.companies.find((c: any) => c.id === company.id);
    expect(found.contactCount).toBe(2);
    expect(found.dealCount).toBe(0);
  });
});
