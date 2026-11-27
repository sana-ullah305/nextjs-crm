import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseBody, parseQuery, ApiNotFoundError, clientIp } from "@/server/api";
import { requireApiUserWith, hasPermission, canAccessRecord, canReassignRecord } from "@/server/rbac";
import { companyCreateSchema, companyUpdateSchema } from "@/lib/schemas";
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
  industry: z.string().trim().max(60).optional(),
  ownerId: z.string().trim().max(64).optional(),
  sort: z.enum(["recent", "name"]).default("recent"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id) return listCompanies(req);
  return getCompany(id);
});

async function listCompanies(req: NextRequest) {
  const user = await requireApiUserWith("contacts:read");
  const q = parseQuery(req, listQuerySchema);
  // Ownership visibility (reps without contacts:read_all see own + unowned)
  // and the free-text `q` OR clause are kept in separate AND entries so the
  // search clause cannot overwrite the visibility filter (RBAC bypass).
  const visibility = hasPermission(user, "contacts:read_all")
    ? {}
    : { OR: [{ ownerId: user.id }, { ownerId: null }] };
  const searchClause = q.q
    ? {
        OR: [
          { name: { contains: q.q } },
          { domain: { contains: q.q } },
          { industry: { contains: q.q } },
        ],
      }
    : {};
  const where = {
    organizationId: user.organizationId,
    deletedAt: null,
    ...(q.industry ? { industry: q.industry } : {}),
    ...(q.ownerId ? { ownerId: q.ownerId } : {}),
    AND: [visibility, searchClause],
  };
  const [total, companies] = await Promise.all([
    db.company.count({ where }),
    db.company.findMany({
      where,
      orderBy: q.sort === "name" ? { name: "asc" } : { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        owner: { select: { id: true, name: true, avatarColor: true } },
        _count: { select: { contacts: true, deals: true } },
      },
    }),
  ]);
  return ok({
    companies: companies.map((c) => ({ ...c, contactCount: c._count.contacts, dealCount: c._count.deals })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  });
}

async function getCompany(id: string) {
  const user = await requireApiUserWith("contacts:read");
  const company = await db.company.findFirst({
    where: { id, organizationId: user.organizationId, deletedAt: null },
    include: {
      owner: { select: { id: true, name: true, avatarColor: true } },
      contacts: {
        where: { deletedAt: null },
        select: { id: true, firstName: true, lastName: true, email: true, title: true, avatarColor: true },
      },
    },
  });
  if (!company) throw new ApiNotFoundError("Company not found");
  if (!canAccessRecord(user, company.ownerId)) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Forbidden" } },
      { status: 403 }
    );
  }
  return ok(company);
}

export const POST = apiHandler<Ctx>(async (req, _ctx) => {
  const user = await requireApiUserWith("contacts:create");
  const body = await parseBody(req, companyCreateSchema);
  const company = await db.company.create({
    data: {
      organizationId: user.organizationId,
      name: body.name,
      domain: body.domain ?? "",
      industry: body.industry,
      size: body.size,
      phone: body.phone,
      website: body.website,
      address: body.address,
      city: body.city,
      state: body.state,
      country: body.country,
      ownerId: body.ownerId || user.id,
      summary: body.summary ?? "",
    },
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "COMPANY_CREATE",
    entityType: "company",
    entityId: company.id,
    ipAddress: clientIp(req),
  });
  return ok(company, { status: 201 });
});

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  const user = await requireApiUserWith("contacts:update");
  const existing = await db.company.findFirst({
    where: { id, organizationId: user.organizationId, deletedAt: null },
    select: { id: true, ownerId: true },
  });
  if (!existing) throw new ApiNotFoundError("Company not found");
  // Record-level write scoping: reps without contacts:update_all may only edit
  // companies they own or that are unowned.
  if (!hasPermission(user, "contacts:update_all") && !canAccessRecord(user, existing.ownerId)) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Forbidden" } },
      { status: 403 }
    );
  }
  const body = await parseBody(req, companyUpdateSchema);
  // A rep may only take ownership themselves; transferring to another user
  // requires contacts:update_all.
  if (body.ownerId !== undefined && !canReassignRecord(user, body.ownerId || null, "contacts:update_all")) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Forbidden" } },
      { status: 403 }
    );
  }
  const { ownerId, ...rest } = body;
  const company = await db.company.update({
    where: { id },
    data: {
      ...rest,
      ...(ownerId !== undefined ? { ownerId: ownerId || null } : {}),
    },
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "COMPANY_UPDATE",
    entityType: "company",
    entityId: id,
    ipAddress: clientIp(req),
  });
  return ok(company);
});

export const DELETE = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  const user = await requireApiUserWith("contacts:delete");
  const existing = await db.company.findFirst({
    where: { id, organizationId: user.organizationId, deletedAt: null },
    select: { id: true, ownerId: true },
  });
  if (!existing) throw new ApiNotFoundError("Company not found");
  // Record-level write scoping mirrors update: reps without contacts:delete_all
  // may only delete companies they own or that are unowned.
  if (!hasPermission(user, "contacts:delete_all") && !canAccessRecord(user, existing.ownerId)) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Forbidden" } },
      { status: 403 }
    );
  }
  await db.company.update({ where: { id }, data: { deletedAt: new Date() } });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "COMPANY_DELETE",
    entityType: "company",
    entityId: id,
    ipAddress: clientIp(req),
  });
  return ok({ deleted: true });
});
