import { getSessionUser, type SessionUser } from "@/server/auth";

export const ROLES = {
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  SALES_REP: "SALES_REP",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const PERMISSIONS = [
  // users
  "users:read",
  "users:manage",
  // org settings
  "settings:manage",
  "settings:read",
  // contacts / companies
  "contacts:read",
  "contacts:read_all",
  "contacts:create",
  "contacts:update",
  "contacts:update_all",
  "contacts:delete",
  "contacts:delete_all",
  "contacts:import",
  "contacts:export",
  // leads
  "leads:read",
  "leads:read_all",
  "leads:create",
  "leads:update",
  "leads:update_all",
  "leads:delete",
  "leads:delete_all",
  "leads:convert",
  // deals
  "deals:read",
  "deals:read_all",
  "deals:create",
  "deals:update",
  "deals:update_all",
  "deals:delete",
  "deals:delete_all",
  // pipeline config
  "pipelines:manage",
  // tasks
  "tasks:read",
  "tasks:read_all",
  "tasks:create",
  "tasks:update",
  "tasks:update_all",
  "tasks:delete",
  "tasks:delete_all",
  // activities/notes
  "activities:read",
  "activities:create",
  "notes:create",
  "notes:delete",
  "notes:delete_all",
  // reports
  "reports:read",
  // audit
  "audit:read",
  // email outreach
  "email:send",
  // reminders run (managers/admins may trigger scans on demand)
  "reminders:run",
  // inbound mail scan (managers/admins may trigger scans on demand)
  "inbound:run",
  // sequence mail scan (managers/admins may trigger scans on demand)
  "sequences:run",
  // meetings
  "meetings:read",
  "meetings:create",
  "meetings:manage",
  // calls
  "calls:read",
  "calls:create",
  "calls:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS] as Permission[];

const MANAGER_PERMS: Permission[] = ALL.filter(
  (p) =>
    !p.startsWith("users:") &&
    p !== "settings:manage" &&
    p !== "pipelines:manage" &&
    p !== "notes:delete_all"
);
const REP_PERMS: Permission[] = [
  "settings:read",
  "contacts:read",
  "contacts:create",
  "contacts:update",
  "contacts:delete",
  "contacts:import",
  "contacts:export",
  "leads:read",
  "leads:create",
  "leads:update",
  "leads:delete",
  "leads:convert",
  "deals:read",
  "deals:create",
  "deals:update",
  "deals:delete",
  "tasks:read",
  "tasks:create",
  "tasks:update",
  "tasks:delete",
  "activities:read",
  "activities:create",
  "notes:create",
  "notes:delete",
  "email:send",
  "meetings:read",
  "meetings:create",
  "calls:read",
  "calls:create",
];

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  ADMIN: ALL,
  MANAGER: MANAGER_PERMS,
  SALES_REP: REP_PERMS,
};

export function hasPermission(user: Pick<SessionUser, "role">, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[user.role];
  return Boolean(perms?.includes(permission));
}

export function canAccessRecord(
  user: SessionUser,
  ownerId: string | null | undefined
): boolean {
  if (user.role === ROLES.ADMIN || user.role === ROLES.MANAGER) return true;
  // Unowned records are visible/editable per list scoping (OR ownerId = user OR ownerId = null).
  return !ownerId || ownerId === user.id;
}

export async function requireApiUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new ApiAuthError();
  }
  return user;
}

export class ApiAuthError extends Error {
  constructor() {
    super("Unauthorized");
  }
}

export class ApiForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
  }
}

export async function requireApiUserWith(permission: Permission): Promise<SessionUser> {
  const user = await requireApiUser();
  if (!hasPermission(user, permission)) {
    throw new ApiForbiddenError();
  }
  return user;
}

// Convenience: scope rules for list queries. Reps only see their own records
// unless the feature uses shared read (e.g. pipeline board).
export function recordScope<T extends { ownerId?: string | null }>(
  user: SessionUser,
  rows: T[],
  readAllPerm: Permission
): T[] {
  if (hasPermission(user, readAllPerm)) return rows;
  return rows.filter((r) => !r.ownerId || r.ownerId === user.id);
}
