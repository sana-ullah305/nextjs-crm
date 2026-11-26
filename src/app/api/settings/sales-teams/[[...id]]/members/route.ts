import { NextRequest } from "next/server";
import { z } from "zod";
import { apiHandler, ok, fail, parseBody, ApiNotFoundError } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { teamMemberAddSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id?: string[] }> };

const userFields = {
  select: { id: true, name: true, email: true, role: true, avatarColor: true, isActive: true },
};

const memberArgs = {
  select: {
    id: true,
    teamId: true,
    userId: true,
    role: true,
    createdAt: true,
    user: userFields,
  },
  orderBy: { createdAt: "asc" as const },
};

async function resolveTeamId(ctx: Ctx): Promise<string | null> {
  const parts = (await ctx.params) as unknown as { id?: string[] };
  const segs = parts.id;
  return segs && segs.length > 0 && segs[0] ? segs[0] : null;
}

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const user = await requireApiUserWith("salesTeams:read");
  const teamId = await resolveTeamId(ctx);
  if (!teamId) {
    return fail(404, "NOT_FOUND", "Team not found");
  }
  const team = await db.team.findFirst({
    where: { id: teamId, organizationId: user.organizationId },
    select: { id: true },
  });
  if (!team) throw new ApiNotFoundError("Team not found");
  const memberships = await db.teamMember.findMany({
    where: { teamId },
    ...memberArgs,
  });
  return ok(memberships);
});

export const POST = apiHandler<Ctx>(async (req, ctx) => {
  const currentUser = await requireApiUserWith("salesTeams:manage");
  const teamId = await resolveTeamId(ctx);
  if (!teamId) {
    return fail(404, "NOT_FOUND", "Team not found");
  }
  const team = await db.team.findFirst({
    where: { id: teamId, organizationId: currentUser.organizationId },
    select: { id: true },
  });
  if (!team) throw new ApiNotFoundError("Team not found");
  const body = await parseBody(req, teamMemberAddSchema);

  const memberUser = await db.user.findFirst({
    where: { id: body.userId, organizationId: currentUser.organizationId, isActive: true },
    select: { id: true },
  });
  if (!memberUser) {
    return fail(404, "NOT_FOUND", "User not found in your organization");
  }

  const membership = await db.teamMember.create({
    data: { teamId, userId: body.userId, role: body.role },
    include: { user: userFields },
  });
  await writeAudit({
    organizationId: currentUser.organizationId,
    userId: currentUser.id,
    action: "TEAM_MEMBER_ADD",
    entityType: "teamMember",
    entityId: membership.id,
  });
  return ok(membership, { status: 201 });
});
