import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseBody, ApiNotFoundError, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import {
  dealLineItemCreateSchema,
  dealLineItemUpdateSchema,
  dealLineItemsReplaceSchema,
} from "@/lib/schemas";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

type Ctx = { params: Promise<{ id?: string[] }> };

async function resolveIds(ctx: Ctx): Promise<{ dealId: string | null; lineItemId: string | null }> {
  const parts = (await ctx.params) as unknown as { id?: string[] };
  const segs = parts.id || [];
  return { dealId: segs[0] || null, lineItemId: segs[1] || null };
}

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const { dealId, lineItemId } = await resolveIds(ctx);
  if (!dealId) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing deal id" } }, { status: 404 });
  const user = await requireApiUserWith("deals:read");
  
  // Verify deal exists and belongs to org
  const deal = await db.deal.findFirst({
    where: { id: dealId, organizationId: user.organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!deal) throw new ApiNotFoundError("Deal not found");
  
  if (!lineItemId) return listLineItems(dealId);
  return getLineItem(dealId, lineItemId);
});

async function listLineItems(dealId: string) {
  const user = await requireApiUserWith("deals:read");
  const lineItems = await db.dealLineItem.findMany({
    where: { dealId },
    orderBy: { createdAt: "asc" },
    include: { product: { select: { id: true, name: true, sku: true, unitPrice: true, currency: true } } },
  });
  return ok({ lineItems });
}

async function getLineItem(dealId: string, lineItemId: string) {
  const user = await requireApiUserWith("deals:read");
  const lineItem = await db.dealLineItem.findFirst({
    where: { id: lineItemId, dealId },
    include: { product: { select: { id: true, name: true, sku: true, unitPrice: true, currency: true } } },
  });
  if (!lineItem) throw new ApiNotFoundError("Line item not found");
  return ok(lineItem);
}

export const POST = apiHandler<Ctx>(async (req, ctx) => {
  const { dealId } = await resolveIds(ctx);
  if (!dealId) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing deal id" } }, { status: 404 });
  const url = new URL(req.url);
  if (url.searchParams.get("action") === "replace") return replaceLineItems(req, dealId);
  return createLineItem(req, dealId);
});

async function createLineItem(req: NextRequest, dealId: string) {
  const user = await requireApiUserWith("deals:update");
  
  const deal = await db.deal.findFirst({
    where: { id: dealId, organizationId: user.organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!deal) throw new ApiNotFoundError("Deal not found");
  
  const body = await parseBody(req, dealLineItemCreateSchema);
  
  // If productId provided, validate it belongs to the org
  if (body.productId) {
    const product = await db.product.findFirst({
      where: { id: body.productId, organizationId: user.organizationId },
      select: { id: true },
    });
    if (!product) {
      return NextResponse.json(
        { error: { code: "INVALID_PRODUCT", message: "Product not found" } },
        { status: 400 }
      );
    }
  }
  
  // Validate total = quantity * unitPrice (allow small floating point variance)
  const expectedTotal = body.quantity * body.unitPrice;
  if (Math.abs(body.total - expectedTotal) > 0.01) {
    return NextResponse.json(
      { error: { code: "INVALID_TOTAL", message: "Total must equal quantity × unitPrice" } },
      { status: 400 }
    );
  }
  
  const lineItem = await db.dealLineItem.create({
    data: {
      dealId,
      productId: body.productId || null,
      name: body.name,
      description: body.description,
      quantity: body.quantity,
      unitPrice: body.unitPrice,
      total: body.total,
    },
    include: { product: { select: { id: true, name: true, sku: true, unitPrice: true, currency: true } } },
  });
  
  // Update deal value from line items
  await updateDealValueFromLineItems(dealId);
  
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "DEAL_LINE_ITEM_CREATE",
    entityType: "deal_line_item",
    entityId: lineItem.id,
    ipAddress: clientIp(req),
  });
  
  return ok(lineItem, { status: 201 });
}

async function replaceLineItems(req: NextRequest, dealId: string) {
  const user = await requireApiUserWith("deals:update");
  
  const deal = await db.deal.findFirst({
    where: { id: dealId, organizationId: user.organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!deal) throw new ApiNotFoundError("Deal not found");
  
  const body = await parseBody(req, dealLineItemsReplaceSchema);
  
  // Validate all products belong to the same organization
  const productIds = body.items.filter((i) => i.productId).map((i) => i.productId!);
  if (productIds.length > 0) {
    const products = await db.product.findMany({
      where: { id: { in: productIds }, organizationId: user.organizationId },
      select: { id: true },
    });
    if (products.length !== productIds.length) {
      return NextResponse.json(
        { error: { code: "INVALID_PRODUCT", message: "One or more products not found" } },
        { status: 400 }
      );
    }
  }
  
  // Validate totals for all items
  for (const item of body.items) {
    const expectedTotal = item.quantity * item.unitPrice;
    if (Math.abs(item.total - expectedTotal) > 0.01) {
      return NextResponse.json(
        { error: { code: "INVALID_TOTAL", message: "Total must equal quantity × unitPrice for all items" } },
        { status: 400 }
      );
    }
  }
  
  // Replace all items in a transaction
  await db.$transaction(async (tx) => {
    await tx.dealLineItem.deleteMany({ where: { dealId } });
    if (body.items.length > 0) {
      await tx.dealLineItem.createMany({
        data: body.items.map((item) => ({
          dealId,
          productId: item.productId || null,
          name: item.name,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
        })),
      });
    }
  });
  
  // Update deal value from line items
  await updateDealValueFromLineItems(dealId);
  
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "DEAL_LINE_ITEMS_REPLACE",
    entityType: "deal",
    entityId: dealId,
    ipAddress: clientIp(req),
    metadata: { itemCount: body.items.length },
  });
  
  const lineItems = await db.dealLineItem.findMany({
    where: { dealId },
    orderBy: { createdAt: "asc" },
    include: { product: { select: { id: true, name: true, sku: true, unitPrice: true, currency: true } } },
  });
  
  return ok({ lineItems });
}

