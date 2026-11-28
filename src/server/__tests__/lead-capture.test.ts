/**
 * Integration tests for the public lead capture API and API key management.
 * Follows the direct route-handler + cookie-store-mock pattern from
 * features.test.ts against the isolated test SQLite database.
 *
 * Rate-limit note: the capture limiter allows 30 requests / 5 min / key in a
 * sliding window. Tests stay realistic but fast by resetting the limiter
 * (resetRateLimiter) between scenarios and, for the 429 case, exhausting the
 * bucket with unique-email requests so no DB writes are skipped early.
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
import { POST as leadsPost } from "@/app/api/leads/[id]/route";
import { POST as capturePost } from "@/app/api/leads/capture/route";
import {
  GET as settingsGet,
  POST as settingsPost,
  DELETE as settingsDelete,
} from "@/app/api/settings/[[...section]]/route";
import { resetRateLimiter } from "@/server/rate-limit";
import { generateApiKey } from "@/server/apikeys";
import db from "@/server/db";
import { hashPassword } from "@/server/auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: any, ctx?: any) => Promise<Response>;

function call(handler: Handler, req: unknown, ctx?: unknown): Promise<Response> {
  return ctx !== undefined ? handler(req as never, ctx as never) : handler(req as never);
}

function makeRequest(
  pathname: string,
  init?: { method?: string; json?: unknown; apiKey?: string }
) {
  const url = new URL(`http://localhost:3000${pathname}`);
  const headers = new Headers();
  if (init?.json !== undefined) headers.set("content-type", "application/json");
  if (init?.apiKey) {
    url.searchParams.set("apikey", init.apiKey);
  }
  return {
    url: url.toString(),
    method: init?.method ?? "GET",
    headers,
    json: async () => (init?.json !== undefined ? init.json : {}),
    cookies: {
      get: (name: string) => cookieStore.get(name),
      set: (name: string, value: string) => cookieStore.set(name, { name, value }),
      delete: (name: string) => cookieStore.delete(name),
    },
    nextUrl: url,
  };
}

function makeBearerRequest(
  json: unknown,
  apiKey: string,
  pathname = "/api/leads/capture"
) {
  const url = new URL(`http://localhost:3000${pathname}`);
  const headers = new Headers({ "content-type": "application/json" });
  headers.set("authorization", `Bearer ${apiKey}`);
  return {
    url: url.toString(),
    method: "POST",
    headers,
    json: async () => json,
    cookies: {
      get: (name: string) => cookieStore.get(name),
      set: (name: string, value: string) => cookieStore.set(name, { name, value }),
      delete: (name: string) => cookieStore.delete(name),
    },
    nextUrl: url,
  };
}

function settingsCtx(segments?: string[] | undefined) {
  return { params: Promise.resolve({ section: segments }) };
}

let orgId: string;
let otherOrgId: string;
let adminId: string;
let repId: string;
let otherOrgAdminId: string;
let activeKey: string;
let activeKeyId: string;
let otherOrgKey: string;

async function loginAs(email: string) {
  cookieStore.clear();
  const res = await call(
    loginRoute,
    makeRequest("/api/auth/login", { method: "POST", json: { email, password: "password123" } }),
    { params: Promise.resolve({}) }
  );
  expect(res.status).toBe(200);
}

async function insertApiKey(opts: {
  organizationId: string;
  createdById: string;
  name?: string;
  isActive?: boolean;
  revoked?: boolean;
}): Promise<{ key: string; id: string }> {
  const { key, keyHash, prefix } = generateApiKey();
  const row = await db.apiKey.create({
    data: {
      organizationId: opts.organizationId,
      name: opts.name ?? "Test key",
      keyHash,
      prefix,
      createdById: opts.createdById,
      isActive: opts.isActive ?? true,
      revokedAt: opts.revoked ? new Date() : null,
    },
    select: { id: true },
  });
  return { key, id: row.id };
}

function captureBody(overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.org",
    phone: "+1 555 0100",
    companyName: "Analytical Engines Inc",
    source: "Website form",
    ...overrides,
  };
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
  await db.apiKey.deleteMany();
  await db.user.deleteMany();
  await db.leadSource.deleteMany();
  await db.emailTemplate.deleteMany();
  await db.emailSettings.deleteMany();
  await db.organization.deleteMany();

  const passwordHash = await hashPassword("password123");
  orgId = (await db.organization.create({ data: { name: "Capture Org" } })).id;
  const admin = await db.user.create({
    data: { organizationId: orgId, name: "Admin", email: "admin@capture.test", passwordHash, role: "ADMIN" },
  });
  adminId = admin.id;
  const rep = await db.user.create({
    data: { organizationId: orgId, name: "Rep One", email: "rep1@capture.test", passwordHash, role: "SALES_REP" },
  });
  repId = rep.id;
  await db.user.create({
    data: { organizationId: orgId, name: "Rep Two", email: "rep2@capture.test", passwordHash, role: "SALES_REP" },
  });

  otherOrgId = (await db.organization.create({ data: { name: "Rival Org" } })).id;
  const otherAdmin = await db.user.create({
    data: {
      organizationId: otherOrgId,
      name: "Other Admin",
      email: "admin@rival.test",
      passwordHash,
      role: "ADMIN",
    },
  });
  otherOrgAdminId = otherAdmin.id;

  const seeded = await insertApiKey({ organizationId: orgId, createdById: adminId, name: "Seeded key" });
  activeKey = seeded.key;
  activeKeyId = seeded.id;
  const rival = await insertApiKey({
    organizationId: otherOrgId,
    createdById: otherOrgAdminId,
    name: "Rival key",
  });
  otherOrgKey = rival.key;
}, 120_000);

beforeEach(() => {
  resetRateLimiter();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("public lead capture API", () => {
  it("creates a lead with score > 0, logs activity + audit, updates lastUsedAt", async () => {
    const res = await call(capturePost, makeBearerRequest(captureBody(), activeKey));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBeTruthy();
    expect(body.data.score).toBeGreaterThan(0);
    expect(body.data.status).toBe("NEW");
    // Response must not leak org internals.
    expect(Object.keys(body.data).sort()).toEqual(["id", "score", "status"]);

    const lead = await db.lead.findUnique({ where: { id: body.data.id } });
    expect(lead).not.toBeNull();
    expect(lead!.organizationId).toBe(orgId);
    expect(lead!.email).toBe("ada@example.org");
    expect(lead!.score).toBe(body.data.score);
    // Mass-assignment guard: injected internal fields must not persist.
    expect(lead!.assignedUserId).not.toBe("attacker-user");
    expect(lead!.ownerId).toBe(adminId);

    const activity = await db.activity.findFirst({ where: { leadId: lead!.id, type: "CREATED" } });
    expect(activity).not.toBeNull();

    const audit = await db.auditLog.findFirst({
      where: { action: "LEAD_CAPTURE", entityId: lead!.id },
    });
    expect(audit).not.toBeNull();
    const meta = JSON.parse(audit!.metadata);
    expect(meta.keyPrefix).toBe(activeKey.slice(0, 8));
    expect(meta.source).toBe("Website form");

    const keyRow = await db.apiKey.findUnique({ where: { id: activeKeyId } });
    expect(keyRow!.lastUsedAt).not.toBeNull();
  });

  it("assigns captured leads to a SALES_REP org user (round-robin pool), not the caller", async () => {
    const res = await call(
      capturePost,
      makeBearerRequest(captureBody({ email: "assignee@example.org" }), activeKey)
    );
    expect(res.status).toBe(201);
    const lead = await db.lead.findUnique({ where: { id: (await res.json()).data.id } });
    expect(lead!.assignedUserId).toBeTruthy();
    const assignee = await db.user.findUnique({ where: { id: lead!.assignedUserId! } });
    expect(assignee!.organizationId).toBe(orgId);
    expect(assignee!.role).toBe("SALES_REP");
    expect(lead!.assignedUserId).not.toBe(adminId);
    void repId;
  });

  it("rejects an unknown key with 401", async () => {
    const res = await call(capturePost, makeBearerRequest(captureBody({ email: "x1@example.org" }), "lc_" + "0".repeat(32)));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a missing key with 401", async () => {
    const res = await call(capturePost, makeRequest("/api/leads/capture", { method: "POST", json: captureBody() }));
    expect(res.status).toBe(401);
  });

  it("rejects a revoked key with 403", async () => {
    const revoked = await insertApiKey({
      organizationId: orgId,
      createdById: adminId,
      name: "Revoked key",
      isActive: false,
      revoked: true,
    });
    const res = await call(capturePost, makeBearerRequest(captureBody({ email: "x2@example.org" }), revoked.key));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.data).toBeUndefined();

    const count = await db.lead.count({ where: { organizationId: orgId, email: "x2@example.org" } });
    expect(count).toBe(0);
  });

  it("rate limits after 30 requests per key with 429 + Retry-After", async () => {
    const rlKey = await insertApiKey({ organizationId: orgId, createdById: adminId, name: "RL key" });
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const res = await call(
        capturePost,
        makeBearerRequest(
          captureBody({ email: `rl-${i}@example.org`, firstName: "Rate", lastName: `Limit${i}` }),
          rlKey.key
        )
      );
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 30)).toEqual(new Array(30).fill(201));
    const last = await call(
      capturePost,
      makeBearerRequest(
        captureBody({ email: "rl-overflow@example.org" }),
        rlKey.key
      )
    );
    expect(last.status).toBe(429);
    const body = await last.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    const retryAfter = Number(last.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(300);
  });

  it("returns 409 DUPLICATE_LEAD for an email that already exists in the same org", async () => {
    const res = await call(capturePost, makeBearerRequest(captureBody(), activeKey));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("DUPLICATE_LEAD");
  });

  it("allows the same email in different orgs (duplicate detection is org-scoped)", async () => {
    const res = await call(capturePost, makeBearerRequest(captureBody(), otherOrgKey));
    expect(res.status).toBe(201);
    const lead = await db.lead.findFirst({
      where: { email: "ada@example.org", organizationId: otherOrgId },
    });
    expect(lead).not.toBeNull();
  });

  it("returns 400 for missing required fields", async () => {
    const res = await call(
      capturePost,
      makeBearerRequest({ email: "no-names@example.org" }, activeKey)
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("ignores mass-assignment attempts (owner/assignment fields are not accepted)", async () => {
    const res = await call(
      capturePost,
      makeBearerRequest(
        {
          ...captureBody({ email: "mass@example.org" }),
          assignedUserId: "attacker-user",
          ownerId: "attacker-user",
          status: "QUALIFIED",
          score: 100,
          organizationId: otherOrgId,
        },
        activeKey
      )
    );
    expect(res.status).toBe(201);
    const lead = await db.lead.findFirst({ where: { email: "mass@example.org" } });
    expect(lead!.organizationId).toBe(orgId);
    expect(lead!.status).toBe("NEW");
    expect(lead!.score).toBeLessThan(100);
    expect(lead!.ownerId).toBe(adminId);
  });

  it("authenticates via ?apikey= query parameter too", async () => {
    const res = await call(
      capturePost,
      makeRequest("/api/leads/capture", {
        method: "POST",
        json: captureBody({ email: "query-auth@example.org" }),
        apiKey: activeKey,
      })
    );
    expect(res.status).toBe(201);
  });

  it("cross-org isolation: org B's key can never write to or observe org A", async () => {
    // A lead captured via org B's key lands in org B only.
    const res = await call(
      capturePost,
      makeBearerRequest(captureBody({ email: "isolation@example.org" }), otherOrgKey)
    );
    expect(res.status).toBe(201);
    const inA = await db.lead.findFirst({
      where: { email: "isolation@example.org", organizationId: orgId },
    });
    expect(inA).toBeNull();
    const inB = await db.lead.findFirst({
      where: { email: "isolation@example.org", organizationId: otherOrgId },
    });
    expect(inB).not.toBeNull();

    // An email that already exists in org A must NOT 409 for org B's key:
    // duplicate detection is strictly org-scoped. (mass@example.org was
    // captured into org A earlier and never into org B.)
    const dupe = await call(
      capturePost,
      makeBearerRequest(captureBody({ email: "mass@example.org" }), otherOrgKey)
    );
    expect(dupe.status).toBe(201);

    // Org A's captured lead data never appears under org B.
    const bLeads = await db.lead.findMany({ where: { organizationId: otherOrgId } });
    expect(bLeads.some((l) => l.id === inA?.id)).toBe(false);
  });
});

describe("API key management (settings section)", () => {
  it("GET api-keys lists keys with prefix but never the hash or full key", async () => {
    await loginAs("admin@capture.test");
    const res = await call(settingsGet, makeRequest("/api/settings/api-keys"), settingsCtx(["api-keys"]));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data.apiKeys)).toBe(true);
    expect(body.data.apiKeys.length).toBeGreaterThan(0);
    for (const k of body.data.apiKeys) {
      expect(Object.keys(k)).not.toContain("keyHash");
      expect(JSON.stringify(k)).not.toContain(activeKey);
      expect(k.prefix).toHaveLength(8);
      expect(typeof k.isActive).toBe("boolean");
    }
  });

  it("POST api-keys creates a key and returns the full key exactly once", async () => {
    await loginAs("admin@capture.test");
    const res = await call(
      settingsPost,
      makeRequest("/api/settings/api-keys", { method: "POST", json: { name: "Website embed" } }),
      settingsCtx(["api-keys"])
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.key).toMatch(/^lc_[0-9a-f]{32}$/);
    expect(body.data.prefix).toHaveLength(8);
    expect(body.data.name).toBe("Website embed");

    const stored = await db.apiKey.findUnique({ where: { id: body.data.id } });
    expect(stored!.keyHash).not.toBe(body.data.key);
    expect(stored!.keyHash).toHaveLength(64);

    const audit = await db.auditLog.findFirst({
      where: { action: "API_KEY_CREATE", entityId: body.data.id },
    });
    expect(audit).not.toBeNull();

    // The freshly created key is immediately usable for capture.
    const cap = await call(
      capturePost,
      makeBearerRequest(captureBody({ email: "fresh-key@example.org" }), body.data.key)
    );
    expect(cap.status).toBe(201);

    // The full key is never repeated by the list endpoint.
    const list = await call(settingsGet, makeRequest("/api/settings/api-keys"), settingsCtx(["api-keys"]));
    const listBody = await list.json();
    expect(JSON.stringify(listBody)).not.toContain(body.data.key);
  });

  it("forbids non-admins (missing settings:manage) from managing keys", async () => {
    await loginAs("rep1@capture.test");
    const createRes = await call(
      settingsPost,
      makeRequest("/api/settings/api-keys", { method: "POST", json: { name: "Nope" } }),
      settingsCtx(["api-keys"])
    );
    expect(createRes.status).toBe(403);

    const listRes = await call(settingsGet, makeRequest("/api/settings/api-keys"), settingsCtx(["api-keys"]));
    expect(listRes.status).toBe(200); // settings:read allows listing

    const delRes = await call(
      settingsDelete,
      makeRequest(`/api/settings/api-keys/${activeKeyId}`, { method: "DELETE" }),
      settingsCtx(["api-keys", activeKeyId])
    );
    expect(delRes.status).toBe(403);
  });

  it("DELETE api-keys/:id soft-revokes: key stops working, audit written", async () => {
    await loginAs("admin@capture.test");
    const res = await call(
      settingsDelete,
      makeRequest(`/api/settings/api-keys/${activeKeyId}`, { method: "DELETE" }),
      settingsCtx(["api-keys", activeKeyId])
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.revoked).toBe(true);

    const stored = await db.apiKey.findUnique({ where: { id: activeKeyId } });
    expect(stored!.isActive).toBe(false);
    expect(stored!.revokedAt).not.toBeNull();

    const audit = await db.auditLog.findFirst({
      where: { action: "API_KEY_REVOKE", entityId: activeKeyId },
    });
    expect(audit).not.toBeNull();

    const cap = await call(
      capturePost,
      makeBearerRequest(captureBody({ email: "revoked-now@example.org" }), activeKey)
    );
    expect(cap.status).toBe(403);

    const list = await call(settingsGet, makeRequest("/api/settings/api-keys"), settingsCtx(["api-keys"]));
    const listBody = await list.json();
    const row = (listBody.data.apiKeys as Array<{ id: string; isActive: boolean }>).find(
      (k) => k.id === activeKeyId
    );
    expect(row!.isActive).toBe(false);
  });

  it("refuses to revoke a key belonging to another org (cross-org isolation)", async () => {
    await loginAs("admin@rival.test");
    const rivalKeys = await db.apiKey.findMany({ where: { organizationId: otherOrgId } });
    // Rival admin cannot revoke org A's key even when they know its id.
    const orgAKey = await db.apiKey.findFirst({ where: { organizationId: orgId, isActive: true } });
    const res = await call(
      settingsDelete,
      makeRequest(`/api/settings/api-keys/${orgAKey!.id}`, { method: "DELETE" }),
      settingsCtx(["api-keys", orgAKey!.id])
    );
    expect(res.status).toBe(404);
    const stillActive = await db.apiKey.findUnique({ where: { id: orgAKey!.id } });
    expect(stillActive!.isActive).toBe(true);
    void rivalKeys;
  });

  it("validates create payloads (name required)", async () => {
    await loginAs("admin@capture.test");
    const res = await call(
      settingsPost,
      makeRequest("/api/settings/api-keys", { method: "POST", json: { name: "" } }),
      settingsCtx(["api-keys"])
    );
    expect(res.status).toBe(400);
  });
});

describe("internal leads route regression", () => {
  it("POST /api/leads still works unchanged for session users", async () => {
    await loginAs("admin@capture.test");
    const res = await call(
      leadsPost,
      makeRequest("/api/leads", {
        method: "POST",
        json: {
          firstName: "Internal",
          lastName: "Route",
          email: "internal@capture.test",
          companyName: "Internal Co",
          estimatedValue: 12000,
        },
      }),
      { params: Promise.resolve({}) }
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.email).toBe("internal@capture.test");
    expect(body.data.score).toBeGreaterThan(0);

    const audit = await db.auditLog.findFirst({
      where: { action: "LEAD_CREATE", entityId: body.data.id },
    });
    expect(audit).not.toBeNull();
  });

  it("POST /api/leads rejects unauthenticated requests with 401", async () => {
    cookieStore.clear();
    const res = await call(
      leadsPost,
      makeRequest("/api/leads", {
        method: "POST",
        json: { firstName: "No", lastName: "Session", email: "nosession@capture.test" },
      }),
      { params: Promise.resolve({}) }
    );
    expect(res.status).toBe(401);
  });
});
