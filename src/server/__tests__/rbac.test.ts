import { describe, expect, it } from "vitest";
import { ROLES, ROLE_PERMISSIONS, hasPermission, canAccessRecord } from "@/server/rbac";
import type { SessionUser } from "@/server/auth";

function fakeUser(role: string): SessionUser {
  return {
    id: "u1",
    organizationId: "org1",
    email: "a@b.c",
    name: "A",
    role,
    avatarColor: "#000000",
    title: "",
  };
}

describe("RBAC permission matrix", () => {
  it("gives admins user management", () => {
    expect(hasPermission(fakeUser("ADMIN"), "users:manage")).toBe(true);
    expect(hasPermission(fakeUser("MANAGER"), "users:manage")).toBe(false);
    expect(hasPermission(fakeUser("SALES_REP"), "users:manage")).toBe(false);
  });

  it("gives managers read-all on contacts, reps do not", () => {
    expect(hasPermission(fakeUser("MANAGER"), "contacts:read_all")).toBe(true);
    expect(hasPermission(fakeUser("SALES_REP"), "contacts:read_all")).toBe(false);
  });

  it("lets reps convert leads", () => {
    expect(hasPermission(fakeUser("SALES_REP"), "leads:convert")).toBe(true);
  });

  it("restricts pipeline management to admins", () => {
    expect(hasPermission(fakeUser("ADMIN"), "pipelines:manage")).toBe(true);
    expect(hasPermission(fakeUser("MANAGER"), "pipelines:manage")).toBe(false);
  });

  it("denies audit access to reps", () => {
    expect(hasPermission(fakeUser("SALES_REP"), "audit:read")).toBe(false);
    expect(hasPermission(fakeUser("MANAGER"), "audit:read")).toBe(true);
  });

  it("returns false for unknown roles", () => {
    expect(hasPermission(fakeUser("GODMODE"), "users:manage")).toBe(false);
  });

  it("covers every defined role in the matrix", () => {
    expect(ROLE_PERMISSIONS[ROLES.ADMIN].length).toBeGreaterThan(
      ROLE_PERMISSIONS[ROLES.SALES_REP].length
    );
  });
});

describe("Quotations RBAC", () => {
  it("grants quotations:read/create to all roles, manage to managers+", () => {
    expect(hasPermission(fakeUser("SALES_REP"), "quotations:read")).toBe(true);
    expect(hasPermission(fakeUser("SALES_REP"), "quotations:create")).toBe(true);
    expect(hasPermission(fakeUser("SALES_REP"), "quotations:manage")).toBe(false);
    expect(hasPermission(fakeUser("MANAGER"), "quotations:read")).toBe(true);
    expect(hasPermission(fakeUser("MANAGER"), "quotations:create")).toBe(true);
    expect(hasPermission(fakeUser("MANAGER"), "quotations:manage")).toBe(true);
    expect(hasPermission(fakeUser("ADMIN"), "quotations:manage")).toBe(true);
  });
});

describe("SalesOrders RBAC", () => {
  it("grants salesOrders:read/create to all roles, manage to managers+", () => {
    expect(hasPermission(fakeUser("SALES_REP"), "salesOrders:read")).toBe(true);
    expect(hasPermission(fakeUser("SALES_REP"), "salesOrders:create")).toBe(true);
    expect(hasPermission(fakeUser("SALES_REP"), "salesOrders:manage")).toBe(false);
    expect(hasPermission(fakeUser("MANAGER"), "salesOrders:read")).toBe(true);
    expect(hasPermission(fakeUser("MANAGER"), "salesOrders:create")).toBe(true);
    expect(hasPermission(fakeUser("MANAGER"), "salesOrders:manage")).toBe(true);
    expect(hasPermission(fakeUser("ADMIN"), "salesOrders:manage")).toBe(true);
  });
});

describe("record-level access", () => {
  it("lets admins and managers access any record", () => {
    expect(canAccessRecord(fakeUser("ADMIN"), "someone-else")).toBe(true);
    expect(canAccessRecord(fakeUser("MANAGER"), "someone-else")).toBe(true);
  });

  it("restricts reps to their own records", () => {
    expect(canAccessRecord(fakeUser("SALES_REP"), "u1")).toBe(true);
    expect(canAccessRecord(fakeUser("SALES_REP"), "someone-else")).toBe(false);
  });

  it("treats unowned records as accessible to reps", () => {
    expect(canAccessRecord(fakeUser("SALES_REP"), null)).toBe(true);
  });
});
