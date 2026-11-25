import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseBody, parseQuery, ApiNotFoundError, ApiValidationError, clientIp } from "@/server/api";
import { requireApiUserWith, hasPermission } from "@/server/rbac";
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
  const where = {
    organizationId: user.organizationId,
    deletedAt: null,
    ...(q.pipelineId ? { pipelineId: q.pipelineId } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.ownerId ? { ownerId: q.ownerId } : {}),
    ...(q.q ? { name: { contains: q.q } } : {}),
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
    where: { id, organizationId: user.organizationId, deletedAt: null },
    include: {
      stage: true,
      pipeline: { include: { stages: { orderBy: { position: "asc" } } } },
      contact: true,
      company: true,
      owner: { select: { id: true, name: true, avatarColor: true } },
      source: true,
      stageHistory: {
        orderBy: { at: "asc" },
        include: {
          fromStage: { select: { id: true, name: true } },
          toStage: { select: { id: true, name: true, type: true } },
          user: { select: { id: true, name: true, avatarColor: true } },
        },
      },
    },
  });
  if (!deal) throw new ApiNotFoundError("Deal not found");
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
  const stage = await db.stage.findFirst({
    where: { id: body.stageId },
    include: { pipeline: true },
  });
  if (!stage || stage.pipeline.organizationId !== user.organizationId) {
    throw new ApiNotFoundError("Stage not found");
  }
  const deal = await db.deal.create({
    data: {
      organizationId: user.organizationId,
      name: body.name,
      contactId: body.contactId || null,
      companyId: body.companyId || null,
      stageId: stage.id,
      pipelineId: stage.pipelineId,
      ownerId: body.ownerId || user.id,
      sourceId: body.sourceId || null,
      value: body.value,
      expectedCloseDate: parseDate(body.expectedCloseDate),
      nextStep: body.nextStep,
      summary: body.notes,
      probability: stage.probability,
    },
    include: { stage: true },
  });
  await db.activity.create({
    data: {
      organizationId: user.organizationId,
      type: "CREATED",
      title: `Deal created: ${deal.name}`,
      dealId: deal.id,
      userId: user.id,
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
  if (!id || id === "list") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  const url = new URL(req.url);
  const isMove = url.searchParams.get("action") === "move";
  if (isMove) return moveDeal(req, id);
  return updateDeal(req, id);
});

async function moveDeal(req: NextRequest, dealId: string) {
  const user = await requireApiUserWith("deals:update");
  const body = await parseBody(req, stageMoveSchema);
  const deal = await db.deal.findFirst({
    where: { id: dealId, organizationId: user.organizationId, deletedAt: null },
    include: { stage: true },
  });
  if (!deal) throw new ApiNotFoundError("Deal not found");
  if (deal.ownerId && deal.ownerId !== user.id && !hasPermission(user, "deals:update_all")) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
  }
  const stage = await db.stage.findFirst({
    where: { id: body.stageId },
    include: { pipeline: true },
  });
  if (!stage || stage.pipeline.organizationId !== user.organizationId) {
    throw new ApiNotFoundError("Target stage not found");
  }

  const isStageChange = deal.stageId !== stage.id;
  const now = new Date();
  const isWon = stage.type === "WON";
  const isLost = stage.type === "LOST";

  // Require lostReasonId when moving to LOST stage
  if (isLost && !body.lostReasonId) {
    throw new ApiValidationError([
      { path: ["lostReasonId"], message: "lostReasonId is required when moving to a LOST stage" },
    ]);
  }

  // Determine wonAt / lostAt / actualCloseDate with preserve-on-reopen semantics
  let wonAt: Date | null = null;
  let lostAt: Date | null = null;
  let actualCloseDate: Date | null = null;
  let lostReasonId: string | null = null;

  if (isWon) {
    wonAt = deal.wonAt ?? now;
    lostAt = null;
    actualCloseDate = deal.actualCloseDate ?? now;
  } else if (isLost) {
    wonAt = null;
    lostAt = deal.lostAt ?? now;
    actualCloseDate = deal.actualCloseDate ?? now;
    lostReasonId = body.lostReasonId ?? null;
  } else {
    // Moving to OPEN — preserve existing wonAt/lostAt/actualCloseDate on reopen
    wonAt = deal.wonAt;
    lostAt = deal.lostAt;
    actualCloseDate = deal.actualCloseDate;
  }

  const updated = await db.deal.update({
    where: { id: dealId },
    data: {
      stageId: stage.id,
      pipelineId: stage.pipelineId,
      probability: stage.probability,
      status: isWon ? "WON" : isLost ? "LOST" : "OPEN",
      ...(isStageChange || body.position !== undefined ? {} : {}),
      ...(wonAt !== undefined ? { wonAt } : {}),
      ...(lostAt !== undefined ? { lostAt } : {}),
      ...(actualCloseDate !== undefined ? { actualCloseDate } : {}),
      ...(lostReasonId !== null ? { lostReasonId } : {}),
    },
    include: { stage: true },
  });

  // Create StageHistory record on stage change
  if (isStageChange) {
    await db.stageHistory.create({
      data: {
        dealId: deal.id,
        fromStageId: deal.stageId,
        toStageId: stage.id,
        userId: user.id,
        at: now,
        wonAtSnapshot: deal.wonAt,
        lostAtSnapshot: deal.lostAt,
        actualCloseDateSnapshot: deal.actualCloseDate,
      },
    });

    await db.activity.create({
      data: {
        organizationId: user.organizationId,
        type: isWon ? "DEAL_WON" : isLost ? "DEAL_LOST" : "STAGE_CHANGE",
        title: isWon
          ? `Deal won: ${deal.name}`
          : isLost
            ? `Deal lost: ${deal.name}`
            : `${deal.name}: ${deal.stage.name} \u2192 ${stage.name}`,
        dealId: deal.id,
        userId: user.id,
      },
    });
  }

  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "DEAL_STAGE_MOVE",
    entityType: "deal",
    entityId: dealId,
    ipAddress: clientIp(req),
    metadata: { from: deal.stage.name, to: stage.name },
  });
  return ok(updated);
}

