import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let authorization: string | null = null;
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (_name: string) => authorization,
  }),
}));

describe("verifySchedulerSecret", () => {
  const secret = "test-scheduler-secret-0123456789abcdef";

  beforeEach(() => {
    vi.resetModules();
    authorization = null;
    delete process.env.SCHEDULER_SECRET;
  });

  afterEach(() => {
    delete process.env.SCHEDULER_SECRET;
  });

  it("returns false when SCHEDULER_SECRET is not configured", async () => {
    const { verifySchedulerSecret } = await import("@/server/scheduler-auth");
    expect(await verifySchedulerSecret()).toBe(false);
  });

  it("returns false when no Authorization header is sent", async () => {
    process.env.SCHEDULER_SECRET = secret;
    const { verifySchedulerSecret } = await import("@/server/scheduler-auth");
    expect(await verifySchedulerSecret()).toBe(false);
  });

  it("returns false for a non-Bearer scheme", async () => {
    process.env.SCHEDULER_SECRET = secret;
    authorization = "Basic dXNlcjpwYXNz";
    const { verifySchedulerSecret } = await import("@/server/scheduler-auth");
    expect(await verifySchedulerSecret()).toBe(false);
  });

  it("returns true for a valid Bearer token", async () => {
    process.env.SCHEDULER_SECRET = secret;
    authorization = `Bearer ${secret}`;
    const { verifySchedulerSecret } = await import("@/server/scheduler-auth");
    expect(await verifySchedulerSecret()).toBe(true);
  });

  it("returns false for the wrong token", async () => {
    process.env.SCHEDULER_SECRET = secret;
    authorization = "Bearer wrong-token";
    const { verifySchedulerSecret } = await import("@/server/scheduler-auth");
    expect(await verifySchedulerSecret()).toBe(false);
  });

  it("returns false when the token length differs (no timing leak path)", async () => {
    process.env.SCHEDULER_SECRET = secret;
    authorization = "Bearer short";
    const { verifySchedulerSecret } = await import("@/server/scheduler-auth");
    expect(await verifySchedulerSecret()).toBe(false);
  });
});
