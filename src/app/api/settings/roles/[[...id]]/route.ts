import { z } from "zod";
import { apiHandler, ok, parseBody, ApiNotFoundError, ApiValidationError, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id?: string[] }> };
async function resolveId(ctx: Ctx): Promise<string | null> {
  const parts = (await ctx.params) as unknown as { id?: string[] };
  const segs = parts.id;
  return segs && segs.length > 0 && segs[0] ? segs[0] : null;
}

const roleUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(200).optional(),
});

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  const user = await requireApiUserWith("roles:read");
  const role = await db.role.findFirst({
    where: { id, organizationId: user.organizationId },
    include: { rolePermissions: { include: { permission: true } } },
  });
  if (!role) throw new ApiNotFoundError("Role not found");
  return ok(role);
});

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  const actor = await requireApiUserWith("roles:manage");
  const target = await db.role.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!target) throw new ApiNotFoundError("Role not found");
  if (target.isSystem) throw new ApiValidationError([{ path: ["id"], message: "Cannot modify a system role" }]);
  const body = await parseBody(req, roleUpdateSchema);
  const updated = await db.role.update({ where: { id }, data: body });
  await writeAudit({ organizationId: actor.organizationId, userId: actor.id, action: "ROLE_UPDATE", entityType: "role", entityId: id, ipAddress: clientIp(req) });
  return ok(updated);
});

export const DELETE = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  const actor = await requireApiUserWith("roles:manage");
  const target = await db.role.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!target) throw new ApiNotFoundError("Role not found");
  if (target.isSystem) throw new ApiValidationError([{ path: ["id"], message: "Cannot delete a system role" }]);
  await db.role.delete({ where: { id } });
  await writeAudit({ organizationId: actor.organizationId, userId: actor.id, action: "ROLE_DELETE", entityType: "role", entityId: id, ipAddress: clientIp(req) });
  return ok({ deleted: true });
});
