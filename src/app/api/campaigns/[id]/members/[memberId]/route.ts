import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok, ApiNotFoundError } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { campaignMemberUpdateSchema } from "@/lib/schemas";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { clientIp } from "@/server/api";

type Ctx = { params: Promise<{ id: string; memberId: string }> };

async function resolveIds(ctx: Ctx): Promise<{ campaignId: string | null; memberId: string | null }> {
  const parts = (await ctx.params) as unknown as { id: string; memberId: string };
  const campaignId = parts.id && parts.id.length > 0 ? parts.id[0] : null;
  const memberId = parts.memberId && parts.memberId.length > 0 ? parts.memberId[0] : null;
  return { campaignId, memberId };
}

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const { campaignId, memberId } = await resolveIds(ctx);
  if (!campaignId || !memberId) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Missing id" } },
      { status: 404 }
    );
  }

  const user = await requireApiUserWith("campaigns:update");
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, organizationId: user.organizationId },
  });
  if (!campaign) throw new ApiNotFoundError("Campaign not found");

  const member = await db.campaignMember.findFirst({
    where: { id: memberId, campaignId },
  });
  if (!member) throw new ApiNotFoundError("Campaign member not found");

  const body = await req.json();
  const parsed = campaignMemberUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid request", details: parsed.error.issues } },
      { status: 400 }
    );
  }

  const updated = await db.campaignMember.update({
    where: { id: memberId },
    data: { status: parsed.data.status },
    include: {
      lead: { select: { id: true, firstName: true, lastName: true, email: true } },
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      deal: { select: { id: true, name: true, value: true } },
    },
  });

  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "CAMPAIGN_MEMBER_UPDATE",
    entityType: "campaign_member",
    entityId: memberId,
    ipAddress: clientIp(req),
    metadata: { campaignId, previousStatus: member.status, newStatus: parsed.data.status },
  });

  return ok(updated);
});

export const DELETE = apiHandler<Ctx>(async (req, ctx) => {
  const { campaignId, memberId } = await resolveIds(ctx);
  if (!campaignId || !memberId) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Missing id" } },
      { status: 404 }
    );
  }

  const user = await requireApiUserWith("campaigns:update");
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, organizationId: user.organizationId },
  });
  if (!campaign) throw new ApiNotFoundError("Campaign not found");

  const member = await db.campaignMember.findFirst({
    where: { id: memberId, campaignId },
  });
  if (!member) throw new ApiNotFoundError("Campaign member not found");

  await db.campaignMember.delete({ where: { id: memberId } });

  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "CAMPAIGN_MEMBER_REMOVE",
    entityType: "campaign_member",
    entityId: memberId,
    ipAddress: clientIp(req),
    metadata: { campaignId, leadId: member.leadId, contactId: member.contactId, dealId: member.dealId },
  });

  return ok({ success: true });
});
