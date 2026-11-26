import { describe, expect, it } from "vitest";
import { ROLES, ROLE_PERMISSIONS, hasPermission } from "@/server/rbac";
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

describe("Products RBAC", () => {
  it("grants products:read to all roles", () => {
    expect(hasPermission(fakeUser("SALES_REP"), "products:read")).toBe(true);
    expect(hasPermission(fakeUser("MANAGER"), "products:read")).toBe(true);
    expect(hasPermission(fakeUser("ADMIN"), "products:read")).toBe(true);
  });
  it("grants products:create to all roles", () => {
    expect(hasPermission(fakeUser("SALES_REP"), "products:create")).toBe(true);
    expect(hasPermission(fakeUser("MANAGER"), "products:create")).toBe(true);
    expect(hasPermission(fakeUser("ADMIN"), "products:create")).toBe(true);
  });
  it("grants products:update to all roles", () => {
    expect(hasPermission(fakeUser("SALES_REP"), "products:update")).toBe(true);
    expect(hasPermission(fakeUser("MANAGER"), "products:update")).toBe(true);
    expect(hasPermission(fakeUser("ADMIN"), "products:update")).toBe(true);
  });
  it("grants products:delete to all roles", () => {
    expect(hasPermission(fakeUser("SALES_REP"), "products:delete")).toBe(true);
    expect(hasPermission(fakeUser("MANAGER"), "products:delete")).toBe(true);
    expect(hasPermission(fakeUser("ADMIN"), "products:delete")).toBe(true);
  });
});

describe("PriceLists RBAC", () => {
  it("grants pricelists:read to all roles", () => {
    expect(hasPermission(fakeUser("SALES_REP"), "pricelists:read")).toBe(true);
    expect(hasPermission(fakeUser("MANAGER"), "pricelists:read")).toBe(true);
    expect(hasPermission(fakeUser("ADMIN"), "pricelists:read")).toBe(true);
  });
  it("grants pricelists:create to all roles", () => {
    expect(hasPermission(fakeUser("SALES_REP"), "pricelists:create")).toBe(true);
    expect(hasPermission(fakeUser("MANAGER"), "pricelists:create")).toBe(true);
    expect(hasPermission(fakeUser("ADMIN"), "pricelists:create")).toBe(true);
  });
  it("grants pricelists:update to all roles", () => {
    expect(hasPermission(fakeUser("SALES_REP"), "pricelists:update")).toBe(true);
    expect(hasPermission(fakeUser("MANAGER"), "pricelists:update")).toBe(true);
    expect(hasPermission(fakeUser("ADMIN"), "pricelists:update")).toBe(true);
  });
  it("grants pricelists:delete to all roles", () => {
    expect(hasPermission(fakeUser("SALES_REP"), "pricelists:delete")).toBe(true);
    expect(hasPermission(fakeUser("MANAGER"), "pricelists:delete")).toBe(true);
    expect(hasPermission(fakeUser("ADMIN"), "pricelists:delete")).toBe(true);
  });
});
