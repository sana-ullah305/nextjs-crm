import { NextRequest, NextResponse } from "next/server";
import { apiHandler, ok, parseBody, ApiNotFoundError, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { callUpdateSchema } from "@/lib/schemas";
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

const callInclude = {
  createdBy: { select: { id: true, name: true, avatarColor: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  lead: { select: { id: true, firstName: true, lastName: true } },
  deal: { select: { id: true, name: true } },
} as const;

export const GET = apiHandler<Ctx>(async (_req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  const user = await requireApiUserWith("calls:read");
  const call = await db.call.findFirst({
    where: { id, organizationId: user.organizationId },
    include: callInclude,
  });
  if (!call) throw new ApiNotFoundError("Call not found");
  return ok(call);
});

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  const user = await requireApiUserWith("calls:manage");
  const call = await db.call.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { id: true },
  });
  if (!call) throw new ApiNotFoundError("Call not found");
  const body = await parseBody(req, callUpdateSchema);
  const updated = await db.call.update({
    where: { id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.contactId !== undefined ? { contactId: body.contactId ?? null } : {}),
      ...(body.leadId !== undefined ? { leadId: body.leadId ?? null } : {}),
      ...(body.dealId !== undefined ? { dealId: body.dealId ?? null } : {}),
      ...(body.direction !== undefined ? { direction: body.direction } : {}),
      ...(body.duration !== undefined ? { duration: body.duration } : {}),
      ...(body.outcome !== undefined ? { outcome: body.outcome } : {}),
      ...(body.recordingUrl !== undefined ? { recordingUrl: body.recordingUrl } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.calledAt !== undefined ? { calledAt: parseDate(body.calledAt) ?? undefined } : {}),
    },
    include: callInclude,
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "CALL_UPDATE",
    entityType: "call",
    entityId: id,
    ipAddress: clientIp(req),
  });
  return ok(updated);
});

export const DELETE = apiHandler<Ctx>(async (_req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  const user = await requireApiUserWith("calls:manage");
  const call = await db.call.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { id: true },
  });
  if (!call) throw new ApiNotFoundError("Call not found");
  await db.call.delete({ where: { id } });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "CALL_DELETE",
    entityType: "call",
    entityId: id,
    ipAddress: clientIp(_req),
  });
  return ok({ deleted: true });
});
