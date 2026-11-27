import { NextRequest, NextResponse } from "next/server";
import { apiHandler, ok, parseBody, ApiNotFoundError, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { meetingAttendeeUpdateSchema } from "@/lib/schemas";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

type Ctx = { params: Promise<{ id?: string[] }> };

async function resolveIds(ctx: Ctx): Promise<{ meetingId: string | null; attendeeId: string | null }> {
  const parts = (await ctx.params) as unknown as { id?: string[] };
  const segs = parts.id ?? [];
  return { meetingId: segs[0] ?? null, attendeeId: segs[1] ?? null };
}

const attendeeInclude = {
  user: { select: { id: true, name: true, avatarColor: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
} as const;

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const { meetingId, attendeeId } = await resolveIds(ctx);
  if (!meetingId || !attendeeId) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  const user = await requireApiUserWith("meetings:manage");
  const meeting = await db.meeting.findFirst({
    where: { id: meetingId, organizationId: user.organizationId },
    select: { id: true },
  });
  if (!meeting) throw new ApiNotFoundError("Meeting not found");
  const attendee = await db.meetingAttendee.findFirst({
    where: { id: attendeeId, meetingId },
    select: { id: true },
  });
  if (!attendee) throw new ApiNotFoundError("Attendee not found");
  const body = await parseBody(req, meetingAttendeeUpdateSchema);
  const updated = await db.meetingAttendee.update({
    where: { id: attendeeId },
    data: { ...(body.status !== undefined ? { status: body.status } : {}) },
    include: attendeeInclude,
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "MEETING_ATTENDEE_UPDATE",
    entityType: "meeting",
    entityId: meetingId,
    ipAddress: clientIp(req),
  });
  return ok(updated);
});

export const DELETE = apiHandler<Ctx>(async (_req, ctx) => {
  const { meetingId, attendeeId } = await resolveIds(ctx);
  if (!meetingId || !attendeeId) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  const user = await requireApiUserWith("meetings:manage");
  const meeting = await db.meeting.findFirst({
    where: { id: meetingId, organizationId: user.organizationId },
    select: { id: true },
  });
  if (!meeting) throw new ApiNotFoundError("Meeting not found");
  const attendee = await db.meetingAttendee.findFirst({
    where: { id: attendeeId, meetingId },
    select: { id: true },
  });
  if (!attendee) throw new ApiNotFoundError("Attendee not found");
  await db.meetingAttendee.delete({ where: { id: attendeeId } });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "MEETING_ATTENDEE_REMOVE",
    entityType: "meeting",
    entityId: meetingId,
    ipAddress: clientIp(_req),
  });
  return ok({ deleted: true });
});
