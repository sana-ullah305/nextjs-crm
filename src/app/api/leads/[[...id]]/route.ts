import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseBody, parseQuery, ApiNotFoundError, ApiValidationError, clientIp } from "@/server/api";
import { requireApiUserWith, hasPermission, canAccessRecord, canReassignRecord, canWriteRecord, recordScope, visibilityScope } from "@/server/rbac";
import { leadCreateSchema, leadUpdateSchema, leadConvertSchema } from "@/lib/schemas";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { scoreLead } from "@/lib/lead-score";

type Ctx = { params: Promise<{ id?: string[] }> };

async function resolveId(ctx: Ctx): Promise<string | null> {
  const parts = (await ctx.params) as unknown as { id?: string[] };
  const segs = parts.id;
  return segs && segs.length > 0 && segs[0] ? segs[0] : null;
}

const listQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.string().trim().max(30).optional(),
  sourceId: z.string().trim().max(64).optional(),
  assignedUserId: z.string().trim().max(64).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  sort: z.enum(["recent", "score", "name"]).default("recent"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

function parseDate(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") return listLeads(req);
  if (id === "check-duplicate") return checkDuplicates(req);
  return getLead(id);
});

async function listLeads(req: NextRequest) {
  const user = await requireApiUserWith("leads:read");
  const q = parseQuery(req, listQuerySchema);
  const searchClause = q.q
    ? {
        OR: [
          { firstName: { contains: q.q } },
          { lastName: { contains: q.q } },
          { email: { contains: q.q } },
          { companyName: { contains: q.q } },
        ],
      }
    : {};
  const where = {
    ...recordScope(user, "lead", "read"),
    deletedAt: null,
    ...(q.status ? { status: q.status } : {}),
    ...(q.sourceId ? { sourceId: q.sourceId } : {}),
    ...(q.assignedUserId ? { assignedUserId: q.assignedUserId } : {}),
    ...(q.minScore !== undefined ? { score: { gte: q.minScore } } : {}),
    AND: [visibilityScope(user, "leads:read_all"), searchClause],
  };
  const [total, leads] = await Promise.all([
    db.lead.count({ where }),
    db.lead.findMany({
      where,
      orderBy:
        q.sort === "score"
          ? { score: "desc" }
          : q.sort === "name"
            ? { lastName: "asc" }
            : { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        source: true,
        assignedUser: { select: { id: true, name: true, avatarColor: true } },
        company: { select: { id: true, name: true } },
      },
    }),
  ]);
  return ok({ leads, total, page: q.page, pageSize: q.pageSize });
}

async function getLead(id: string) {
  const user = await requireApiUserWith("leads:read");
  const lead = await db.lead.findFirst({
    where: { ...recordScope(user, "lead", "read"), id, deletedAt: null },
    include: {
      source: true,
      assignedUser: { select: { id: true, name: true, avatarColor: true } },
      company: { select: { id: true, name: true } },
      contact: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!lead) throw new ApiNotFoundError("Lead not found");
  if (!hasPermission(user, "leads:read_all") &&
      lead.ownerId !== user.id &&
      lead.assignedUserId !== user.id &&
      lead.assignedUserId !== null) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Forbidden" } },
      { status: 403 }
    );
  }
  void canAccessRecord;
  return ok(lead);
}

export const POST = apiHandler<Ctx>(async (req, _ctx) => {
  const user = await requireApiUserWith("leads:create");
  const body = await parseBody(req, leadCreateSchema);
  const lead = await db.lead.create({
    data: {
      organizationId: user.organizationId,
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone ?? "",
      companyName: body.companyName ?? "",
      sourceId: body.sourceId,
      status: body.status ?? "NEW",
      estimatedValue: body.estimatedValue ?? 0,
      expectedCloseDate: parseDate(body.expectedCloseDate),
      followUpAt: parseDate(body.followUpAt),
      summary: body.notes ?? "",
      assignedUserId: body.assignedUserId || user.id,
      ownerId: user.id,
    },
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "LEAD_CREATE",
    entityType: "lead",
    entityId: lead.id,
    ipAddress: clientIp(req),
  });
  return ok(lead, { status: 201 });
});

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  const user = await requireApiUserWith("leads:update");
  const existing = await db.lead.findFirst({
    where: { id, organizationId: user.organizationId, deletedAt: null },
    select: { ownerId: true, assignedUserId: true },
  });
  if (!existing) throw new ApiNotFoundError("Lead not found");
  const canUpdate = hasPermission(user, "leads:update_all") || existing.ownerId === user.id || existing.assignedUserId === user.id;
  if (!canUpdate) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
  }
  const body = await parseBody(req, leadUpdateSchema);
  if (body.assignedUserId !== undefined && !canReassignRecord(user, body.assignedUserId || null, "leads:update_all")) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Forbidden" } },
      { status: 403 }
    );
  }
  const { assignedUserId, ...rest } = body;
  const data: Record<string, unknown> = {
    ...rest,
    ...(assignedUserId !== undefined ? { assignedUserId: assignedUserId || null } : {}),
    ...(rest.expectedCloseDate ? { expectedCloseDate: parseDate(rest.expectedCloseDate) } : {}),
    ...(rest.followUpAt ? { followUpAt: parseDate(rest.followUpAt) } : {}),
  };
  const lead = await db.lead.update({ where: { id }, data });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "LEAD_UPDATE",
    entityType: "lead",
    entityId: id,
    ipAddress: clientIp(req),
  });
  return ok(lead);
});

export const DELETE = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  const user = await requireApiUserWith("leads:delete");
  const existing = await db.lead.findFirst({
    where: { id, organizationId: user.organizationId, deletedAt: null },
    select: { ownerId: true },
  });
  if (!existing) throw new ApiNotFoundError("Lead not found");
  if (!canWriteRecord(user, existing.ownerId, "leads:delete_all")) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
  }
  await db.lead.update({ where: { id }, data: { deletedAt: new Date() } });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "LEAD_DELETE",
    entityType: "lead",
    entityId: id,
    ipAddress: clientIp(req),
  });
  return ok({ deleted: true });
});

async function checkDuplicates(req: NextRequest) {
  const user = await requireApiUserWith("leads:read");
  const q = parseQuery(req, z.object({ email: z.string().email() }));
  const existing = await db.lead.findFirst({
    where: { ...recordScope(user, "lead", "read"), email: q.email, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, status: true },
  });
  return ok({ duplicate: !!existing, existing });
}
