import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseBody, parseQuery, ApiNotFoundError, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { meetingCreateSchema } from "@/lib/schemas";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

type Ctx = { params: Promise<{}> };

function parseDate(v: string | undefined | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const listQuerySchema = z.object({
  status: z.string().trim().max(20).optional(),
  contactId: z.string().trim().max(64).optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

const meetingInclude = {
  createdBy: { select: { id: true, name: true, avatarColor: true } },
  attendees: {
    include: {
      user: { select: { id: true, name: true, avatarColor: true } },
      contact: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} as const;

export const GET = apiHandler<Ctx>(async (req) => {
  const user = await requireApiUserWith("meetings:read");
  const q = parseQuery(req, listQuerySchema);
  const where = {
    organizationId: user.organizationId,
    ...(q.status ? { status: q.status } : {}),
    ...(q.contactId ? { attendees: { some: { contactId: q.contactId } } } : {}),
    ...(q.from || q.to
      ? {
          startTime: {
            ...(q.from ? { gte: parseDate(q.from) as Date } : {}),
            ...(q.to ? { lte: parseDate(q.to) as Date } : {}),
          },
        }
      : {}),
  };
  const [total, meetings] = await Promise.all([
    db.meeting.count({ where }),
    db.meeting.findMany({
      where,
      orderBy: { startTime: "asc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: meetingInclude,
    }),
  ]);
  return ok({ meetings, total, page: q.page, pageSize: q.pageSize });
});

export const POST = apiHandler<Ctx>(async (req, _ctx) => {
  const user = await requireApiUserWith("meetings:create");
  const body = await parseBody(req, meetingCreateSchema);
  const startTime = parseDate(body.startTime);
  if (!startTime) throw new ApiNotFoundError("Invalid start time");
  const endTime = parseDate(body.endTime);
  const meeting = await db.meeting.create({
    data: {
      organizationId: user.organizationId,
      title: body.title,
      description: body.description ?? "",
      startTime,
      endTime,
      location: body.location ?? "",
      meetingUrl: body.meetingUrl ?? "",
      status: body.status,
      outcome: body.outcome ?? "",
      recordingUrl: body.recordingUrl ?? "",
      createdById: user.id,
      attendees: {
        create: [
          ...body.attendeeUserIds.map((userId) => ({ userId, status: "INVITED" })),
          ...body.attendeeContactIds.map((contactId) => ({ contactId, status: "INVITED" })),
        ],
      },
    },
    include: meetingInclude,
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "MEETING_CREATE",
    entityType: "meeting",
    entityId: meeting.id,
    ipAddress: clientIp(req),
  });
  return ok(meeting, { status: 201 });
});
