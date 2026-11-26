import { describe, expect, it, beforeEach, vi } from "vitest";
import { rateLimit, resetRateLimiter } from "@/server/rate-limit";

describe("sliding-window rate limiter", () => {
  beforeEach(() => resetRateLimiter());

  it("allows up to the limit then blocks", () => {
    const key = "test:allow";
    for (let i = 0; i < 5; i++) {
      expect(rateLimit(key, 5, 60_000).allowed).toBe(true);
    }
    const blocked = rateLimit(key, 5, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks keys independently", () => {
    for (let i = 0; i < 3; i++) rateLimit("k1", 3, 60_000);
    expect(rateLimit("k1", 3, 60_000).allowed).toBe(false);
    expect(rateLimit("k2", 3, 60_000).allowed).toBe(true);
  });

  it("reports remaining count", () => {
    const first = rateLimit("k3", 10, 60_000);
    expect(first.remaining).toBe(9);
  });
});

// Login rate-limit integration test - needs longer timeout for bcrypt
describe("login rate-limit integration", { timeout: 30_000 }, () => {
  it("rate-limits after 10 bad logins", async () => {
    const { hashPassword } = await import("@/server/auth");
    const { db } = await import("@/server/db");
    const { POST: loginRoute } = await import("@/app/api/auth/login/route");

    // Create a test user
    const orgId = (await db.organization.create({ data: { name: "Test Org Rate Limit" } })).id;
    const passwordHash = await hashPassword("password123");
    await db.user.create({
      data: { organizationId: orgId, name: "Test User", email: "ratelimit@example.org", passwordHash, role: "SALES_REP" },
    });

    const cookieStore = new Map<string, { name: string; value: string }>();
    vi.mock("next/headers", () => ({
      headers: async () => ({ get: (_name: string) => null }),
      cookies: async () => ({
        get: (name: string) => cookieStore.get(name),
        set: (name: string, value: string) => cookieStore.set(name, { name, value }),
        delete: (name: string) => cookieStore.delete(name),
      }),
    }));

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

    function call(handler: any, req: any, ctx?: any): Promise<Response> {
      return ctx !== undefined ? handler(req as never, ctx as never) : handler(req as never);
    }

    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      cookieStore.clear();
      const res = await call(loginRoute, makeRequest("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { email: "ratelimit@example.org", password: "wrong" },
      }), { params: Promise.resolve({}) });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
