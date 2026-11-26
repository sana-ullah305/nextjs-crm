import { execSync } from "node:child_process";
import { beforeAll, afterAll, describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";

const cookieStore = new Map<string, { name: string; value: string }>();

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (_name: string) => null }),
  cookies: async () => ({
    get: (name: string) => cookieStore.get(name),
    set: (name: string, value: string) => cookieStore.set(name, { name, value }),
    delete: (name: string) => cookieStore.delete(name),
  }),
}));

import { GET as usersGet, POST as usersPost, PATCH as usersPatch, DELETE as usersDelete } from "@/app/api/users/[[...id]]/route";
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
let repUserId: string;

beforeAll(async () => {
  // Wipe test DB data
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

  orgId = (await db.organization.create({ data: { name: "Test Org Users" } })).id;
  const passwordHash = await hashPassword("password123");
  const admin = await db.user.create({
    data: { organizationId: orgId, name: "Admin User", email: "admin-users@example.org", passwordHash, role: "ADMIN" },
  });
  const rep = await db.user.create({
    data: { organizationId: orgId, name: "Rep User", email: "rep-users@example.org", passwordHash, role: "SALES_REP" },
  });
  adminUserId = admin.id;
  repUserId = rep.id;
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

describe("Users API routes", () => {
  beforeEach(() => {
    logout();
  });

  it("requires auth for GET /api/users", async () => {
    const res = await usersGet(makeRequest("/api/users") as never, ctx(undefined));
    expect(res.status).toBe(401);
  });

  it("lists users for authenticated admin", async () => {
    await loginAs("admin-users@example.org");
    const res = await usersGet(makeRequest("/api/users") as never, ctx(undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.users).toHaveLength(2);
    expect(body.data.users.map((u: any) => u.email)).toContain("admin-users@example.org");
    expect(body.data.users.map((u: any) => u.email)).toContain("rep-users@example.org");
  });

  it("forbids non-admin from listing users", async () => {
    await loginAs("rep-users@example.org");
    const res = await usersGet(makeRequest("/api/users") as never, ctx(undefined));
    expect(res.status).toBe(403);
  });

  it("creates a new user as admin", async () => {
    await loginAs("admin-users@example.org");
    const res = await usersPost(
      makeRequest("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { name: "New User", email: "new@example.org", password: "password123", role: "SALES_REP", title: "Rep" },
      }) as never,
      ctx(undefined)
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.email).toBe("new@example.org");
    expect(body.data.role).toBe("SALES_REP");
    expect(body.data.name).toBe("New User");
  });

  it("rejects duplicate email on create", async () => {
    await loginAs("admin-users@example.org");
    const res = await usersPost(
      makeRequest("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { name: "Duplicate", email: "admin-users@example.org", password: "password123", role: "SALES_REP" },
      }) as never,
      ctx(undefined)
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("forbids non-admin from creating users", async () => {
    await loginAs("rep-users@example.org");
    const res = await usersPost(
      makeRequest("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { name: "Hacker", email: "hack@example.org", password: "password123", role: "ADMIN" },
      }) as never,
      ctx(undefined)
    );
    expect(res.status).toBe(403);
  });

  it("updates a user as admin", async () => {
    await loginAs("admin-users@example.org");
    const res = await usersPatch(
      makeRequest(`/api/users/${repUserId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        json: { title: "Senior Rep", phone: "555-0000" },
      }) as never,
      ctx([repUserId])
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.title).toBe("Senior Rep");
    expect(body.data.phone).toBe("555-0000");
  });

  it("prevents deactivating last admin", async () => {
    await loginAs("admin-users@example.org");
    const res = await usersPatch(
      makeRequest(`/api/users/${adminUserId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        json: { isActive: false },
      }) as never,
      ctx([adminUserId])
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("deactivates user and revokes sessions", async () => {
    await loginAs("admin-users@example.org");
    const res = await usersPatch(
      makeRequest(`/api/users/${repUserId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        json: { isActive: false },
      }) as never,
      ctx([repUserId])
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.isActive).toBe(false);

    // Verify sessions deleted
    const sessions = await db.session.findMany({ where: { userId: repUserId } });
    expect(sessions).toHaveLength(0);
  });

  it("prevents self-deletion", async () => {
    await loginAs("admin-users@example.org");
    const res = await usersDelete(
      makeRequest(`/api/users/${adminUserId}`, { method: "DELETE" }) as never,
      ctx([adminUserId])
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("deletes (deactivates) another user", async () => {
    await loginAs("admin-users@example.org");
    const res = await usersDelete(
      makeRequest(`/api/users/${repUserId}`, { method: "DELETE" }) as never,
      ctx([repUserId])
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe(true);

    const user = await db.user.findUnique({ where: { id: repUserId } });
    expect(user?.isActive).toBe(false);
  });

  it("returns 404 for missing user", async () => {
    await loginAs("admin-users@example.org");
    const res = await usersGet(
      makeRequest("/api/users/does-not-exist") as never,
      ctx(["does-not-exist"])
    );
    expect(res.status).toBe(404);
  });

  it("lists audit logs for admin", async () => {
    await loginAs("admin-users@example.org");
    const res = await usersGet(makeRequest("/api/users/audit") as never, ctx(["audit"]));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.logs).toBeDefined();
    expect(body.data.total).toBeDefined();
  });
});
