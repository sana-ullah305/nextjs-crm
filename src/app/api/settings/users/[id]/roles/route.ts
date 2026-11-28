import { z } from "zod";
import { apiHandler, ok, parseBody, ApiNotFoundError, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };
async function resolveId(ctx: Ctx): Promise<string | null> {
  const parts = (await ctx.params) as unknown as { id?: string };
  const segs = parts.id;
  return segs ?? null;
}

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  const user = await requireApiUserWith("roles:read");
  const target = await db.user.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!target) throw new ApiNotFoundError("User not found");
  const roles = await db.userRole.findMany({ where: { userId: id }, include: { role: true } });
  return ok({ roles: roles.map((r) => r.role) });
});

const assignSchema = z.object({ roleId: z.string().min(1) });

export const POST = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  const actor = await requireApiUserWith("roles:manage");
  const target = await db.user.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!target) throw new ApiNotFoundError("User not found");
  const body = await parseBody(req, assignSchema);
  const role = await db.role.findFirst({ where: { id: body.roleId, organizationId: actor.organizationId } });
  if (!role) throw new ApiNotFoundError("Role not found");
  await db.userRole.upsert({
    where: { userId_roleId: { userId: id, roleId: body.roleId } },
    create: { userId: id, roleId: body.roleId },
    update: {},
  });
  await writeAudit({ organizationId: actor.organizationId, userId: actor.id, action: "USER_ROLE_ASSIGN", entityType: "user", entityId: id, ipAddress: clientIp(req) });
  return ok({ assigned: true });
});
