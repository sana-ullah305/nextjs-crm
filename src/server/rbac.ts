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

/**
 * May the actor reassign a record's owner/assignee to `targetId`?
 *
 * - Clearing the assignment (null) is always allowed.
 * - Assigning to yourself is always allowed.
 * - Assigning to anyone else requires the entity's `*_update_all` permission
 *   (managers/admins). A rep cannot transfer "their" record to another rep,
 *   which would let them read records they otherwise couldn't via ownership.
 */
export function canReassignRecord(
  user: Pick<SessionUser, "id" | "role">,
  targetId: string | null | undefined,
  writeAllPerm: Permission
): boolean {
  if (!targetId) return true;
  if (targetId === user.id) return true;
  return hasPermission(user, writeAllPerm);
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

/**
 * Build the Prisma `where` fragment that scopes a LIST query to the records a
 * user may read. Reps (without the read_all permission) are limited to rows
 * they own or that are unowned; managers/admins get an empty fragment (no
 * extra restriction).
 *
 * IMPORTANT: callers MUST merge this fragment under `AND` alongside any other
 * `OR` clause (e.g. a free-text search). Spreading two `OR` keys into the same
 * object silently overwrites the first — the visibility clause would be lost
 * and a rep could enumerate other reps' records via search. Use:
 *
 *   where: { organizationId, ...rest, AND: [ visibilityScope(...), ...extra ] }
 */
export function visibilityScope(
  user: Pick<SessionUser, "role" | "id">,
  readAllPerm: Permission,
  ownerField: "ownerId" | "assignedUserId" = "ownerId"
): Record<string, unknown> {
  if (hasPermission(user as SessionUser, readAllPerm)) return {};
  return { OR: [{ [ownerField]: user.id }, { [ownerField]: null }] };
}
