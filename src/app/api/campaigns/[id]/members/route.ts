import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseQuery, ApiNotFoundError } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { campaignMemberCreateSchema, campaignMemberListQuerySchema } from "@/lib/schemas";
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
  const campaignId = await resolveId(ctx);
  if (!campaignId) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Missing campaign id" } },
      { status: 404 }
    );
  }

  const user = await requireApiUserWith("campaigns:read");
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, organizationId: user.organizationId },
  });
  if (!campaign) throw new ApiNotFoundError("Campaign not found");

  const q = parseQuery(req, campaignMemberListQuerySchema);

  const where = {
    campaignId,
    ...(q.status ? { status: q.status } : {}),
  };

  const [total, members] = await Promise.all([
    db.campaignMember.count({ where }),
    db.campaignMember.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        lead: { select: { id: true, firstName: true, lastName: true, email: true, status: true } },
        contact: { select: { id: true, firstName: true, lastName: true, email: true, status: true } },
        deal: { select: { id: true, name: true, value: true, status: true, stage: { select: { id: true, name: true } } } },
      },
    }),
  ]);

  return ok({ members, total, page: q.page, pageSize: q.pageSize });
});

export const POST = apiHandler<Ctx>(async (req, ctx) => {
  const campaignId = await resolveId(ctx);
  if (!campaignId) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Missing campaign id" } },
      { status: 404 }
    );
  }

  const user = await requireApiUserWith("campaigns:update");
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, organizationId: user.organizationId },
  });
  if (!campaign) throw new ApiNotFoundError("Campaign not found");

  const body = await req.json();
  const parsed = campaignMemberCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid request", details: parsed.error.issues } },
      { status: 400 }
    );
  }

  // Verify the lead/contact/deal exists and belongs to the same organization
  if (parsed.data.leadId) {
    const lead = await db.lead.findFirst({
      where: { id: parsed.data.leadId, organizationId: user.organizationId, deletedAt: null },
    });
    if (!lead) throw new ApiNotFoundError("Lead not found");
  }
  if (parsed.data.contactId) {
    const contact = await db.contact.findFirst({
      where: { id: parsed.data.contactId, organizationId: user.organizationId, deletedAt: null },
    });
    if (!contact) throw new ApiNotFoundError("Contact not found");
  }
  if (parsed.data.dealId) {
    const deal = await db.deal.findFirst({
      where: { id: parsed.data.dealId, organizationId: user.organizationId, deletedAt: null },
    });
    if (!deal) throw new ApiNotFoundError("Deal not found");
  }

  const member = await db.campaignMember.create({
    data: {
      campaignId,
      leadId: parsed.data.leadId || null,
      contactId: parsed.data.contactId || null,
      dealId: parsed.data.dealId || null,
      status: parsed.data.status,
    },
    include: {
      lead: { select: { id: true, firstName: true, lastName: true, email: true } },
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      deal: { select: { id: true, name: true, value: true } },
    },
  });

  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "CAMPAIGN_MEMBER_ADD",
    entityType: "campaign_member",
    entityId: member.id,
    ipAddress: clientIp(req),
    metadata: { campaignId, leadId: parsed.data.leadId, contactId: parsed.data.contactId, dealId: parsed.data.dealId },
  });

  return ok(member, { status: 201 });
});
