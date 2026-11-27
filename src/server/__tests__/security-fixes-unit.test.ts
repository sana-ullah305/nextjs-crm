import { describe, expect, it } from "vitest";
import { visibilityScope, canReassignRecord } from "@/server/rbac";
import type { SessionUser } from "@/server/auth";
import nextConfig from "../../../next.config";

function fakeUser(role: string, id = "u1"): SessionUser {
  return {
    id,
    organizationId: "org1",
    email: "a@b.c",
    name: "A",
    role,
    avatarColor: "#000000",
    title: "",
  };
}

describe("visibilityScope (RBAC filter-override fix)", () => {
  it("returns empty fragment for managers/admins (read_all)", () => {
    expect(visibilityScope(fakeUser("MANAGER"), "contacts:read_all")).toEqual({});
    expect(visibilityScope(fakeUser("ADMIN"), "contacts:read_all")).toEqual({});
  });

  it("returns OR visibility clause for reps without read_all", () => {
    const scope = visibilityScope(fakeUser("SALES_REP", "u1"), "contacts:read_all") as { OR?: unknown[] };
    expect(Array.isArray(scope.OR)).toBe(true);
    expect(scope.OR).toHaveLength(2);
  });

  it("honours an alternate owner field (assignedUserId for leads)", () => {
    const scope = visibilityScope(fakeUser("SALES_REP", "u1"), "leads:read_all", "assignedUserId") as { OR?: Array<Record<string, unknown>> };
    expect(scope.OR?.[0]).toHaveProperty("assignedUserId");
  });
});

describe("canReassignRecord (owner/assignee reassignment validation)", () => {
  it("allows clearing (null) and self-assignment for anyone", () => {
    expect(canReassignRecord(fakeUser("SALES_REP", "u1"), null, "contacts:update_all")).toBe(true);
    expect(canReassignRecord(fakeUser("SALES_REP", "u1"), "u1", "contacts:update_all")).toBe(true);
  });

  it("blocks reps from assigning to another user", () => {
    expect(canReassignRecord(fakeUser("SALES_REP", "u1"), "u2", "contacts:update_all")).toBe(false);
    expect(canReassignRecord(fakeUser("SALES_REP", "u1"), "u2", "leads:update_all")).toBe(false);
    expect(canReassignRecord(fakeUser("SALES_REP", "u1"), "u2", "deals:update_all")).toBe(false);
  });

  it("allows managers/admins to assign to another user", () => {
    expect(canReassignRecord(fakeUser("MANAGER", "u1"), "u2", "contacts:update_all")).toBe(true);
    expect(canReassignRecord(fakeUser("ADMIN", "u1"), "u2", "contacts:update_all")).toBe(true);
  });
});

describe("security headers (next.config.ts)", () => {
  it("emits CSP and HSTS on all routes", async () => {
    const headersFn = nextConfig.headers as () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>>;
    const groups = await headersFn();
    const headers = groups[0].headers;
    const csp = headers.find((h) => h.key === "Content-Security-Policy");
    const hsts = headers.find((h) => h.key === "Strict-Transport-Security");
    expect(csp).toBeDefined();
    expect(csp!.value).toContain("default-src 'self'");
    expect(csp!.value).toContain("frame-ancestors 'none'");
    expect(hsts).toBeDefined();
    expect(hsts!.value).toContain("max-age=");
    // X-Frame-Options retained as defense-in-depth.
    const xfo = headers.find((h) => h.key === "X-Frame-Options");
    expect(xfo?.value).toBe("DENY");
  });
});
