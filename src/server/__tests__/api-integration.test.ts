/**
 * API integration tests.
 *
 * Uses a dedicated test SQLite database configured via DATABASE_URL in
 * vitest.setup-integration.ts (loaded before this file). Exercises real
 * Prisma queries, real session auth, and real route handlers via direct
 * handler invocation — no HTTP server, no mocks (except next/headers
 * cookies, which are swapped for an in-memory store).
 */
import { execSync } from "node:child_process";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";

const cookieStore = new Map<string, { name: string; value: string }>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => cookieStore.get(name),
    set: (name: string, value: string) => cookieStore.set(name, { name, value }),
    delete: (name: string) => cookieStore.delete(name),
  }),
}));

import { POST as loginRoute } from "@/app/api/auth/login/route";
import { GET as contactsGet, POST as contactsPost, PATCH as contactsPatch, DELETE as contactsDelete } from "@/app/api/contacts/[[...id]]/route";
import { GET as leadsGet, POST as leadsPost } from "@/app/api/leads/[[...id]]/route";
import { GET as tasksGet, POST as tasksPost } from "@/app/api/tasks/[[...id]]/route";
import { GET as dashboardGet } from "@/app/api/dashboard/route";
import { GET as reportsGet } from "@/app/api/reports/route";
import { GET as usersGet } from "@/app/api/users/[[...id]]/route";
import { PATCH as tasksPatch } from "@/app/api/tasks/[[...id]]/route";
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
let contactId = "";

beforeAll(async () => {
  // Wipe test DB data (schema applied by setup script).
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

  orgId = (await db.organization.create({ data: { name: "Test Org" } })).id;
  const passwordHash = await hashPassword("password123");
  await db.user.create({
    data: { organizationId: orgId, name: "Admin", email: "admin@example.org", passwordHash, role: "ADMIN" },
  });
  await db.user.create({
    data: { organizationId: orgId, name: "Rep", email: "rep@example.org", passwordHash, role: "SALES_REP" },
  });
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

describe("auth + contacts API integration", () => {
  it("rejects bad credentials", async () => {
    const res = await call(loginRoute, makeRequest("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      json: { email: "admin@example.org", password: "nope" },
    }), { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("rate-limits after 10 bad logins", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await call(loginRoute, makeRequest("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { email: "bruteforce@example.org", password: "wrong" },
      }), { params: Promise.resolve({}) });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("logs in admin and creates a contact", async () => {
    await loginAs("admin@example.org");
    const res = await contactsPost(
      makeRequest("/api/contacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { firstName: "Ada", lastName: "Byron", email: "ada@example.org", tags: ["QA"] },
      }) as never,
      ctx(undefined)
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    contactId = body.data.id;
    expect(body.data.firstName).toBe("Ada");
    expect(body.data.tags.map((t: { name: string }) => t.name)).toContain("QA");
  });

  it("lists contacts with pagination metadata", async () => {
    const res = await contactsGet(makeRequest("/api/contacts?pageSize=1") as never, ctx(undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.total).toBe(1);
    expect(body.data.contacts.length).toBe(1);
  });

  it("gets, updates, then soft-deletes a contact", async () => {
    const got = await contactsGet(makeRequest(`/api/contacts/${contactId}`) as never, ctx([contactId]));
    expect(got.status).toBe(200);
    expect((await got.json()).data.email).toBe("ada@example.org");

    const patched = await contactsPatch(
      makeRequest(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        json: { title: "Countess of Lovelace" },
      }) as never,
      ctx([contactId])
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).data.title).toBe("Countess of Lovelace");

    const del = await contactsDelete(
      makeRequest(`/api/contacts/${contactId}`, { method: "DELETE" }) as never,
      ctx([contactId])
    );
    expect(del.status).toBe(200);

    const row = await db.contact.findUnique({ where: { id: contactId } });
    expect(row?.deletedAt).not.toBeNull();
  });

  it("returns 404 for a missing contact", async () => {
    const res = await contactsGet(
      makeRequest("/api/contacts/does-not-exist") as never,
      ctx(["does-not-exist"])
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 with field details for invalid payload", async () => {
    const res = await contactsPost(
      makeRequest("/api/contacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { lastName: "NoFirst", email: "bad-email" },
      }) as never,
      ctx(undefined)
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it("blocks unauthenticated access", async () => {
    logout();
    const res = await contactsGet(makeRequest("/api/contacts") as never, ctx(undefined));
    expect(res.status).toBe(401);
  });
});

describe("leads + tasks API integration", () => {
  it("rep logs in, creates a scored lead, lists and dedupes it", async () => {
    await loginAs("rep@example.org");

    const created = await leadsPost(
      makeRequest("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: {
          firstName: "Grace",
          lastName: "Hopper",
          email: "grace@example.org",
          phone: "+1 (555) 010-9999",
          companyName: "Navy Systems",
          estimatedValue: 60000,
          followUpAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      }) as never,
      ctx(undefined)
    );
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.data.score).toBeGreaterThanOrEqual(60);
    expect(body.data.companyId).not.toBeNull();

    const listed = await leadsGet(makeRequest("/api/leads?q=Hopper") as never, ctx(undefined));
    expect(listed.status).toBe(200);
    expect((await listed.json()).data.total).toBe(1);

    const dup = await leadsGet(
      makeRequest("/api/leads/check-duplicate?email=grace@example.org") as never,
      ctx(["check-duplicate"])
    );
    expect((await dup.json()).data.isDuplicate).toBe(true);
  });

  it("creates a task and completes it", async () => {
    const created = await tasksPost(
      makeRequest("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { title: "Call Grace", type: "CALL", priority: "HIGH", dueAt: new Date().toISOString() },
      }) as never,
      ctx(undefined)
    );
    expect(created.status).toBe(201);
    const task = (await created.json()).data;

    const done = await tasksPatch(
      makeRequest(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        json: { status: "COMPLETED" },
      }) as never,
      ctx([task.id])
    );
    expect(done.status).toBe(200);
    expect((await done.json()).data.completedAt).not.toBeNull();

    const listed = await tasksGet(makeRequest("/api/tasks?status=COMPLETED") as never, ctx(undefined));
    expect((await listed.json()).data.total).toBe(1);
  });
});

describe("RBAC enforcement through API", () => {
  it("rep gets 403 for users and reports", async () => {
    await loginAs("rep@example.org");
    const users = await usersGet(makeRequest("/api/users") as never, ctx(undefined));
    expect(users.status).toBe(403);
    const reports = await reportsGet(makeRequest("/api/reports") as never, {} as never);
    expect(reports.status).toBe(403);
  });

  it("admin reads reports and dashboard", async () => {
    await loginAs("admin@example.org");
    const reports = await reportsGet(makeRequest("/api/reports") as never, {} as never);
    expect(reports.status).toBe(200);
    const dash = await dashboardGet(makeRequest("/api/dashboard") as never, {} as never);
    expect(dash.status).toBe(200);
    const body = await dash.json();
    expect(body.data.kpis).toBeDefined();
    expect(body.data.trend.length).toBe(6);
  });
});
