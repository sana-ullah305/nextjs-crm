import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseQuery, ApiNotFoundError } from "@/server/api";
import { requireApiUserWith, hasPermission } from "@/server/rbac";
import { campaignUpdateSchema, campaignListQuerySchema } from "@/lib/schemas";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { clientIp } from "@/server/api";

type Ctx = { params: Promise<{ id: string }> };

async function resolveId(ctx: Ctx): Promise<string | null> {
  const parts = (await ctx.params) as unknown as { id?: string };
  const segs = parts.id;
  return segs ?? null;
}

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") {
    return listCampaigns(req);
  }
  return getCampaign(id);
});

async function listCampaigns(req: NextRequest) {
  const user = await requireApiUserWith("campaigns:read");
  const q = parseQuery(req, campaignListQuerySchema);
  
  const where = {
    organizationId: user.organizationId,
    ...(q.status ? { status: q.status } : {}),
    ...(q.q
      ? {
          name: { contains: q.q },
        }
      : {}),
  };

  const [total, campaigns] = await Promise.all([
    db.campaign.count({ where }),
    db.campaign.findMany({
      where,
      orderBy:
        q.sort === "name"
          ? { name: "asc" }
          : q.sort === "budget"
          ? { budget: "desc" }
          : { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        _count: { select: { members: true } },
      },
    }),
  ]);

  return ok({ campaigns, total, page: q.page, pageSize: q.pageSize });
}

async function getCampaign(id: string) {
  const user = await requireApiUserWith("campaigns:read");
  const campaign = await db.campaign.findFirst({
    where: { id, organizationId: user.organizationId },
    include: {
      _count: { select: { members: true } },
    },
  });
  if (!campaign) throw new ApiNotFoundError("Campaign not found");
  return ok(campaign);
}

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Missing id" } },
      { status: 404 }
    );
  }

  const user = await requireApiUserWith("campaigns:update");
  const campaign = await db.campaign.findFirst({
    where: { id, organizationId: user.organizationId },
  });
  if (!campaign) throw new ApiNotFoundError("Campaign not found");

  const body = await req.json();
  const parsed = campaignUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid request", details: parsed.error.issues } },
      { status: 400 }
    );
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.description !== undefined) data.description = parsed.data.description;
  if (parsed.data.startDate !== undefined) data.startDate = parsed.data.startDate ? new Date(parsed.data.startDate) : null;
  if (parsed.data.endDate !== undefined) data.endDate = parsed.data.endDate ? new Date(parsed.data.endDate) : null;
  if (parsed.data.status !== undefined) data.status = parsed.data.status;
  if (parsed.data.budget !== undefined) data.budget = parsed.data.budget;
  if (parsed.data.cost !== undefined) data.cost = parsed.data.cost;

  const updated = await db.campaign.update({
    where: { id },
    data,
  });

  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "CAMPAIGN_UPDATE",
    entityType: "campaign",
    entityId: id,
    ipAddress: clientIp(req),
  });

  return ok(updated);
});

export const DELETE = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Missing id" } },
      { status: 404 }
    );
  }

  const user = await requireApiUserWith("campaigns:delete");
  const campaign = await db.campaign.findFirst({
    where: { id, organizationId: user.organizationId },
  });
  if (!campaign) throw new ApiNotFoundError("Campaign not found");

  await db.campaign.delete({ where: { id } });

  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "CAMPAIGN_DELETE",
    entityType: "campaign",
    entityId: id,
    ipAddress: clientIp(req),
  });

  return ok({ success: true });
});
