import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseBody, ApiNotFoundError, ApiValidationError, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { userCreateSchema, userUpdateSchema } from "@/lib/schemas";
import { hashPassword } from "@/server/auth";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

type Ctx = { params: Promise<{ id?: string[] }> };

async function resolveId(ctx: Ctx): Promise<string | null> {
  const parts = (await ctx.params) as unknown as { id?: string[] };
  const segs = parts.id;
  return segs && segs.length > 0 && segs[0] ? segs[0] : null;
}

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (id === "audit") return listAudit(req);
  const user = await requireApiUserWith("users:read");
  const users = await db.user.findMany({
    where: { organizationId: user.organizationId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      title: true,
      phone: true,
      avatarColor: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });
  return ok({ users });
});

async function listAudit(req: NextRequest) {
  const user = await requireApiUserWith("audit:read");
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const q = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(30),
      action: z.string().trim().max(60).optional(),
    })
    .parse(params);
  const where = {
    organizationId: user.organizationId,
    ...(q.action ? { action: q.action } : {}),
  };
  const [total, logs] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return ok({ logs, total, page: q.page, pageSize: q.pageSize });
}

export const POST = apiHandler<Ctx>(async (req, _ctx) => {
  const user = await requireApiUserWith("users:manage");
  const body = await parseBody(req, userCreateSchema);
  const existing = await db.user.findFirst({
    where: { organizationId: user.organizationId, email: body.email },
    select: { id: true },
  });
  if (existing) {
    throw new ApiValidationError([{ path: ["email"], message: "A user with this email already exists" }]);
  }
  const passwordHash = await hashPassword(body.password);
  const created = await db.user.create({
    data: {
      organizationId: user.organizationId,
      name: body.name,
      email: body.email,
      passwordHash,
      role: body.role,
      title: body.title ?? "",
      phone: body.phone,
      avatarColor: body.avatarColor ?? "#6366f1",
    },
    select: { id: true, name: true, email: true, role: true, avatarColor: true, isActive: true },
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "USER_CREATE",
    entityType: "user",
    entityId: created.id,
    ipAddress: clientIp(req),
  });
  return ok(created, { status: 201 });
});

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "audit") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  const actor = await requireApiUserWith("users:manage");
  const target = await db.user.findFirst({
    where: { id, organizationId: actor.organizationId },
  });
  if (!target) throw new ApiNotFoundError("User not found");

  const body = await parseBody(req, userUpdateSchema);

  if (
    (body.isActive === false || (body.role && body.role !== "ADMIN")) &&
    target.role === "ADMIN"
  ) {
    const activeAdmins = await db.user.count({
      where: { organizationId: actor.organizationId, role: "ADMIN", isActive: true },
    });
    if (activeAdmins <= 1) {
      throw new ApiValidationError([
        { path: ["role"], message: "Cannot modify the last active administrator" },
      ]);
    }
  }

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.title !== undefined) data.title = body.title;
  if (body.phone !== undefined) data.phone = body.phone;
  if (body.role !== undefined) data.role = body.role;
  if (body.isActive !== undefined) data.isActive = body.isActive;
  let passwordChanged = false;
  if (body.password !== undefined) {
    data.passwordHash = await hashPassword(body.password);
    passwordChanged = true;
  }

  const updated = await db.user.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, role: true, isActive: true, avatarColor: true },
  });
  // Password change invalidates every existing session for the account so
  // all other devices/tokens are forced to re-authenticate.
  if (passwordChanged) {
    await db.session.deleteMany({ where: { userId: id } });
  } else if (body.isActive === false) {
    await db.session.deleteMany({ where: { userId: id } });
  }
  await writeAudit({
    organizationId: actor.organizationId,
    userId: actor.id,
    action: "USER_UPDATE",
    entityType: "user",
    entityId: id,
    ipAddress: clientIp(req),
    metadata: { isActive: body.isActive, role: body.role },
  });
  return ok(updated);
});

export const DELETE = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "audit") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  const actor = await requireApiUserWith("users:manage");
  if (actor.id === id) {
    throw new ApiValidationError([{ path: ["id"], message: "You cannot delete your own account" }]);
  }
  const target = await db.user.findFirst({
    where: { id, organizationId: actor.organizationId },
    select: { role: true, isActive: true },
  });
  if (!target) throw new ApiNotFoundError("User not found");
  if (target.role === "ADMIN" && target.isActive) {
    const activeAdmins = await db.user.count({
      where: { organizationId: actor.organizationId, role: "ADMIN", isActive: true },
    });
    if (activeAdmins <= 1) {
      throw new ApiValidationError([{ path: ["id"], message: "Cannot delete the last active administrator" }]);
    }
  }
  await db.user.update({ where: { id }, data: { isActive: false } });
  await db.session.deleteMany({ where: { userId: id } });
  await writeAudit({
    organizationId: actor.organizationId,
    userId: actor.id,
    action: "USER_DELETE",
    entityType: "user",
    entityId: id,
    ipAddress: clientIp(req),
  });
  return ok({ deleted: true });
});
