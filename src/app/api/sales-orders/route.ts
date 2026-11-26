import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseBody, parseQuery, ApiNotFoundError, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { salesOrderCreateSchema } from "@/lib/schemas";
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
  status: z.string().trim().max(20).optional(),
  quotationId: z.string().trim().max(64).optional(),
  dealId: z.string().trim().max(64).optional(),
  contactId: z.string().trim().max(64).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") return listSalesOrders(req);
  return getSalesOrder(id);
});

async function listSalesOrders(req: NextRequest) {
  const user = await requireApiUserWith("salesOrders:read");
  const q = parseQuery(req, listQuerySchema);
  const where = {
    organizationId: user.organizationId,
    ...(q.status ? { status: q.status } : {}),
    ...(q.quotationId ? { quotationId: q.quotationId } : {}),
    ...(q.dealId ? { dealId: q.dealId } : {}),
    ...(q.contactId ? { contactId: q.contactId } : {}),
    ...(q.q ? { orderNumber: { contains: q.q } } : {}),
  };
  const [total, salesOrders] = await Promise.all([
    db.salesOrder.count({ where }),
    db.salesOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        lineItems: true,
        contact: { select: { id: true, firstName: true, lastName: true, email: true } },
        company: { select: { id: true, name: true } },
        deal: { select: { id: true, name: true } },
        quotation: { select: { id: true, quotationNumber: true } },
      },
    }),
  ]);
  return ok({ salesOrders, total, page: q.page, pageSize: q.pageSize });
}

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

export const POST = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") return createSalesOrder(req);
  return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown route" } }, { status: 404 });
});

async function createSalesOrder(req: NextRequest) {
  const user = await requireApiUserWith("salesOrders:create");
  const body = await parseBody(req, salesOrderCreateSchema);

  if (body.quotationId) {
    const quo = await db.quotation.findFirst({ where: { id: body.quotationId, organizationId: user.organizationId } });
    if (!quo) throw new ApiNotFoundError("Quotation not found");
  }
  if (body.dealId) {
    const deal = await db.deal.findFirst({ where: { id: body.dealId, organizationId: user.organizationId } });
    if (!deal) throw new ApiNotFoundError("Deal not found");
  }
  if (body.contactId) {
    const contact = await db.contact.findFirst({ where: { id: body.contactId, organizationId: user.organizationId } });
    if (!contact) throw new ApiNotFoundError("Contact not found");
  }
  if (body.companyId) {
    const company = await db.company.findFirst({ where: { id: body.companyId, organizationId: user.organizationId } });
    if (!company) throw new ApiNotFoundError("Company not found");
  }

  const existingNumber = await db.salesOrder.findFirst({
    where: { organizationId: user.organizationId, orderNumber: body.orderNumber },
  });
  if (existingNumber) {
    return NextResponse.json(
      { error: { code: "CONFLICT", message: "Order number already exists" } },
      { status: 409 }
    );
  }

  const salesOrder = await db.salesOrder.create({
    data: {
      organizationId: user.organizationId,
      orderNumber: body.orderNumber,
      quotationId: body.quotationId || null,
      dealId: body.dealId || null,
      contactId: body.contactId || null,
      companyId: body.companyId || null,
      status: body.status,
      orderDate: parseDate(body.orderDate) ?? new Date(),
      subtotal: body.subtotal,
      tax: body.tax,
      total: body.total,
      shippingAddress: body.shippingAddress,
      notes: body.notes,
      lineItems: {
        create: body.lineItems.map((item) => ({
          productId: item.productId || null,
          name: item.name,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
        })),
      },
    },
    include: { lineItems: true },
  });

  await db.activity.create({
    data: {
      organizationId: user.organizationId,
      type: "CREATED",
      title: `Sales order created: ${salesOrder.orderNumber}`,
      dealId: salesOrder.dealId || null,
      userId: user.id,
    },
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "SALES_ORDER_CREATE",
    entityType: "salesOrder",
    entityId: salesOrder.id,
    ipAddress: clientIp(req),
  });
  return ok(salesOrder, { status: 201 });
}
