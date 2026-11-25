import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseBody, parseQuery, ApiNotFoundError, clientIp } from "@/server/api";
import { requireApiUserWith, hasPermission, recordScope } from "@/server/rbac";
import { taskCreateSchema, taskUpdateSchema } from "@/lib/schemas";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

type Ctx = { params: Promise<{ id?: string[] }> };

async function resolveId(ctx: Ctx): Promise<string | null> {
  const parts = (await ctx.params) as unknown as { id?: string[] };
  const segs = parts.id;
  return segs && segs.length > 0 && segs[0] ? segs[0] : null;
}

function parseDate(v: string | undefined | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const listQuerySchema = z.object({
  status: z.string().trim().max(20).optional(),
  assignedUserId: z.string().trim().max(64).optional(),
  type: z.string().trim().max(20).optional(),
  priority: z.string().trim().max(20).optional(),
  relatedType: z.string().trim().max(20).optional(),
  relatedId: z.string().trim().max(64).optional(),
  due: z.enum(["overdue", "today", "week", "all"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") return listTasks(req);
  return listTasks(req);
});

async function listTasks(req: NextRequest) {
  const user = await requireApiUserWith("tasks:read");
  const q = parseQuery(req, listQuerySchema);
  const now = new Date();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const weekEnd = new Date(todayEnd.getTime() + 7 * 24 * 60 * 60 * 1000);

  const where = {
    ...recordScope(user, "task", "read"),
    ...(q.status ? { status: q.status } : { status: { in: ["PENDING", "IN_PROGRESS"] } }),
    ...(q.assignedUserId ? { assignedUserId: q.assignedUserId } : {}),
    ...(q.type ? { type: q.type } : {}),
    ...(q.priority ? { priority: q.priority } : {}),
    ...(q.relatedType ? { relatedType: q.relatedType } : {}),
    ...(q.relatedId ? { relatedId: q.relatedId } : {}),
    ...(q.due === "overdue"
      ? { dueAt: { lt: now } }
      : q.due === "today"
        ? { dueAt: { lte: todayEnd, gte: now } }
        : q.due === "week"
          ? { dueAt: { lte: weekEnd } }
          : {}),
  };
  const [total, tasks] = await Promise.all([
    db.task.count({ where }),
    db.task.findMany({
      where,
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        assignedUser: { select: { id: true, name: true, avatarColor: true } },
        createdBy: { select: { id: true, name: true } },
      },
    }),
  ]);
  return ok({ tasks, total, page: q.page, pageSize: q.pageSize });
}

export const POST = apiHandler<Ctx>(async (req, _ctx) => {
  const user = await requireApiUserWith("tasks:create");
  const body = await parseBody(req, taskCreateSchema);
  const task = await db.task.create({
    data: {
      organizationId: user.organizationId,
      title: body.title,
      description: body.description ?? "",
      type: body.type,
      priority: body.priority,
      dueAt: parseDate(body.dueAt),
      reminderAt: parseDate(body.reminderAt),
      relatedType: body.relatedType || null,
      relatedId: body.relatedId || null,
      createdById: user.id,
      assignedUserId: hasPermission(user, "tasks:update_all") ? (body.assignedUserId || user.id) : user.id,
    },
    include: {
      assignedUser: { select: { id: true, name: true, avatarColor: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });
  if (task.assignedUserId && task.assignedUserId !== user.id) {
    await db.notification.create({
      data: {
        organizationId: user.organizationId,
        userId: task.assignedUserId,
        title: `New task assigned: ${task.title}`,
        body: task.description,
        type: "TASK",
        link: "/tasks",
      },
    });
  }
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "TASK_CREATE",
    entityType: "task",
    entityId: task.id,
    ipAddress: clientIp(req),
  });
  return ok(task, { status: 201 });
});

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  const user = await requireApiUserWith("tasks:update");
  const task = await db.task.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { id: true, assignedUserId: true, createdById: true },
  });
  if (!task) throw new ApiNotFoundError("Task not found");
  const canUpdate =
    hasPermission(user, "tasks:update_all") ||
    task.assignedUserId === user.id ||
    task.createdById === user.id;
  if (!canUpdate) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
  }
  const body = await parseBody(req, taskUpdateSchema);
  const completing = body.status === "COMPLETED";
  const updated = await db.task.update({
    where: { id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.type !== undefined ? { type: body.type } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(completing ? { completedAt: new Date() } : {}),
      ...(body.status && !completing ? { completedAt: null } : {}),
      ...(body.dueAt !== undefined ? { dueAt: parseDate(body.dueAt) } : {}),
      ...(body.reminderAt !== undefined ? { reminderAt: parseDate(body.reminderAt) } : {}),
      ...(body.relatedType !== undefined ? { relatedType: body.relatedType || null } : {}),
      ...(body.relatedId !== undefined ? { relatedId: body.relatedId || null } : {}),
      ...(body.assignedUserId !== undefined ? { assignedUserId: body.assignedUserId || null } : {}),
    },
    include: {
      assignedUser: { select: { id: true, name: true, avatarColor: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });
  if (completing) {
    await db.activity.create({
      data: {
        organizationId: user.organizationId,
        type: "TASK_COMPLETED",
        title: `Task completed: ${updated.title}`,
        taskId: updated.id,
        userId: user.id,
      },
    });
  }
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "TASK_UPDATE",
    entityType: "task",
    entityId: id,
    ipAddress: clientIp(req),
  });
  return ok(updated);
});

export const DELETE = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  const user = await requireApiUserWith("tasks:delete");
  const task = await db.task.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { assignedUserId: true, createdById: true },
  });
  if (!task) throw new ApiNotFoundError("Task not found");
  const canDelete =
    hasPermission(user, "tasks:delete_all") ||
    task.assignedUserId === user.id ||
    task.createdById === user.id;
  if (!canDelete) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
  }
  await db.task.delete({ where: { id } });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "TASK_DELETE",
    entityType: "task",
    entityId: id,
    ipAddress: clientIp(req),
  });
  return ok({ deleted: true });
});
