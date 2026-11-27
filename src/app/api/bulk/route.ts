import { NextRequest, NextResponse } from "next/server";
import { apiHandler, ok, parseBody, ApiValidationError, clientIp } from "@/server/api";
import { requireApiUserWith, hasPermission, type Permission } from "@/server/rbac";
import { bulkActionSchema } from "@/lib/schemas";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

type EntityType = "contacts" | "leads" | "deals";
type Action = "delete" | "assign" | "addTag";

const PERMISSION: Record<EntityType, Record<Action, Permission>> = {
  contacts: {
    delete: "contacts:delete",
    assign: "contacts:update",
    addTag: "contacts:update",
  },
  leads: {
    delete: "leads:delete",
    assign: "leads:update",
    addTag: "leads:update",
  },
  deals: {
    delete: "deals:delete",
    assign: "deals:update",
    addTag: "deals:update",
  },
};

const AUDIT_ACTION: Record<EntityType, Record<Action, string>> = {
  contacts: { delete: "CONTACT_BULK_DELETE", assign: "CONTACT_BULK_ASSIGN", addTag: "CONTACT_BULK_TAG" },
  leads: { delete: "LEAD_BULK_DELETE", assign: "LEAD_BULK_ASSIGN", addTag: "LEAD_BULK_TAG" },
  deals: { delete: "DEAL_BULK_DELETE", assign: "DEAL_BULK_ASSIGN", addTag: "DEAL_BULK_TAG" },
};

export const POST = apiHandler<{}>(async (req: NextRequest) => {
  const body = await parseBody(req, bulkActionSchema);
  const { entityType, ids, action, params } = body;

  if (action === "addTag" && entityType !== "contacts") {
    throw new ApiValidationError([
      { path: ["action"], message: "addTag is only supported for contacts" },
    ]);
  }

  const user = await requireApiUserWith(PERMISSION[entityType][action]);

  let affected = 0;
  if (action === "delete") {
    affected = await bulkDelete(entityType, user, ids);
  } else if (action === "assign") {
    if (!params?.assigneeId) {
      throw new ApiValidationError([
        { path: ["params", "assigneeId"], message: "assigneeId is required for assign" },
      ]);
    }
    affected = await bulkAssign(entityType, user, ids, params.assigneeId);
  } else {
    const tagNames = params?.tagNames ?? [];
    if (tagNames.length === 0) {
      throw new ApiValidationError([
        { path: ["params", "tagNames"], message: "tagNames is required for addTag" },
      ]);
    }
    affected = await bulkAddTag(user, ids, tagNames);
  }

  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: AUDIT_ACTION[entityType][action],
    entityType: entityType,
    ipAddress: clientIp(req),
    metadata: { count: affected, action, ids },
  });
  return ok({ affected, action, entityType });
});

async function bulkDelete(entityType: EntityType, user: { organizationId: string; id: string; role: string }, ids: string[]): Promise<number> {
  if (entityType === "contacts") {
    const where = {
      id: { in: ids },
      organizationId: user.organizationId,
      deletedAt: null,
      ...(hasPermission(user, "contacts:delete_all") ? {} : { OR: [{ ownerId: user.id }, { ownerId: null }] }),
    };
    const res = await db.contact.updateMany({ where, data: { deletedAt: new Date() } });
    return res.count;
  }
  if (entityType === "leads") {
    const where = {
      id: { in: ids },
      organizationId: user.organizationId,
      deletedAt: null,
      ...(hasPermission(user, "leads:delete_all") ? {} : { OR: [{ ownerId: user.id }, { assignedUserId: user.id }, { assignedUserId: null }] }),
    };
    const res = await db.lead.updateMany({ where, data: { deletedAt: new Date() } });
    return res.count;
  }
  const where = {
    id: { in: ids },
    organizationId: user.organizationId,
    deletedAt: null,
    ...(hasPermission(user, "deals:delete_all") ? {} : { OR: [{ ownerId: user.id }, { ownerId: null }] }),
  };
  const res = await db.deal.updateMany({ where, data: { deletedAt: new Date() } });
  return res.count;
}

async function bulkAssign(
  entityType: EntityType,
  user: { organizationId: string; id: string; role: string },
  ids: string[],
  assigneeId: string
): Promise<number> {
  // Validate assignee belongs to the org.
  const assignee = await db.user.findFirst({
    where: { id: assigneeId, organizationId: user.organizationId },
    select: { id: true },
  });
  if (!assignee) {
    throw new ApiValidationError([
      { path: ["params", "assigneeId"], message: "Assignee not found in this organization" },
    ]);
  }
  if (entityType === "contacts") {
    const where = {
      id: { in: ids },
      organizationId: user.organizationId,
      deletedAt: null,
      ...(hasPermission(user, "contacts:update_all") ? {} : { OR: [{ ownerId: user.id }, { ownerId: null }] }),
    };
    const res = await db.contact.updateMany({ where, data: { ownerId: assigneeId } });
    return res.count;
  }
  if (entityType === "leads") {
    const where = {
      id: { in: ids },
      organizationId: user.organizationId,
      deletedAt: null,
      ...(hasPermission(user, "leads:update_all") ? {} : { OR: [{ ownerId: user.id }, { assignedUserId: user.id }, { assignedUserId: null }] }),
    };
    const res = await db.lead.updateMany({ where, data: { assignedUserId: assigneeId } });
    return res.count;
  }
  const where = {
    id: { in: ids },
    organizationId: user.organizationId,
    deletedAt: null,
    ...(hasPermission(user, "deals:update_all") ? {} : { OR: [{ ownerId: user.id }, { ownerId: null }] }),
  };
  const res = await db.deal.updateMany({ where, data: { ownerId: assigneeId } });
  return res.count;
}

async function bulkAddTag(
  user: { organizationId: string; id: string; role: string },
  ids: string[],
  tagNames: string[]
): Promise<number> {
  const tagIds: string[] = [];
  for (const name of tagNames) {
    const tag = await db.tag.upsert({
      where: { organizationId_name: { organizationId: user.organizationId, name } },
      create: { organizationId: user.organizationId, name },
      update: {},
    });
    tagIds.push(tag.id);
  }
  const where = {
    id: { in: ids },
    organizationId: user.organizationId,
    deletedAt: null,
    ...(hasPermission(user, "contacts:update_all") ? {} : { OR: [{ ownerId: user.id }, { ownerId: null }] }),
  };
  const contacts = await db.contact.findMany({ where, select: { id: true } });
  let affected = 0;
  for (const c of contacts) {
    await db.contact.update({
      where: { id: c.id },
      data: { tags: { connect: tagIds.map((id) => ({ id })) } },
    });
    affected++;
  }
  return affected;
}
