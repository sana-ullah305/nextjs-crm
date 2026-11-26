import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseQuery } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { campaignCreateSchema, campaignListQuerySchema } from "@/lib/schemas";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { clientIp } from "@/server/api";

export const GET = apiHandler(async (req: NextRequest) => {
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
});

export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireApiUserWith("campaigns:create");
  const body = await req.json();
  const parsed = campaignCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid request", details: parsed.error.issues } },
      { status: 400 }
    );
  }

  const campaign = await db.campaign.create({
    data: {
      organizationId: user.organizationId,
      name: parsed.data.name,
      description: parsed.data.description,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
      status: parsed.data.status,
      budget: parsed.data.budget,
      cost: parsed.data.cost,
    },
  });

  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "CAMPAIGN_CREATE",
    entityType: "campaign",
    entityId: campaign.id,
    ipAddress: clientIp(req),
  });

  return ok(campaign, { status: 201 });
});
