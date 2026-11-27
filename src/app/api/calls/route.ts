import { NextRequest } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseBody, parseQuery, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { callCreateSchema } from "@/lib/schemas";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

type Ctx = { params: Promise<{ id?: string[] }> };

function parseDate(v: string | undefined | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const listQuerySchema = z.object({
  contactId: z.string().trim().max(64).optional(),
  leadId: z.string().trim().max(64).optional(),
  dealId: z.string().trim().max(64).optional(),
  direction: z.string().trim().max(20).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

const callInclude = {
  createdBy: { select: { id: true, name: true, avatarColor: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  lead: { select: { id: true, firstName: true, lastName: true } },
  deal: { select: { id: true, name: true } },
} as const;

export const GET = apiHandler<Ctx>(async (req) => {
  const user = await requireApiUserWith("calls:read");
  const q = parseQuery(req, listQuerySchema);
  const where = {
    organizationId: user.organizationId,
    ...(q.contactId ? { contactId: q.contactId } : {}),
    ...(q.leadId ? { leadId: q.leadId } : {}),
    ...(q.dealId ? { dealId: q.dealId } : {}),
    ...(q.direction ? { direction: q.direction } : {}),
  };
  const [total, calls] = await Promise.all([
    db.call.count({ where }),
    db.call.findMany({
      where,
      orderBy: { calledAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: callInclude,
    }),
  ]);
  return ok({ calls, total, page: q.page, pageSize: q.pageSize });
});

export const POST = apiHandler<Ctx>(async (req, _ctx) => {
  const user = await requireApiUserWith("calls:create");
  const body = await parseBody(req, callCreateSchema);
  const call = await db.call.create({
    data: {
      organizationId: user.organizationId,
      title: body.title,
      contactId: body.contactId ?? null,
      leadId: body.leadId ?? null,
      dealId: body.dealId ?? null,
      direction: body.direction,
      duration: body.duration ?? 0,
      outcome: body.outcome ?? "",
      recordingUrl: body.recordingUrl ?? "",
      notes: body.notes ?? "",
      calledAt: parseDate(body.calledAt) ?? new Date(),
      createdById: user.id,
    },
    include: callInclude,
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "CALL_CREATE",
    entityType: "call",
    entityId: call.id,
    ipAddress: clientIp(req),
  });
  return ok(call, { status: 201 });
});
