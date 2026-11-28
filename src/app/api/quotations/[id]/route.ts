import { NextResponse } from "next/server";
import { apiHandler, ok, parseBody, ApiNotFoundError, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { quotationUpdateSchema } from "@/lib/schemas";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

type Ctx = { params: Promise<{ id: string }> };

async function resolveId(ctx: Ctx): Promise<string | null> {
  const parts = (await ctx.params) as unknown as { id?: string };
  const segs = parts.id;
  return segs ?? null;
}

function parseDate(v: string | undefined | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SENT", "ACCEPTED", "REJECTED", "EXPIRED"],
  SENT: ["ACCEPTED", "REJECTED", "EXPIRED"],
};

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  return getQuotation(id);
});

async function getQuotation(id: string) {
  const user = await requireApiUserWith("quotations:read");
  const quotation = await db.quotation.findFirst({
    where: { id, organizationId: user.organizationId },
    include: {
      lineItems: true,
      contact: true,
      company: true,
      deal: true,
    },
  });
  if (!quotation) throw new ApiNotFoundError("Quotation not found");
  return ok(quotation);
}

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  const user = await requireApiUserWith("quotations:manage");
  const quotation = await db.quotation.findFirst({
    where: { id, organizationId: user.organizationId },
    include: { lineItems: true },
  });
  if (!quotation) throw new ApiNotFoundError("Quotation not found");

  const body = await parseBody(req, quotationUpdateSchema);

  if (body.status && body.status !== quotation.status) {
    const allowed = ALLOWED_TRANSITIONS[quotation.status as keyof typeof ALLOWED_TRANSITIONS] || [];
    if (!allowed.includes(body.status)) {
      return NextResponse.json(
        { error: { code: "INVALID_TRANSITION", message: "Cannot transition from " + quotation.status + " to " + body.status } },
        { status: 400 }
      );
    }
  }

  const updateData: Record<string, unknown> = {};
  if (body.quotationNumber !== undefined) updateData.quotationNumber = body.quotationNumber;
  if (body.dealId !== undefined) updateData.dealId = body.dealId || null;
  if (body.contactId !== undefined) updateData.contactId = body.contactId || null;
  if (body.companyId !== undefined) updateData.companyId = body.companyId || null;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.validUntil !== undefined) updateData.validUntil = parseDate(body.validUntil);
  if (body.subtotal !== undefined) updateData.subtotal = body.subtotal;
  if (body.tax !== undefined) updateData.tax = body.tax;
  if (body.total !== undefined) updateData.total = body.total;
  if (body.notes !== undefined) updateData.notes = body.notes;

  const updated = await db.quotation.update({
    where: { id },
    data: updateData,
    include: { lineItems: true },
  });

  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "QUOTATION_UPDATE",
    entityType: "quotation",
    entityId: id,
    ipAddress: clientIp(req),
    metadata: { statusChange: body.status && body.status !== quotation.status },
  });
  return ok(updated);
});

export const DELETE = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  const user = await requireApiUserWith("quotations:manage");
  const quotation = await db.quotation.findFirst({
    where: { id, organizationId: user.organizationId },
  });
  if (!quotation) throw new ApiNotFoundError("Quotation not found");

  await db.quotation.delete({ where: { id } });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "QUOTATION_DELETE",
    entityType: "quotation",
    entityId: id,
    ipAddress: clientIp(req),
  });
  return ok({ deleted: true });
});
