import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseBody, parseQuery, ApiNotFoundError, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import {
  productCreateSchema,
  productUpdateSchema,
} from "@/lib/schemas";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

type Ctx = { params: Promise<{ id: string }> };

async function resolveId(ctx: Ctx): Promise<string | null> {
  const parts = (await ctx.params) as unknown as { id: string };
  const segs = parts.id;
  return segs ?? null;
}

const listQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  isActive: z.coerce.boolean().optional(),
  sort: z.enum(["recent", "name", "sku"]).default("recent"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id) return listProducts(req);
  return getProduct(id);
});

async function listProducts(req: NextRequest) {
  const user = await requireApiUserWith("products:read");
  const q = parseQuery(req, listQuerySchema);
  const where = {
    organizationId: user.organizationId,
    ...(q.isActive !== undefined ? { isActive: q.isActive } : {}),
    ...(q.q
      ? {
          OR: [
            { name: { contains: q.q } },
            { sku: { contains: q.q } },
            { description: { contains: q.q } },
          ],
        }
      : {}),
  };
  const [total, products] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({
      where,
      orderBy: q.sort === "name" ? { name: "asc" } : q.sort === "sku" ? { sku: "asc" } : { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return ok({ products, total, page: q.page, pageSize: q.pageSize });
}

async function getProduct(id: string) {
  const user = await requireApiUserWith("products:read");
  const product = await db.product.findFirst({
    where: { id, organizationId: user.organizationId },
    include: {
      priceListItems: {
        include: { priceList: { select: { id: true, name: true } } },
      },
      _count: { select: { dealLineItems: true } },
    },
  });
  if (!product) throw new ApiNotFoundError("Product not found");
  return ok(product);
}

export const POST = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") return createProduct(req);
  return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown route" } }, { status: 404 });
});

async function createProduct(req: NextRequest) {
  const user = await requireApiUserWith("products:create");
  const body = await parseBody(req, productCreateSchema);
  const product = await db.product.create({
    data: {
      organizationId: user.organizationId,
      name: body.name,
      description: body.description,
      sku: body.sku || null,
      unitPrice: body.unitPrice,
      currency: body.currency,
      isActive: body.isActive,
    },
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "PRODUCT_CREATE",
    entityType: "product",
    entityId: product.id,
    ipAddress: clientIp(req),
  });
  return ok(product, { status: 201 });
}

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  const user = await requireApiUserWith("products:update");
  const existing = await db.product.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { id: true },
  });
  if (!existing) throw new ApiNotFoundError("Product not found");
  const body = await parseBody(req, productUpdateSchema);
  const product = await db.product.update({
    where: { id },
    data: {
      ...body,
      ...(body.sku !== undefined ? { sku: body.sku || null } : {}),
    },
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "PRODUCT_UPDATE",
    entityType: "product",
    entityId: id,
    ipAddress: clientIp(req),
  });
  return ok(product);
});

export const DELETE = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  const user = await requireApiUserWith("products:delete");
  const existing = await db.product.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { id: true },
  });
  if (!existing) throw new ApiNotFoundError("Product not found");
  await db.product.delete({ where: { id } });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "PRODUCT_DELETE",
    entityType: "product",
    entityId: id,
    ipAddress: clientIp(req),
  });
  return ok({ deleted: true });
});
