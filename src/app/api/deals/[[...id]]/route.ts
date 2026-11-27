import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseBody, parseQuery, ApiNotFoundError, clientIp } from "@/server/api";
import { requireApiUserWith, hasPermission, canReassignRecord, canWriteRecord, recordScope } from "@/server/rbac";
import { dealCreateSchema, dealUpdateSchema, stageMoveSchema } from "@/lib/schemas";
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
  pipelineId: z.string().trim().max(64).optional(),
  status: z.string().trim().max(20).optional(),
  ownerId: z.string().trim().max(64).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") return listDeals(req);
  return getDeal(id);
});

async function listDeals(req: NextRequest) {
  const user = await requireApiUserWith("deals:read");
  const q = parseQuery(req, listQuerySchema);
  const searchClause = q.q
    ? { name: { contains: q.q } }
    : {};
  const where = {
    ...recordScope(user, "deal", "read"),
    deletedAt: null,
    ...(q.pipelineId ? { pipelineId: q.pipelineId } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.ownerId ? { ownerId: q.ownerId } : {}),
    AND: [searchClause],
  };
  const [total, deals] = await Promise.all([
    db.deal.count({ where }),
    db.deal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        stage: { select: { id: true, name: true, position: true, type: true, probability: true } },
        contact: { select: { id: true, firstName: true, lastName: true, avatarColor: true } },
        company: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true, avatarColor: true } },
      },
    }),
  ]);
  return ok({ deals, total, page: q.page, pageSize: q.pageSize });
}

async function getDeal(id: string) {
  const user = await requireApiUserWith("deals:read");
  const deal = await db.deal.findFirst({
    where: { ...recordScope(user, "deal", "read"), id, deletedAt: null },
    include: {
      stage: true,
      pipeline: { include: { stages: { orderBy: { position: "asc" } } } },
      contact: true,
      company: true,
      owner: { select: { id: true, name: true, avatarColor: true } },
      source: true,
    },
  });
  if (!deal) throw new ApiNotFoundError("Deal not found");
  if (!hasPermission(user, "deals:read_all") && deal.ownerId && deal.ownerId !== user.id) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Forbidden" } },
      { status: 403 }
    );
  }
  return ok(deal);
}

export const POST = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") return createDeal(req);
  return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown route" } }, { status: 404 });
});

async function createDeal(req: NextRequest) {
  const user = await requireApiUserWith("deals:create");
  const body = await parseBody(req, dealCreateSchema);
  if (body.ownerId && !canReassignRecord(user, body.ownerId, "deals:update_all")) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Forbidden" } },
      { status: 403 }
    );
  }
  const stage = await db.stage.findFirst({
    where: { id: body.stageId },
    include: { pipeline: true },
  });
  if (!stage) throw new ApiNotFoundError("Stage not found");
  const deal = await db.deal.create({
    data: {
      organizationId: user.organizationId,
      name: body.name,
      value: body.value,
      pipelineId: stage.pipelineId,
      stageId: body.stageId,
      contactId: body.contactId,
      companyId: body.companyId,
      ownerId: body.ownerId || user.id,
      sourceId: body.sourceId || null,
      expectedCloseDate: parseDate(body.expectedCloseDate),
      nextStep: body.nextStep,
      summary: body.notes ?? "",
      probability: stage.probability,
    },
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "DEAL_CREATE",
    entityType: "deal",
    entityId: deal.id,
    ipAddress: clientIp(req),
  });
  return ok(deal, { status: 201 });
}

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  const user = await requireApiUserWith("deals:update");
  const existing = await db.deal.findFirst({
    where: { id, organizationId: user.organizationId, deletedAt: null },
    select: { ownerId: true, stageId: true },
  });
  if (!existing) throw new ApiNotFoundError("Deal not found");
  if (!canWriteRecord(user, existing.ownerId, "deals:update_all")) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
  }
  const body = await parseBody(req, dealUpdateSchema);
  if (body.ownerId !== undefined && !canReassignRecord(user, body.ownerId || null, "deals:update_all")) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Forbidden" } },
      { status: 403 }
    );
  }
  const { ownerId, ...rest } = body;
  const data: Record<string, unknown> = {
    ...rest,
    ...(ownerId !== undefined ? { ownerId: ownerId || null } : {}),
    ...(rest.expectedCloseDate ? { expectedCloseDate: parseDate(rest.expectedCloseDate) } : {}),
  };
  const deal = await db.deal.update({ where: { id }, data });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "DEAL_UPDATE",
    entityType: "deal",
    entityId: id,
    ipAddress: clientIp(req),
  });
  return ok(deal);
});

export const DELETE = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  const user = await requireApiUserWith("deals:delete");
  const existing = await db.deal.findFirst({
    where: { id, organizationId: user.organizationId, deletedAt: null },
    select: { ownerId: true },
  });
  if (!existing) throw new ApiNotFoundError("Deal not found");
  if (!canWriteRecord(user, existing.ownerId, "deals:delete_all")) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
  }
  await db.deal.update({ where: { id }, data: { deletedAt: new Date() } });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "DEAL_DELETE",
    entityType: "deal",
    entityId: id,
    ipAddress: clientIp(req),
  });
  return ok({ deleted: true });
});
