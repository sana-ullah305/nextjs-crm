import { NextRequest, NextResponse } from "next/server";
import { apiHandler, ok, parseBody, ApiNotFoundError, clientIp } from "@/server/api";
import { requireApiUserWith, hasPermission } from "@/server/rbac";
import { meetingUpdateSchema } from "@/lib/schemas";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

type Ctx = { params: Promise<{ id: string }> };

async function resolveId(ctx: Ctx): Promise<string | null> {
  const parts = (await ctx.params) as unknown as { id?: string };
  const segs = parts.id;
  return segs ?? null;
}

function parseDate(v: string | undefined | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const meetingInclude = {
  createdBy: { select: { id: true, name: true, avatarColor: true } },
  attendees: {
    include: {
      user: { select: { id: true, name: true, avatarColor: true } },
      contact: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} as const;

export const GET = apiHandler<Ctx>(async (_req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  const user = await requireApiUserWith("meetings:read");
  const meeting = await db.meeting.findFirst({
    where: { id, organizationId: user.organizationId },
    include: meetingInclude,
  });
  if (!meeting) throw new ApiNotFoundError("Meeting not found");
  return ok(meeting);
});

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  const user = await requireApiUserWith("meetings:manage");
  const meeting = await db.meeting.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { id: true, createdById: true },
  });
  if (!meeting) throw new ApiNotFoundError("Meeting not found");
  if (!hasPermission(user, "meetings:manage") || (meeting.createdById !== user.id && user.role === "SALES_REP")) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
  }
  const body = await parseBody(req, meetingUpdateSchema);
  const startTime = body.startTime !== undefined ? parseDate(body.startTime) : undefined;
  const endTime = body.endTime !== undefined ? parseDate(body.endTime) : undefined;

  const updated = await db.meeting.update({
    where: { id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(startTime !== undefined ? { startTime: startTime ?? undefined } : {}),
      ...(body.endTime !== undefined ? { endTime } : {}),
      ...(body.location !== undefined ? { location: body.location } : {}),
      ...(body.meetingUrl !== undefined ? { meetingUrl: body.meetingUrl } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.outcome !== undefined ? { outcome: body.outcome } : {}),
      ...(body.recordingUrl !== undefined ? { recordingUrl: body.recordingUrl } : {}),
    },
    include: meetingInclude,
  });

  // Replace attendee sets when provided.
  if (body.attendeeUserIds !== undefined || body.attendeeContactIds !== undefined) {
    await db.meetingAttendee.deleteMany({ where: { meetingId: id } });
    const creates = [
      ...(body.attendeeUserIds ?? []).map((userId) => ({ meetingId: id, userId, status: "INVITED" })),
      ...(body.attendeeContactIds ?? []).map((contactId) => ({ meetingId: id, contactId, status: "INVITED" })),
    ];
    if (creates.length > 0) await db.meetingAttendee.createMany({ data: creates });
  }

  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "MEETING_UPDATE",
    entityType: "meeting",
    entityId: id,
    ipAddress: clientIp(req),
  });
  const fresh = await db.meeting.findUnique({ where: { id }, include: meetingInclude });
  return ok(fresh);
});

export const DELETE = apiHandler<Ctx>(async (_req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  const user = await requireApiUserWith("meetings:manage");
  const meeting = await db.meeting.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { createdById: true },
  });
  if (!meeting) throw new ApiNotFoundError("Meeting not found");
  if (meeting.createdById !== user.id && user.role === "SALES_REP") {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
  }
  await db.meeting.delete({ where: { id } });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "MEETING_DELETE",
    entityType: "meeting",
    entityId: id,
    ipAddress: clientIp(_req),
  });
  return ok({ deleted: true });
});
