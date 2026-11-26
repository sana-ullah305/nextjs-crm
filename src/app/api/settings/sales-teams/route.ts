import { NextRequest } from "next/server";
import { z } from "zod";
import { apiHandler, ok, fail, parseBody, parseQuery } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { teamCreateSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{}> };

const listQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

const memberSelection = {
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

export const GET = apiHandler<Ctx>(async (req, _ctx) => {
  const user = await requireApiUserWith("salesTeams:read");
  const q = parseQuery(req, listQuerySchema);
  const where = {
    organizationId: user.organizationId,
    ...(q.q ? { name: { contains: q.q } } : {}),
  };
  const [total, teams] = await Promise.all([
    db.team.count({ where }),
    db.team.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        _count: { select: { members: true } },
        members: memberSelection,
      },
    }),
  ]);
  return ok({ teams, total, page: q.page, pageSize: q.pageSize });
});

export const POST = apiHandler<Ctx>(async (req) => {
  const user = await requireApiUserWith("salesTeams:create");
  const body = await parseBody(req, teamCreateSchema);

  const existing = await db.team.findFirst({
    where: { organizationId: user.organizationId, name: body.name },
  });
  if (existing) {
    return fail(409, "CONFLICT", "A team with this name already exists in your organization");
  }

  const team = await db.team.create({
    data: {
      organizationId: user.organizationId,
      name: body.name,
      description: body.description,
    },
    include: { members: memberSelection },
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "TEAM_CREATE",
    entityType: "team",
    entityId: team.id,
  });
  return ok(team, { status: 201 });
});
