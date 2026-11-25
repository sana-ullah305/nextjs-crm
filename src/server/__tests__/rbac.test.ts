import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLES, ROLE_PERMISSIONS, hasPermission, canAccessRecord, canWriteRecord, recordScope } from "@/server/rbac";
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

describe("recordScope (record-level authorization)", () => {
  const rep = { id: "u1", organizationId: "org1", email: "rep@example.org", name: "Rep", role: "SALES_REP", avatarColor: "#000000", title: "" };
  const manager = { id: "u2", organizationId: "org1", email: "m@example.org", name: "Mgr", role: "MANAGER", avatarColor: "#000000", title: "" };
  const admin = { id: "u3", organizationId: "org1", email: "a@example.org", name: "Admin", role: "ADMIN", avatarColor: "#000000", title: "" };

  it("exposes companies permissions and reps get companies:* but not *_all", () => {
    for (const perm of ["companies:read", "companies:read_all", "companies:create", "companies:update", "companies:update_all", "companies:delete", "companies:delete_all"]) {
      expect(PERMISSIONS).toContain(perm);
    }
    expect(hasPermission(rep, "companies:read")).toBe(true);
    expect(hasPermission(rep, "companies:create")).toBe(true);
    expect(hasPermission(rep, "companies:update")).toBe(true);
    expect(hasPermission(rep, "companies:delete")).toBe(true);
    expect(hasPermission(rep, "companies:read_all")).toBe(false);
    expect(hasPermission(rep, "companies:update_all")).toBe(false);
    expect(hasPermission(rep, "companies:delete_all")).toBe(false);
    expect(hasPermission(manager, "companies:read_all")).toBe(true);
    expect(hasPermission(manager, "companies:update_all")).toBe(true);
  });

  it("read scope: ADMIN/MANAGER are scoped only by organization (every org record)", () => {
    for (const model of ["contact", "company", "lead", "deal", "task", "activity", "sentEmail", "sequence"]) {
      expect(recordScope(admin, model, "read")).toEqual({ organizationId: "org1" });
      expect(recordScope(manager, model, "read")).toEqual({ organizationId: "org1" });
    }
  });

  it("read scope: reps see owned plus unowned records on shared models", () => {
    expect(recordScope(rep, "contact", "read")).toEqual({
      organizationId: "org1",
      OR: [{ ownerId: "u1" }, { ownerId: null }],
    });
    expect(recordScope(rep, "company", "read")).toEqual({
      organizationId: "org1",
      OR: [{ ownerId: "u1" }, { ownerId: null }],
    });
    expect(recordScope(rep, "lead", "read")).toEqual({
      organizationId: "org1",
      OR: [{ ownerId: "u1" }, { ownerId: null }, { assignedUserId: "u1" }, { assignedUserId: null }],
    });
    expect(recordScope(rep, "deal", "read")).toEqual({
      organizationId: "org1",
      OR: [{ ownerId: "u1" }, { ownerId: null }],
    });
  });

  it("read scope: reps see owned-only records on non-shared models", () => {
    expect(recordScope(rep, "task", "read")).toEqual({
      organizationId: "org1",
      OR: [{ assignedUserId: "u1" }, { createdById: "u1" }],
    });
    expect(recordScope(rep, "activity", "read")).toEqual({
      organizationId: "org1",
      OR: [{ userId: "u1" }],
    });
    expect(recordScope(rep, "sentEmail", "read")).toEqual({
      organizationId: "org1",
      OR: [{ userId: "u1" }],
    });
  });

  it("read scope: sequences are org-wide config with no ownership scoping", () => {
    expect(recordScope(rep, "sequence", "read")).toEqual({ organizationId: "org1" });
  });

  it("write scope: reps can only write records they own, never unowned ones", () => {
    expect(recordScope(rep, "contact", "write")).toEqual({ organizationId: "org1", ownerId: "u1" });
    expect(recordScope(rep, "company", "write")).toEqual({ organizationId: "org1", ownerId: "u1" });
    expect(recordScope(rep, "deal", "write")).toEqual({ organizationId: "org1", ownerId: "u1" });
    expect(recordScope(rep, "lead", "write")).toEqual({ organizationId: "org1", ownerId: "u1" });
    expect(recordScope(rep, "task", "write")).toEqual({ organizationId: "org1", assignedUserId: "u1" });
    expect(recordScope(rep, "activity", "write")).toEqual({ organizationId: "org1", userId: "u1" });
  });

  it("write scope: ADMIN/MANAGER are not ownership-restricted on write", () => {
    expect(recordScope(admin, "contact", "write")).toEqual({ organizationId: "org1" });
    expect(recordScope(manager, "contact", "write")).toEqual({ organizationId: "org1" });
  });

  it("decision: reps can READ unowned (org-shared) records but cannot WRITE them", () => {
    expect(canAccessRecord(rep, null)).toBe(true);
    expect(canAccessRecord(rep, "someone-else")).toBe(false);
    expect(canWriteRecord(rep, null, "contacts:update_all")).toBe(false);
    expect(canWriteRecord(rep, "someone-else", "contacts:update_all")).toBe(false);
    expect(canWriteRecord(rep, "u1", "contacts:update_all")).toBe(true);
  });
});
