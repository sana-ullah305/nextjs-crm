import { NextRequest } from "next/server";
import { apiHandler, ok, fail, ApiNotFoundError } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

type Ctx = { params: Promise<{ id?: string[]; memberId?: string[] }> };

async function resolveIds(ctx: Ctx): Promise<{ teamId: string | null; memberId: string | null }> {
  const parts = (await ctx.params) as unknown as { id?: string[]; memberId?: string[] };
  return {
    teamId: parts.id && parts.id.length > 0 ? parts.id[0] : null,
    memberId: parts.memberId && parts.memberId.length > 0 ? parts.memberId[0] : null,
  };
}

export const DELETE = apiHandler<Ctx>(async (_req, ctx) => {
  const user = await requireApiUserWith("salesTeams:manage");
  const { teamId, memberId } = await resolveIds(ctx);
  if (!teamId || !memberId) {
    return fail(404, "NOT_FOUND", "Not found");
  }
  const membership = await db.teamMember.findFirst({
    where: { id: memberId, teamId },
    include: { team: { select: { organizationId: true } } },
  });
  if (!membership || membership.team.organizationId !== user.organizationId) {
    throw new ApiNotFoundError("Team membership not found");
  }
  await db.teamMember.delete({ where: { id: memberId } });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "TEAM_MEMBER_REMOVE",
    entityType: "teamMember",
    entityId: memberId,
    metadata: { removedUserId: membership.userId, teamId },
  });
  return ok({ deleted: true });
});
