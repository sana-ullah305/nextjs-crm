import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseBody, parseQuery, ApiNotFoundError, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { quotationCreateSchema } from "@/lib/schemas";
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
  dealId: z.string().trim().max(64).optional(),
  contactId: z.string().trim().max(64).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") return listQuotations(req);
  return getQuotation(id);
});

async function listQuotations(req: NextRequest) {
  const user = await requireApiUserWith("quotations:read");
  const q = parseQuery(req, listQuerySchema);
  const where = {
    organizationId: user.organizationId,
    ...(q.status ? { status: q.status } : {}),
    ...(q.dealId ? { dealId: q.dealId } : {}),
    ...(q.contactId ? { contactId: q.contactId } : {}),
    ...(q.q ? { quotationNumber: { contains: q.q } } : {}),
  };
  const [total, quotations] = await Promise.all([
    db.quotation.count({ where }),
    db.quotation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        lineItems: true,
        contact: { select: { id: true, firstName: true, lastName: true, email: true } },
        company: { select: { id: true, name: true } },
        deal: { select: { id: true, name: true } },
      },
    }),
  ]);
  return ok({ quotations, total, page: q.page, pageSize: q.pageSize });
}

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

export const POST = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") return createQuotation(req);
  return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown route" } }, { status: 404 });
});

async function createQuotation(req: NextRequest) {
  const user = await requireApiUserWith("quotations:create");
  const body = await parseBody(req, quotationCreateSchema);

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

  const existingNumber = await db.quotation.findFirst({
    where: { organizationId: user.organizationId, quotationNumber: body.quotationNumber },
  });
  if (existingNumber) {
    return NextResponse.json(
      { error: { code: "CONFLICT", message: "Quotation number already exists" } },
      { status: 409 }
    );
  }

  const quotation = await db.quotation.create({
    data: {
      organizationId: user.organizationId,
      quotationNumber: body.quotationNumber,
      dealId: body.dealId || null,
      contactId: body.contactId || null,
      companyId: body.companyId || null,
      status: body.status,
      validUntil: parseDate(body.validUntil),
      subtotal: body.subtotal,
      tax: body.tax,
      total: body.total,
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
      title: `Quotation created: ${quotation.quotationNumber}`,
      dealId: quotation.dealId || null,
      userId: user.id,
    },
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "QUOTATION_CREATE",
    entityType: "quotation",
    entityId: quotation.id,
    ipAddress: clientIp(req),
  });
  return ok(quotation, { status: 201 });
}
