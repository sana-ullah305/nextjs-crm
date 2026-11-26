import { z } from "zod";
import { apiHandler, ok, parseBody, ApiValidationError, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

const roleCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).optional().default(""),
});

export const GET = apiHandler(async (req) => {
  const user = await requireApiUserWith("roles:read");
  const roles = await db.role.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { userRoles: true, rolePermissions: true } } },
  });
  return ok({ roles });
});

export const POST = apiHandler(async (req) => {
  const user = await requireApiUserWith("roles:create");
  const body = await parseBody(req, roleCreateSchema);
  const exists = await db.role.findFirst({
    where: { organizationId: user.organizationId, name: body.name },
  });
  if (exists) throw new ApiValidationError([{ path: ["name"], message: "Role already exists" }]);
  const role = await db.role.create({
    data: { organizationId: user.organizationId, name: body.name, description: body.description },
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "ROLE_CREATE",
    entityType: "role",
    entityId: role.id,
    ipAddress: clientIp(req),
  });
  return ok(role, { status: 201 });
});