async function updateDeal(req: NextRequest, dealId: string) {
  const user = await requireApiUserWith("deals:update");
  const deal = await db.deal.findFirst({
    where: { id: dealId, organizationId: user.organizationId, deletedAt: null },
    include: { stage: true },
  });
  if (!deal) throw new ApiNotFoundError("Deal not found");
  if (deal.ownerId && deal.ownerId !== user.id && !hasPermission(user, "deals:update_all")) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
  }
  const body = await parseBody(req, dealUpdateSchema);

  let stageUpdate: Record<string, unknown> = {};
  let stageHistoryData: Record<string, unknown> | null = null;
  let activityData: Record<string, unknown> | null = null;

  if (body.stageId) {
    const stage = await db.stage.findFirst({
      where: { id: body.stageId },
      include: { pipeline: true },
    });
    if (!stage || stage.pipeline.organizationId !== user.organizationId) {
      throw new ApiNotFoundError("Stage not found");
    }

    const isStageChange = deal.stageId !== stage.id;
    const now = new Date();
    const isWon = stage.type === "WON";
    const isLost = stage.type === "LOST";

    // Require lostReasonId when moving to LOST stage
    if (isLost && !body.lostReasonId) {
      throw new ApiValidationError([
        { path: ["lostReasonId"], message: "lostReasonId is required when moving to a LOST stage" },
      ]);
    }

    let wonAt: Date | null = null;
    let lostAt: Date | null = null;
    let actualCloseDate: Date | null = null;
    let lostReasonId: string | null = null;

    if (isWon) {
      wonAt = deal.wonAt ?? now;
      lostAt = null;
      actualCloseDate = deal.actualCloseDate ?? now;
    } else if (isLost) {
      wonAt = null;
      lostAt = deal.lostAt ?? now;
      actualCloseDate = deal.actualCloseDate ?? now;
      lostReasonId = body.lostReasonId ?? null;
    } else {
      wonAt = deal.wonAt;
      lostAt = deal.lostAt;
      actualCloseDate = deal.actualCloseDate;
    }

    stageUpdate = {
      stageId: stage.id,
      pipelineId: stage.pipelineId,
      probability: stage.probability,
      status: isWon ? "WON" : isLost ? "LOST" : "OPEN",
      ...(wonAt !== undefined ? { wonAt } : {}),
      ...(lostAt !== undefined ? { lostAt } : {}),
      ...(actualCloseDate !== undefined ? { actualCloseDate } : {}),
      ...(lostReasonId !== null ? { lostReasonId } : {}),
    };

    if (isStageChange) {
      stageHistoryData = {
        dealId: deal.id,
        fromStageId: deal.stageId,
        toStageId: stage.id,
        userId: user.id,
        at: now,
        wonAtSnapshot: deal.wonAt,
        lostAtSnapshot: deal.lostAt,
        actualCloseDateSnapshot: deal.actualCloseDate,
      };
      activityData = {
        organizationId: user.organizationId,
        type: isWon ? "DEAL_WON" : isLost ? "DEAL_LOST" : "STAGE_CHANGE",
        title: isWon
          ? `Deal won: ${deal.name}`
          : isLost
            ? `Deal lost: ${deal.name}`
            : `${deal.name}: ${deal.stage.name} \u2192 ${stage.name}`,
        dealId: deal.id,
        userId: user.id,
      };
    }
  }

  const updated = await db.deal.update({
    where: { id: dealId },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.currency !== undefined ? { currency: body.currency } : {}),
      ...(body.probability !== undefined ? { probability: body.probability } : {}),
      ...(body.contactId !== undefined ? { contactId: body.contactId || null } : {}),
      ...(body.companyId !== undefined ? { companyId: body.companyId || null } : {}),
      ...(body.ownerId !== undefined ? { ownerId: body.ownerId || null } : {}),
      ...(body.sourceId !== undefined ? { sourceId: body.sourceId || null } : {}),
      ...(body.value !== undefined ? { value: body.value } : {}),
      ...(body.status !== undefined && !body.stageId ? { status: body.status } : {}),
      ...(body.expectedCloseDate !== undefined
        ? { expectedCloseDate: parseDate(body.expectedCloseDate) }
        : {}),
      ...(body.nextStep !== undefined ? { nextStep: body.nextStep } : {}),
      ...(body.notes !== undefined ? { summary: body.notes } : {}),
      ...(body.lostReason !== undefined ? { lostReason: body.lostReason } : {}),
      ...stageUpdate,
    },
  });

  if (stageHistoryData) {
    await db.stageHistory.create({ data: stageHistoryData as any });
  }
  if (activityData) {
    await db.activity.create({ data: activityData as any });
  }

  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: body.stageId ? "DEAL_STAGE_MOVE" : "DEAL_UPDATE",
    entityType: "deal",
    entityId: dealId,
    ipAddress: clientIp(req),
    metadata: body.stageId ? { from: deal.stage.name, to: (await db.stage.findUnique({ where: { id: body.stageId } }))?.name } : undefined,
  });
  return ok(updated);
}

export const DELETE = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  const user = await requireApiUserWith("deals:delete");
  const deal = await db.deal.findFirst({
    where: { id, organizationId: user.organizationId, deletedAt: null },
    select: { ownerId: true },
  });
  if (!deal) throw new ApiNotFoundError("Deal not found");
  if (deal.ownerId && deal.ownerId !== user.id && !hasPermission(user, "deals:delete_all")) {
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
