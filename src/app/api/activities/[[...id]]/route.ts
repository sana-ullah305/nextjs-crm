import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseBody, parseQuery, ApiNotFoundError, clientIp } from "@/server/api";
import { requireApiUserWith, recordScope } from "@/server/rbac";
import { activityCreateSchema, noteCreateSchema } from "@/lib/schemas";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

type Ctx = { params: Promise<{ id?: string[] }> };

async function resolveId(ctx: Ctx): Promise<string | null> {
  const parts = (await ctx.params) as unknown as { id?: string[] };
  const segs = parts.id;
  return segs && segs.length > 0 && segs[0] ? segs[0] : null;
}

const listQuerySchema = z.object({
  contactId: z.string().trim().max(64).optional(),
  companyId: z.string().trim().max(64).optional(),
  dealId: z.string().trim().max(64).optional(),
  leadId: z.string().trim().max(64).optional(),
  type: z.string().trim().max(30).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

function parseDate(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  const user = await requireApiUserWith("activities:read");
  const q = parseQuery(req, listQuerySchema);
  // GET /activities/notes?contactId=... style: second segment is not used; notes are fetched via ?notesOf=
  void id;
  const where = {
    ...recordScope(user, "activity", "read"),
    ...(q.contactId ? { contactId: q.contactId } : {}),
    ...(q.companyId ? { companyId: q.companyId } : {}),
    ...(q.dealId ? { dealId: q.dealId } : {}),
    ...(q.leadId ? { leadId: q.leadId } : {}),
    ...(q.type ? { type: q.type } : {}),
  };
  const [total, activities] = await Promise.all([
    db.activity.count({ where }),
    db.activity.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { user: { select: { id: true, name: true, avatarColor: true } } },
    }),
  ]);
  return ok({ activities, total, page: q.page, pageSize: q.pageSize });
});

export const POST = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (id === "note") return createNote(req);
  return logActivity(req);
});

async function logActivity(req: NextRequest) {
  const user = await requireApiUserWith("activities:create");
  const body = await parseBody(req, activityCreateSchema);
  const activity = await db.activity.create({
    data: {
      organizationId: user.organizationId,
      type: body.type,
      title: body.title,
      description: body.description ?? "",
      contactId: body.contactId || null,
      companyId: body.companyId || null,
      dealId: body.dealId || null,
      leadId: body.leadId || null,
      userId: user.id,
      durationMinutes: body.durationMinutes ?? null,
      occurredAt: parseDate(body.occurredAt) ?? new Date(),
    },
    include: { user: { select: { id: true, name: true, avatarColor: true } } },
  });
  if (body.contactId) {
    await db.contact
      .update({ where: { id: body.contactId }, data: { lastContactedAt: activity.occurredAt } })
      .catch(() => undefined);
  }
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "ACTIVITY_CREATE",
    entityType: "activity",
    entityId: activity.id,
    ipAddress: clientIp(req),
  });
  return ok(activity, { status: 201 });
}

async function createNote(req: NextRequest) {
  const user = await requireApiUserWith("notes:create");
  const body = await parseBody(req, noteCreateSchema);
  if (!body.contactId && !body.companyId && !body.dealId && !body.leadId) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Note must be attached to a record" } },
      { status: 400 }
    );
  }
  const note = await db.note.create({
    data: {
      organizationId: user.organizationId,
      body: body.body,
      contactId: body.contactId || null,
      companyId: body.companyId || null,
      dealId: body.dealId || null,
      leadId: body.leadId || null,
      userId: user.id,
    },
    include: { user: { select: { id: true, name: true, avatarColor: true } } },
  });
  if (body.contactId) {
    await db.activity.create({
      data: {
        organizationId: user.organizationId,
        type: "NOTE",
        title: "Note added",
        description: body.body.slice(0, 200),
        contactId: body.contactId,
        userId: user.id,
      },
    });
  }
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "NOTE_CREATE",
    entityType: "note",
    entityId: note.id,
    ipAddress: clientIp(req),
  });
  return ok(note, { status: 201 });
}

export const DELETE = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "note") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  const user = await requireApiUserWith("notes:delete");
  const note = await db.note.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { userId: true },
  });
  if (!note) throw new ApiNotFoundError("Note not found");
  const isPrivileged = user.role === "ADMIN" || user.role === "MANAGER";
  if (note.userId !== user.id && !isPrivileged) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
  }
  await db.note.delete({ where: { id } });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "NOTE_DELETE",
    entityType: "note",
    entityId: id,
    ipAddress: clientIp(req),
  });
  return ok({ deleted: true });
});
