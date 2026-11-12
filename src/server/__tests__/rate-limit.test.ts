import { describe, expect, it, beforeEach } from "vitest";
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
