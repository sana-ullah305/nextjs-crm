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

import { GET as meGet } from "@/app/api/auth/me/route";
import { POST as logoutPost } from "@/app/api/auth/logout/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
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

let orgId: string;

beforeAll(async () => {
  await db.session.deleteMany();
  await db.user.deleteMany();
  await db.organization.deleteMany();

  orgId = (await db.organization.create({ data: { name: "Test Org Auth" } })).id;
  const passwordHash = await hashPassword("password123");
  await db.user.create({
    data: { organizationId: orgId, name: "Auth User", email: "auth@example.org", passwordHash, role: "SALES_REP" },
  });
}, 60_000);

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

describe("Auth /me and /logout routes", () => {
  it("returns 401 for /me without session", async () => {
    cookieStore.clear();
    const res = await meGet(makeRequest("/api/auth/me") as never);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns user data for /me with valid session", async () => {
    await loginAs("auth@example.org");
    const res = await meGet(makeRequest("/api/auth/me") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.email).toBe("auth@example.org");
    expect(body.data.name).toBe("Auth User");
    expect(body.data.role).toBe("SALES_REP");
  });

  it("returns 401 for /me with invalid/expired session", async () => {
    await loginAs("auth@example.org");
    // Manually corrupt the session
    cookieStore.clear();
    cookieStore.set("crm_session", { name: "crm_session", value: "invalid-token" });
    
    const res = await meGet(makeRequest("/api/auth/me") as never);
    expect(res.status).toBe(401);
  });

  it("logs out and clears session cookie", async () => {
    await loginAs("auth@example.org");
    
    // Verify we're logged in
    let res = await meGet(makeRequest("/api/auth/me") as never);
    expect(res.status).toBe(200);

    // Logout
    res = await call(logoutPost, makeRequest("/api/auth/logout", { method: "POST" }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ok).toBe(true);

    // Verify cookie cleared
    expect(cookieStore.has("crm_session")).toBe(false);

    // Verify session destroyed in DB
    const sessions = await db.session.findMany({ where: { user: { email: "auth@example.org" } } });
    expect(sessions).toHaveLength(0);

    // Verify /me now returns 401
    res = await meGet(makeRequest("/api/auth/me") as never);
    expect(res.status).toBe(401);
  });

  it("handles logout without existing session gracefully", async () => {
    cookieStore.clear();
    const res = await call(logoutPost, makeRequest("/api/auth/logout", { method: "POST" }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ok).toBe(true);
  });
});
