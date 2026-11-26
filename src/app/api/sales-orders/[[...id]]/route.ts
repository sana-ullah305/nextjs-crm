import { NextResponse } from "next/server";
import { apiHandler, ok, parseBody, ApiNotFoundError, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { salesOrderUpdateSchema } from "@/lib/schemas";
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

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["COMPLETED", "CANCELLED"],
};

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  return getSalesOrder(id);
});

async function getSalesOrder(id: string) {
  const user = await requireApiUserWith("salesOrders:read");
  const salesOrder = await db.salesOrder.findFirst({
    where: { id, organizationId: user.organizationId },
    include: {
      lineItems: true,
      contact: true,
      company: true,
      deal: true,
      quotation: true,
    },
  });
  if (!salesOrder) throw new ApiNotFoundError("Sales order not found");
  return ok(salesOrder);
}

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  const user = await requireApiUserWith("salesOrders:manage");
  const salesOrder = await db.salesOrder.findFirst({
    where: { id, organizationId: user.organizationId },
    include: { lineItems: true },
  });
  if (!salesOrder) throw new ApiNotFoundError("Sales order not found");

  const body = await parseBody(req, salesOrderUpdateSchema);

  if (body.status && body.status !== salesOrder.status) {
    const allowed = ALLOWED_TRANSITIONS[salesOrder.status as keyof typeof ALLOWED_TRANSITIONS] || [];
    if (!allowed.includes(body.status)) {
      return NextResponse.json(
        { error: { code: "INVALID_TRANSITION", message: "Cannot transition from " + salesOrder.status + " to " + body.status } },
        { status: 400 }
      );
    }
  }

  const updateData: Record<string, unknown> = {};
  if (body.orderNumber !== undefined) updateData.orderNumber = body.orderNumber;
  if (body.quotationId !== undefined) updateData.quotationId = body.quotationId || null;
  if (body.dealId !== undefined) updateData.dealId = body.dealId || null;
  if (body.contactId !== undefined) updateData.contactId = body.contactId || null;
  if (body.companyId !== undefined) updateData.companyId = body.companyId || null;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.orderDate !== undefined) updateData.orderDate = parseDate(body.orderDate);
  if (body.subtotal !== undefined) updateData.subtotal = body.subtotal;
  if (body.tax !== undefined) updateData.tax = body.tax;
  if (body.total !== undefined) updateData.total = body.total;
  if (body.shippingAddress !== undefined) updateData.shippingAddress = body.shippingAddress;
  if (body.notes !== undefined) updateData.notes = body.notes;

  const updated = await db.salesOrder.update({
    where: { id },
    data: updateData,
    include: { lineItems: true },
  });

  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "SALES_ORDER_UPDATE",
    entityType: "salesOrder",
    entityId: id,
    ipAddress: clientIp(req),
    metadata: { statusChange: body.status && body.status !== salesOrder.status },
  });
  return ok(updated);
});

export const DELETE = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  const user = await requireApiUserWith("salesOrders:manage");
  const salesOrder = await db.salesOrder.findFirst({
    where: { id, organizationId: user.organizationId },
  });
  if (!salesOrder) throw new ApiNotFoundError("Sales order not found");

  await db.salesOrder.delete({ where: { id } });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "SALES_ORDER_DELETE",
    entityType: "salesOrder",
    entityId: id,
    ipAddress: clientIp(req),
  });
  return ok({ deleted: true });
});
