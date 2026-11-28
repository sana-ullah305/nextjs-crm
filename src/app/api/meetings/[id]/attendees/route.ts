import { NextRequest, NextResponse } from "next/server";
import { apiHandler, ok, parseBody, ApiNotFoundError, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { meetingAttendeeCreateSchema } from "@/lib/schemas";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

type Ctx = { params: Promise<{ id: string }> };

async function resolveMeetingId(ctx: Ctx): Promise<string | null> {
  const parts = (await ctx.params) as unknown as { id?: string };
  const segs = parts.id;
  return segs ?? null;
}

const attendeeInclude = {
  user: { select: { id: true, name: true, avatarColor: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
} as const;

export const GET = apiHandler<Ctx>(async (_req, ctx) => {
  const meetingId = await resolveMeetingId(ctx);
  if (!meetingId) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  const user = await requireApiUserWith("meetings:read");
  const meeting = await db.meeting.findFirst({
    where: { id: meetingId, organizationId: user.organizationId },
    select: { id: true },
  });
  if (!meeting) throw new ApiNotFoundError("Meeting not found");
  const attendees = await db.meetingAttendee.findMany({
    where: { meetingId },
    orderBy: { createdAt: "asc" },
    include: attendeeInclude,
  });
  return ok({ attendees });
});

export const POST = apiHandler<Ctx>(async (req, ctx) => {
  const meetingId = await resolveMeetingId(ctx);
  if (!meetingId) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  const user = await requireApiUserWith("meetings:manage");
  const meeting = await db.meeting.findFirst({
    where: { id: meetingId, organizationId: user.organizationId },
    select: { id: true },
  });
  if (!meeting) throw new ApiNotFoundError("Meeting not found");
  const body = await parseBody(req, meetingAttendeeCreateSchema);
  const attendee = await db.meetingAttendee.create({
    data: {
      meetingId,
      userId: body.userId ?? null,
      contactId: body.contactId ?? null,
      status: body.status,
    },
    include: attendeeInclude,
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "MEETING_ATTENDEE_ADD",
    entityType: "meeting",
    entityId: meetingId,
    ipAddress: clientIp(req),
  });
  return ok(attendee, { status: 201 });
});
