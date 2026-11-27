import { getSessionUser, type SessionUser } from "@/server/auth";

export const ROLES = {
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  SALES_REP: "SALES_REP",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const PERMISSIONS = [
  "users:read",
  "users:manage",
  "settings:manage",
  "settings:read",
  "contacts:read",
  "contacts:read_all",
  "contacts:create",
  "contacts:update",
  "contacts:update_all",
  "contacts:delete",
  "contacts:delete_all",
  "contacts:import",
  "contacts:export",
  "companies:read",
  "companies:read_all",
  "companies:create",
  "companies:update",
  "companies:update_all",
  "companies:delete",
  "companies:delete_all",
  "leads:read",
  "leads:read_all",
  "leads:create",
  "leads:update",
  "leads:update_all",
  "leads:delete",
  "leads:delete_all",
  "leads:convert",
  "deals:read",
  "deals:read_all",
  "deals:create",
  "deals:update",
  "deals:update_all",
  "deals:delete",
  "deals:delete_all",
  "pipelines:manage",
  "tasks:read",
  "tasks:read_all",
  "tasks:create",
  "tasks:update",
  "tasks:update_all",
  "tasks:delete",
  "tasks:delete_all",
  "activities:read",
  "activities:create",
  "notes:create",
  "notes:delete",
  "notes:delete_all",
  "reports:read",
  "audit:read",
  "email:send",
  "reminders:run",
  "inbound:run",
  "sequences:run",
  // attachments
  "attachments:read",
  "attachments:create",
  "attachments:delete",
  // products
  "products:read",
  "products:create",
  "products:update",
  "products:delete",
  // price lists
  "pricelists:read",
  "pricelists:create",
  "pricelists:update",
  "pricelists:delete",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS] as Permission[];

const MANAGER_PERMS: Permission[] = ALL.filter(function (p) {
  return !p.startsWith("users:") &&
    p !== "settings:manage" &&
    p !== "pipelines:manage" &&
    p !== "notes:delete_all";
});
const REP_PERMS: Permission[] = [
  "settings:read",
  "contacts:read",
  "contacts:create",
  "contacts:update",
  "contacts:delete",
  "contacts:import",
  "contacts:export",
  "companies:read",
  "companies:create",
  "companies:update",
  "companies:delete",
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
  "attachments:read",
  "attachments:create",
  "attachments:delete",
  "email:send",
  "products:read",
  "products:create",
  "products:update",
  "products:delete",
  "pricelists:read",
  "pricelists:create",
  "pricelists:update",
  "pricelists:delete",
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


/**
 * Read access to a single record.
 *
 * - ADMIN/MANAGER: any record in the org.
 * - SALES_REP: their own records, plus unowned records (ownerId null).
 *   Unowned records are org-shared: readable by any rep in the org, but they
 *   are NOT writable (see canWriteRecord / recordScope write action).
 */
export function canAccessRecord(
  user: SessionUser,
  ownerId: string | null | undefined
): boolean {
  if (user.role === ROLES.ADMIN || user.role === ROLES.MANAGER) return true;
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

/**
 * Write access to a single record for a rep.
 *
 * - ADMIN/MANAGER and holders of the model's *_update_all (or *_delete_all)
 *   permission: any record.
 * - SALES_REP: only records they own. Unowned records are read-only.
 *
 * Decision: reps can READ unowned (org-shared) records but cannot WRITE them.
 */
export function canWriteRecord(
  user: SessionUser,
  ownerId: string | null | undefined,
  writeAllPerm: Permission
): boolean {
  if (user.role === ROLES.ADMIN || user.role === ROLES.MANAGER) return true;
  if (hasPermission(user, writeAllPerm)) return true;
  return Boolean(ownerId && ownerId === user.id);
}

export type RecordAction = "read" | "write";

type ModelScope = {
  ownerFields: string[];
  read: Permission;
  readAll?: Permission;
  writeAll?: Permission;
  includeUnownedOnRead?: boolean;
};

const MODEL_SCOPE: Record<string, ModelScope> = {
  contact: {
    ownerFields: ["ownerId"],
    read: "contacts:read",
    readAll: "contacts:read_all",
    writeAll: "contacts:update_all",
    includeUnownedOnRead: true,
  },
  company: {
    ownerFields: ["ownerId"],
    read: "companies:read",
    readAll: "companies:read_all",
    writeAll: "companies:update_all",
    includeUnownedOnRead: true,
  },
  lead: {
    ownerFields: ["ownerId", "assignedUserId"],
    read: "leads:read",
    readAll: "leads:read_all",
    writeAll: "leads:update_all",
    includeUnownedOnRead: true,
  },
  deal: {
    ownerFields: ["ownerId"],
    read: "deals:read",
    readAll: "deals:read_all",
    writeAll: "deals:update_all",
    includeUnownedOnRead: true,
  },
  task: {
    ownerFields: ["assignedUserId", "createdById"],
    read: "tasks:read",
    readAll: "tasks:read_all",
    writeAll: "tasks:update_all",
    includeUnownedOnRead: false,
  },
  activity: {
    ownerFields: ["userId"],
    read: "activities:read",
    includeUnownedOnRead: false,
  },
  sentEmail: {
    ownerFields: ["userId"],
    read: "activities:read",
    includeUnownedOnRead: false,
  },
  sequence: {
    ownerFields: [],
    read: "settings:read",
    includeUnownedOnRead: false,
  },
};


/**
 * Returns a Prisma `where` fragment that scopes a model to the user's
 * organization and, for non-privileged roles, to records the user may access.
 *
 * Read semantics (aligned across all models):
 *   - ADMIN/MANAGER (and any role holding the model's `*_read_all` permission)
 *     see every record in the org.
 *   - SALES_REP sees records they own plus unowned records. Unowned records are
 *     org-shared and readable, but NOT writable (use the `write` action or
 *     `canWriteRecord` for writes).
 *
 * Write semantics:
 *   - A rep may only write records they own. Unowned records are read-only.
 *   - ADMIN/MANAGER and `*_update_all` holders bypass ownership.
 *
 * The caller spreads the result into their Prisma `where` (it does not
 * include `id`, so detail routes still filter by `id` separately).
 *
 * @example
 * const where = { ...recordScope(user, "contact", "read"), id };
 * const contact = await db.contact.findFirst({ where });
 */
export function recordScope(
  user: SessionUser,
  model: string,
  action: RecordAction = "read"
): Record<string, unknown> {
  const scope: Record<string, unknown> = { organizationId: user.organizationId };
  const modelScope = MODEL_SCOPE[model];
  if (!modelScope) return scope;

  const privileged =
    user.role === ROLES.ADMIN || user.role === ROLES.MANAGER;

  if (action === "write") {
    const writeAll = modelScope.writeAll
      ? hasPermission(user, modelScope.writeAll)
      : false;
    if (!privileged && !writeAll && modelScope.ownerFields.length > 0) {
      scope[modelScope.ownerFields[0]] = user.id;
    }
    return scope;
  }

  const readAll = modelScope.readAll
    ? hasPermission(user, modelScope.readAll)
    : false;
  if (!privileged && !readAll && modelScope.ownerFields.length > 0) {
    const or: Record<string, unknown>[] = [];
    for (const field of modelScope.ownerFields) {
      or.push({ [field]: user.id });
      if (modelScope.includeUnownedOnRead) {
        or.push({ [field]: null });
      }
    }
    scope.OR = or;
  }
  return scope;
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
