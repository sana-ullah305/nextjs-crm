import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseBody, parseQuery, ApiNotFoundError, ApiValidationError, clientIp } from "@/server/api";
import { requireApiUserWith, hasPermission, recordScope } from "@/server/rbac";
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
  const where = {
    ...recordScope(user, "lead", "read"),
    deletedAt: null,
    ...(q.status ? { status: q.status } : {}),
    ...(q.sourceId ? { sourceId: q.sourceId } : {}),
    ...(q.assignedUserId ? { assignedUserId: q.assignedUserId } : {}),
    ...(q.minScore !== undefined ? { score: { gte: q.minScore } } : {}),
    ...(q.q
      ? {
          OR: [
            { firstName: { contains: q.q } },
            { lastName: { contains: q.q } },
            { email: { contains: q.q } },
            { companyName: { contains: q.q } },
          ],
        }
      : {}),
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
  return ok(lead);
}

async function checkDuplicates(req: NextRequest) {
  const user = await requireApiUserWith("leads:read");
  const email = new URL(req.url).searchParams.get("email")?.trim().toLowerCase() ?? "";
  if (!email) {
    throw new ApiValidationError([{ path: ["email"], message: "email query param required" }]);
  }
  const [leadDup, contactDup] = await Promise.all([
    db.lead.findFirst({
      where: { organizationId: user.organizationId, email, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, status: true },
    }),
    db.contact.findFirst({
      where: { organizationId: user.organizationId, email, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, status: true },
    }),
  ]);
  return ok({
    isDuplicate: Boolean(leadDup || contactDup),
    lead: leadDup,
    contact: contactDup,
  });
}

async function computeScore(organizationId: string, data: {
  email: string;
  phone: string;
  companyName: string;
  sourceId: string | null | undefined;
  estimatedValue: number;
  followUpAt: Date | null;
}): Promise<number> {
  const source = data.sourceId
    ? await db.leadSource.findUnique({ where: { id: data.sourceId }, select: { name: true } })
    : null;
  return scoreLead({
    email: data.email,
    phone: data.phone,
    companyName: data.companyName,
    estimatedValue: data.estimatedValue,
    sourceName: source?.name ?? "",
    hasFollowUp: Boolean(data.followUpAt),
  });
}

export const POST = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (id === "check-duplicate" || id === "list") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown route" } }, { status: 404 });
  }
  if (id) return convertLead(req, id);
  return createLead(req);
});

