import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseBody, parseQuery, ApiNotFoundError, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import {
  priceListCreateSchema,
  priceListUpdateSchema,
  priceListItemCreateSchema,
  priceListItemsReplaceSchema,
} from "@/lib/schemas";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

type Ctx = { params: Promise<{ id?: string[] }> };

async function resolveId(ctx: Ctx): Promise<string | null> {
  const parts = (await ctx.params) as unknown as { id?: string[] };
  const segs = parts.id;
  return segs && segs.length > 0 && segs[0] ? segs[0] : null;
}

const listQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  isDefault: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id) return listPriceLists(req);
  const url = new URL(req.url);
  if (url.searchParams.get("items") === "true") return getPriceListWithItems(id);
  return getPriceList(id);
});

async function listPriceLists(req: NextRequest) {
  const user = await requireApiUserWith("pricelists:read");
  const q = parseQuery(req, listQuerySchema);
  const where = {
    organizationId: user.organizationId,
    ...(q.isDefault !== undefined ? { isDefault: q.isDefault } : {}),
    ...(q.q ? { name: { contains: q.q } } : {}),
  };
  const [total, priceLists] = await Promise.all([
    db.priceList.count({ where }),
    db.priceList.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        _count: { select: { items: true } },
      },
    }),
  ]);
  return ok({ priceLists, total, page: q.page, pageSize: q.pageSize });
}

async function getPriceList(id: string) {
  const user = await requireApiUserWith("pricelists:read");
  const priceList = await db.priceList.findFirst({
    where: { id, organizationId: user.organizationId },
    include: {
      items: {
        include: { product: { select: { id: true, name: true, sku: true, unitPrice: true, currency: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!priceList) throw new ApiNotFoundError("Price list not found");
  return ok(priceList);
}

async function getPriceListWithItems(id: string) {
  const user = await requireApiUserWith("pricelists:read");
  const priceList = await db.priceList.findFirst({
    where: { id, organizationId: user.organizationId },
    include: {
      items: {
        include: { product: { select: { id: true, name: true, sku: true, unitPrice: true, currency: true, isActive: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!priceList) throw new ApiNotFoundError("Price list not found");
  return ok(priceList);
}

export const POST = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") return createPriceList(req);
  return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown route" } }, { status: 404 });
});

async function createPriceList(req: NextRequest) {
  const user = await requireApiUserWith("pricelists:create");
  const body = await parseBody(req, priceListCreateSchema);
  
  // If this is set as default, unset other default price lists
  if (body.isDefault) {
    await db.priceList.updateMany({
      where: { organizationId: user.organizationId, isDefault: true },
      data: { isDefault: false },
    });
  }
  
  const priceList = await db.priceList.create({
    data: {
      organizationId: user.organizationId,
      name: body.name,
      description: body.description,
      isDefault: body.isDefault,
    },
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "PRICELIST_CREATE",
    entityType: "pricelist",
    entityId: priceList.id,
    ipAddress: clientIp(req),
  });
  return ok(priceList, { status: 201 });
}

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  const url = new URL(req.url);
  if (url.searchParams.get("action") === "items") return replacePriceListItems(req, id);
  return updatePriceList(req, id);
});

async function updatePriceList(req: NextRequest, id: string) {
  const user = await requireApiUserWith("pricelists:update");
  const existing = await db.priceList.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { id: true, isDefault: true },
  });
  if (!existing) throw new ApiNotFoundError("Price list not found");
  const body = await parseBody(req, priceListUpdateSchema);
  
  // If this is set as default, unset other default price lists
  if (body.isDefault && !existing.isDefault) {
    await db.priceList.updateMany({
      where: { organizationId: user.organizationId, isDefault: true },
      data: { isDefault: false },
    });
  }
  
  const priceList = await db.priceList.update({
    where: { id },
    data: body,
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "PRICELIST_UPDATE",
    entityType: "pricelist",
    entityId: id,
    ipAddress: clientIp(req),
  });
  return ok(priceList);
}

async function replacePriceListItems(req: NextRequest, priceListId: string) {
  const user = await requireApiUserWith("pricelists:update");
  const existing = await db.priceList.findFirst({
    where: { id: priceListId, organizationId: user.organizationId },
    select: { id: true },
  });
  if (!existing) throw new ApiNotFoundError("Price list not found");
  
  const body = await parseBody(req, priceListItemsReplaceSchema);
  
  // Validate all products belong to the same organization
  const productIds = body.items.map((i) => i.productId);
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
  
  // Replace all items in a transaction
  await db.$transaction(async (tx) => {
    await tx.priceListItem.deleteMany({ where: { priceListId } });
    if (body.items.length > 0) {
      await tx.priceListItem.createMany({
        data: body.items.map((item) => ({
          priceListId,
          productId: item.productId,
          price: item.price,
          currency: item.currency,
        })),
      });
    }
  });
  
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "PRICELIST_ITEMS_REPLACE",
    entityType: "pricelist",
    entityId: priceListId,
    ipAddress: clientIp(req),
    metadata: { itemCount: body.items.length },
  });
  
  const updated = await db.priceList.findFirst({
    where: { id: priceListId },
    include: {
      items: {
        include: { product: { select: { id: true, name: true, sku: true, unitPrice: true, currency: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  return ok(updated);
}

export const DELETE = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  const user = await requireApiUserWith("pricelists:delete");
  const existing = await db.priceList.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { id: true },
  });
  if (!existing) throw new ApiNotFoundError("Price list not found");
  await db.priceList.delete({ where: { id } });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "PRICELIST_DELETE",
    entityType: "pricelist",
    entityId: id,
    ipAddress: clientIp(req),
  });
  return ok({ deleted: true });
});
