import { NextRequest } from "next/server";
import { z } from "zod";
import { apiHandler, ok, fail, parseBody, ApiNotFoundError } from "@/server/api";
import { requireApiUserWith, hasPermission } from "@/server/rbac";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { teamUpdateSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id?: string[] }> };

const memberArgs = {
  select: {
    id: true,
    teamId: true,
    userId: true,
    role: true,
    createdAt: true,
    user: {
      select: { id: true, name: true, email: true, role: true, avatarColor: true, isActive: true },
    },
  },
  orderBy: { createdAt: "asc" as const },
};

const teamFields = {
  include: {
    _count: { select: { members: true } },
    members: memberArgs,
  },
};

async function resolveId(ctx: Ctx): Promise<string | null> {
  const parts = (await ctx.params) as unknown as { id?: string[] };
  const segs = parts.id;
  return segs && segs.length > 0 && segs[0] ? segs[0] : null;
}

async function findTeam(organizationId: string, id: string) {
  return db.team.findFirst({ where: { id, organizationId }, ...teamFields });
}

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const user = await requireApiUserWith("salesTeams:read");
  const id = await resolveId(ctx);
  if (!id) {
    return fail(404, "NOT_FOUND", "Team not found");
  }
  const team = await findTeam(user.organizationId, id);
  if (!team) throw new ApiNotFoundError("Team not found");
  return ok(team);
});

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const user = await requireApiUserWith("salesTeams:manage");
  const id = await resolveId(ctx);
  if (!id) {
    return fail(404, "NOT_FOUND", "Team not found");
  }
  const team = await findTeam(user.organizationId, id);
  if (!team) throw new ApiNotFoundError("Team not found");
  const body = await parseBody(req, teamUpdateSchema);
  if (body.name !== undefined && body.name !== team.name) {
    const existing = await db.team.findFirst({
      where: { organizationId: user.organizationId, name: body.name },
    });
    if (existing) {
      return fail(409, "CONFLICT", "A team with this name already exists in your organization");
    }
  }
  const updated = await db.team.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
    },
    ...teamFields,
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "TEAM_UPDATE",
    entityType: "team",
    entityId: id,
  });
  return ok(updated);
});

export const DELETE = apiHandler<Ctx>(async (req, ctx) => {
  const user = await requireApiUserWith("salesTeams:manage");
  const id = await resolveId(ctx);
  if (!id) {
    return fail(404, "NOT_FOUND", "Team not found");
  }
  const team = await findTeam(user.organizationId, id);
  if (!team) throw new ApiNotFoundError("Team not found");
  await db.team.delete({ where: { id } });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "TEAM_DELETE",
    entityType: "team",
    entityId: id,
  });
  return ok({ deleted: true });
});