async function updateDealValueFromLineItems(dealId: string) {
  const lineItems = await db.dealLineItem.findMany({
    where: { dealId },
    select: { total: true },
  });
  const total = lineItems.reduce((sum, item) => sum + item.total, 0);
  await db.deal.update({
    where: { id: dealId },
    data: { value: total },
  });
}

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const { dealId, lineItemId } = await resolveIds(ctx);
  if (!dealId || !lineItemId) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing deal id or line item id" } }, { status: 404 });
  }
  return updateLineItem(req, dealId, lineItemId);
});

async function updateLineItem(req: NextRequest, dealId: string, lineItemId: string) {
  const user = await requireApiUserWith("deals:update");
  
  const deal = await db.deal.findFirst({
    where: { id: dealId, organizationId: user.organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!deal) throw new ApiNotFoundError("Deal not found");
  
  const existing = await db.dealLineItem.findFirst({
    where: { id: lineItemId, dealId },
    select: { id: true },
  });
  if (!existing) throw new ApiNotFoundError("Line item not found");
  
  const body = await parseBody(req, dealLineItemUpdateSchema);
  
  // If productId provided, validate it belongs to the org
  if (body.productId) {
    const product = await db.product.findFirst({
      where: { id: body.productId, organizationId: user.organizationId },
      select: { id: true },
    });
    if (!product) {
      return NextResponse.json(
        { error: { code: "INVALID_PRODUCT", message: "Product not found" } },
        { status: 400 }
      );
    }
  }
  
  // Validate total = quantity * unitPrice (if both provided)
  const updatedQuantity = body.quantity ?? (await db.dealLineItem.findUnique({ where: { id: lineItemId }, select: { quantity: true } }))!.quantity;
  const updatedUnitPrice = body.unitPrice ?? (await db.dealLineItem.findUnique({ where: { id: lineItemId }, select: { unitPrice: true } }))!.unitPrice;
  const expectedTotal = updatedQuantity * updatedUnitPrice;
  if (body.total !== undefined && Math.abs(body.total - expectedTotal) > 0.01) {
    return NextResponse.json(
      { error: { code: "INVALID_TOTAL", message: "Total must equal quantity × unitPrice" } },
      { status: 400 }
    );
  }
  
  const lineItem = await db.dealLineItem.update({
    where: { id: lineItemId },
    data: {
      ...body,
      ...(body.productId !== undefined ? { productId: body.productId || null } : {}),
      total: body.total ?? expectedTotal,
    },
    include: { product: { select: { id: true, name: true, sku: true, unitPrice: true, currency: true } } },
  });
  
  // Update deal value from line items
  await updateDealValueFromLineItems(dealId);
  
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "DEAL_LINE_ITEM_UPDATE",
    entityType: "deal_line_item",
    entityId: lineItemId,
    ipAddress: clientIp(req),
  });
  
  return ok(lineItem);
}

export const DELETE = apiHandler<Ctx>(async (req, ctx) => {
  const { dealId, lineItemId } = await resolveIds(ctx);
  if (!dealId || !lineItemId) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing deal id or line item id" } }, { status: 404 });
  }
  return deleteLineItem(req, dealId, lineItemId);
});

async function deleteLineItem(req: NextRequest, dealId: string, lineItemId: string) {
  const user = await requireApiUserWith("deals:update");
  
  const deal = await db.deal.findFirst({
    where: { id: dealId, organizationId: user.organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!deal) throw new ApiNotFoundError("Deal not found");
  
  const existing = await db.dealLineItem.findFirst({
    where: { id: lineItemId, dealId },
    select: { id: true },
  });
  if (!existing) throw new ApiNotFoundError("Line item not found");
  
  await db.dealLineItem.delete({ where: { id: lineItemId } });
  
  // Update deal value from line items
  await updateDealValueFromLineItems(dealId);
  
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "DEAL_LINE_ITEM_DELETE",
    entityType: "deal_line_item",
    entityId: lineItemId,
    ipAddress: clientIp(req),
  });
  
  return ok({ deleted: true });
}
