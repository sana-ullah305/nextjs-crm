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
  const role = await db.role.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!role) throw new ApiNotFoundError("Role not found");
  const perms = await db.rolePermission.findMany({ where: { roleId: id }, include: { permission: true } });
  return ok({ permissions: perms.map((p) => p.permission) });
});

const addSchema = z.object({ permissionIds: z.array(z.string()).min(1), remove: z.boolean().optional() });

export const POST = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  const actor = await requireApiUserWith("roles:manage");
  const role = await db.role.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!role) throw new ApiNotFoundError("Role not found");
  const body = await parseBody(req, addSchema);
  if (body.remove) {
    await db.rolePermission.deleteMany({ where: { roleId: id, permissionId: { in: body.permissionIds } } });
  } else {
    for (const pid of body.permissionIds) {
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: id, permissionId: pid } },
        create: { roleId: id, permissionId: pid },
        update: {},
      });
    }
  }
  await writeAudit({ organizationId: actor.organizationId, userId: actor.id, action: "ROLE_PERMS_UPDATE", entityType: "role", entityId: id, ipAddress: clientIp(req) });
  return ok({ updated: true });
});