async function createLead(req: NextRequest) {
  const user = await requireApiUserWith("leads:create");
  const body = await parseBody(req, leadCreateSchema);
  const followUp = parseDate(body.followUpAt);
  let companyId: string | null = null;
  if (body.companyName) {
    const company = await db.company.findFirst({
      where: { organizationId: user.organizationId, name: body.companyName, deletedAt: null },
      select: { id: true },
    });
    companyId =
      company?.id ??
      (
        await db.company.create({
          data: { organizationId: user.organizationId, name: body.companyName },
        })
      ).id;
  }
  const score = await computeScore(user.organizationId, {
    email: body.email,
    phone: body.phone,
    companyName: body.companyName,
    sourceId: body.sourceId,
    estimatedValue: body.estimatedValue,
    followUpAt: followUp,
  });
  const lead = await db.lead.create({
    data: {
      organizationId: user.organizationId,
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone,
      companyName: body.companyName,
      companyId,
      sourceId: body.sourceId || null,
      status: body.status,
      score,
      estimatedValue: body.estimatedValue,
      expectedCloseDate: parseDate(body.expectedCloseDate),
      followUpAt: followUp,
      summary: body.notes ?? "",
      assignedUserId: hasPermission(user, "leads:update_all") ? (body.assignedUserId || user.id) : user.id,
      ownerId: user.id,
    },
    include: { source: true, assignedUser: { select: { id: true, name: true, avatarColor: true } } },
  });
  await db.activity.create({
    data: {
      organizationId: user.organizationId,
      type: "CREATED",
      title: `Lead captured: ${lead.firstName} ${lead.lastName}`,
      leadId: lead.id,
      userId: user.id,
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
}

async function convertLead(req: NextRequest, leadId: string) {
  const user = await requireApiUserWith("leads:convert");
  const lead = await db.lead.findFirst({
    where: { ...recordScope(user, "lead", "read"), id: leadId, deletedAt: null },
    include: { company: true },
  });
  if (!lead) throw new ApiNotFoundError("Lead not found");
  if (lead.status === "CONVERTED") {
    throw new ApiValidationError([{ path: ["status"], message: "Lead is already converted" }]);
  }
  const body = await parseBody(req, leadConvertSchema);

  const contact = await db.contact.create({
    data: {
      organizationId: lead.organizationId,
      companyId: lead.companyId,
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      phone: lead.phone,
      status: "CUSTOMER",
      ownerId: lead.assignedUserId ?? user.id,
    },
  });

  let deal = null;
  if (body.createDeal) {
    const pipeline = body.pipelineId
      ? await db.pipeline.findFirst({
          where: { id: body.pipelineId, organizationId: lead.organizationId },
        })
      : await db.pipeline.findFirst({
          where: { organizationId: lead.organizationId, isDefault: true },
        });
    if (!pipeline) throw new ApiNotFoundError("No pipeline configured for this organization");
    const firstStage = await db.stage.findFirst({
      where: { pipelineId: pipeline.id },
      orderBy: { position: "asc" },
    });
    if (!firstStage) throw new ApiNotFoundError("Pipeline has no stages");
    deal = await db.deal.create({
      data: {
        organizationId: lead.organizationId,
        name: body.dealName || `${lead.companyName || contact.lastName} — new deal`,
        contactId: contact.id,
        companyId: lead.companyId,
        stageId: firstStage.id,
        pipelineId: pipeline.id,
        ownerId: lead.assignedUserId ?? user.id,
        sourceId: lead.sourceId,
        value: body.dealValue ?? lead.estimatedValue,
        probability: firstStage.probability,
        expectedCloseDate: parseDate(body.expectedCloseDate) ?? lead.expectedCloseDate,
        leadId: lead.id,
      },
    });
  }

  const updated = await db.lead.update({
    where: { id: leadId },
    data: { status: "CONVERTED", convertedAt: new Date(), contactId: contact.id },
  });

  await db.activity.create({
    data: {
      organizationId: user.organizationId,
      type: "CONVERTED",
      title: `Lead converted: ${lead.firstName} ${lead.lastName}`,
      leadId: lead.id,
      contactId: contact.id,
      dealId: deal?.id,
      userId: user.id,
    },
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "LEAD_CONVERT",
    entityType: "lead",
    entityId: lead.id,
    ipAddress: clientIp(req),
    metadata: { contactId: contact.id, dealId: deal?.id },
  });
  return ok({ lead: updated, contact, deal });
}

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "check-duplicate" || id === "list") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown route" } }, { status: 404 });
  }
  const user = await requireApiUserWith("leads:update");
  const lead = await db.lead.findFirst({
    where: { id, organizationId: user.organizationId, deletedAt: null },
    select: { id: true, assignedUserId: true, ownerId: true, email: true, phone: true, companyName: true, sourceId: true, estimatedValue: true, followUpAt: true },
  });
  if (!lead) throw new ApiNotFoundError("Lead not found");
  const canUpdate =
    hasPermission(user, "leads:update_all") ||
    lead.ownerId === user.id ||
    lead.assignedUserId === user.id;
  if (!canUpdate) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
  }
  const body = await parseBody(req, leadUpdateSchema);
  const nextEmail = body.email ?? lead.email;
  const nextPhone = body.phone ?? lead.phone;
  const nextCompany = body.companyName ?? lead.companyName;
  const nextSource = body.sourceId !== undefined ? body.sourceId || null : lead.sourceId;
  const nextValue = body.estimatedValue ?? lead.estimatedValue;
  const nextFollowUp = body.followUpAt !== undefined ? parseDate(body.followUpAt) : lead.followUpAt;
  const rating = await computeScore(user.organizationId, {
    email: nextEmail,
    phone: nextPhone,
    companyName: nextCompany,
    sourceId: nextSource,
    estimatedValue: nextValue,
    followUpAt: nextFollowUp,
  });
  const updated = await db.lead.update({
    where: { id },
    data: {
      ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
      ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.companyName !== undefined ? { companyName: body.companyName } : {}),
      ...(body.sourceId !== undefined ? { sourceId: body.sourceId || null } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.estimatedValue !== undefined ? { estimatedValue: body.estimatedValue } : {}),
      ...(body.expectedCloseDate !== undefined
        ? { expectedCloseDate: parseDate(body.expectedCloseDate) }
        : {}),
      ...(body.followUpAt !== undefined ? { followUpAt: nextFollowUp } : {}),
      ...(body.notes !== undefined ? { summary: body.notes } : {}),
      ...(body.assignedUserId !== undefined ? { assignedUserId: body.assignedUserId || null } : {}),
      score: rating,
    },
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "LEAD_UPDATE",
    entityType: "lead",
    entityId: id,
    ipAddress: clientIp(req),
  });
  return ok(updated);
});

export const DELETE = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "check-duplicate" || id === "list") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  const user = await requireApiUserWith("leads:delete");
  const lead = await db.lead.findFirst({
    where: { id, organizationId: user.organizationId, deletedAt: null },
    select: { ownerId: true, assignedUserId: true },
  });
  if (!lead) throw new ApiNotFoundError("Lead not found");
  const canDelete =
    hasPermission(user, "leads:delete_all") ||
    lead.ownerId === user.id ||
    lead.assignedUserId === user.id;
  if (!canDelete) {
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
