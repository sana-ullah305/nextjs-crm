import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseBody, parseQuery, ApiNotFoundError, clientIp } from "@/server/api";
import { requireApiUserWith, hasPermission, canAccessRecord, canReassignRecord, canWriteRecord, recordScope, visibilityScope } from "@/server/rbac";
import { contactCreateSchema, contactUpdateSchema, contactImportSchema } from "@/lib/schemas";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

type Ctx = { params: Promise<{ id?: string[] }> };

async function resolveId(ctx: Ctx): Promise<string | null> {
  const parts = (await ctx.params) as unknown as { id?: string[] };
  const segs = parts.id;
  return segs && segs.length > 0 && segs[0] ? segs[0] : null;
}

async function resolveTags(organizationId: string, tagNames: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of tagNames) {
    const tag = await db.tag.upsert({
      where: { organizationId_name: { organizationId, name } },
      create: { organizationId, name },
      update: {},
    });
    ids.push(tag.id);
  }
  return ids;
}

const listQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.string().trim().max(40).optional(),
  companyId: z.string().trim().max(64).optional(),
  ownerId: z.string().trim().max(64).optional(),
  sort: z.enum(["recent", "name", "lastContacted"]).default("recent"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (id === "export") return exportContacts(req);
  if (!id || id === "list") return listContacts(req);
  if (id === "import") return importContacts(req);
  return getContact(id);
});

async function listContacts(req: NextRequest) {
  const user = await requireApiUserWith("contacts:read");
  const q = parseQuery(req, listQuerySchema);
  const searchClause = q.q
    ? {
        OR: [
          { firstName: { contains: q.q } },
          { lastName: { contains: q.q } },
          { email: { contains: q.q } },
          { phone: { contains: q.q } },
        ],
      }
    : {};
  const where = {
    ...recordScope(user, "contact", "read"),
    deletedAt: null,
    ...(q.status ? { status: q.status } : {}),
    ...(q.companyId ? { companyId: q.companyId } : {}),
    ...(q.ownerId ? { ownerId: q.ownerId } : {}),
    AND: [visibilityScope(user, "contacts:read_all"), searchClause],
  };
  const [total, contacts] = await Promise.all([
    db.contact.count({ where }),
    db.contact.findMany({
      where,
      orderBy:
        q.sort === "name"
          ? { lastName: "asc" }
          : q.sort === "lastContacted"
            ? [{ lastContactedAt: "desc" }, { createdAt: "desc" }]
            : { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        company: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true, avatarColor: true } },
        tags: true,
      },
    }),
  ]);
  return ok({ contacts, total, page: q.page, pageSize: q.pageSize });
}

async function getContact(id: string) {
  const user = await requireApiUserWith("contacts:read");
  const contact = await db.contact.findFirst({
    where: { ...recordScope(user, "contact", "read"), id, deletedAt: null },
    include: {
      company: true,
      owner: { select: { id: true, name: true, avatarColor: true } },
      tags: true,
    },
  });
  if (!contact) throw new ApiNotFoundError("Contact not found");
  if (!canAccessRecord(user, contact.ownerId)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
  }
  return ok(contact);
}

export const POST = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (id === "import") return importContacts(req);
  return createContact(req);
});

async function createContact(req: NextRequest) {
  const user = await requireApiUserWith("contacts:create");
  const body = await parseBody(req, contactCreateSchema);
  const tagIds = await resolveTags(user.organizationId, body.tags ?? []);
  const contact = await db.contact.create({
    data: {
      organizationId: user.organizationId,
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email ?? "",
      phone: body.phone ?? "",
      mobile: body.mobile ?? "",
      title: body.title ?? "",
      companyId: body.companyId || null,
      ownerId: body.ownerId || user.id,
      status: body.status ?? "ACTIVE",
      address: body.address ?? "",
      city: body.city ?? "",
      state: body.state ?? "",
      country: body.country ?? "",
      tags: { connect: tagIds.map((id) => ({ id })) },
    },
    include: { tags: true },
  });
  await db.activity.create({
    data: {
      organizationId: user.organizationId,
      type: "CREATED",
      title: `Contact created: ${contact.firstName} ${contact.lastName}`,
      contactId: contact.id,
      userId: user.id,
    },
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "CONTACT_CREATE",
    entityType: "contact",
    entityId: contact.id,
    ipAddress: clientIp(req),
  });
  return ok(contact, { status: 201 });
}

async function importContacts(req: NextRequest) {
  const user = await requireApiUserWith("contacts:import");
  const body = await parseBody(req, contactImportSchema);

  const { imported, skipped } = await db.$transaction(async (tx) => {
    let imported = 0;
    let skipped = 0;
    for (const row of body.contacts) {
      if (!row.firstName) {
        skipped++;
        continue;
      }
      const dup = row.email
        ? await tx.contact.findFirst({
            where: { organizationId: user.organizationId, email: row.email, deletedAt: null },
            select: { id: true },
          })
        : null;
      if (dup) {
        skipped++;
        continue;
      }
      let companyId: string | null = null;
      if (row.company) {
        const company = await tx.company.findFirst({
          where: { organizationId: user.organizationId, name: row.company, deletedAt: null },
          select: { id: true },
        });
        companyId =
          company?.id ??
          (await tx.company.create({
            data: { organizationId: user.organizationId, name: row.company },
          })).id;
      }
      await tx.contact.create({
        data: {
          organizationId: user.organizationId,
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email,
          phone: row.phone,
          title: row.title,
          companyId,
          ownerId: user.id,
        },
      });
      imported++;
    }
    return { imported, skipped };
  });

  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "CONTACT_IMPORT",
    ipAddress: clientIp(req),
    metadata: { imported, skipped },
  });
  return ok({ imported, skipped });
}

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list" || id === "import" || id === "export") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown route" } }, { status: 404 });
  }
  const user = await requireApiUserWith("contacts:update");
  const existing = await db.contact.findFirst({
    where: { id, organizationId: user.organizationId, deletedAt: null },
    select: { ownerId: true },
  });
  if (!existing) throw new ApiNotFoundError("Contact not found");
  if (!canWriteRecord(user, existing.ownerId, "contacts:update_all")) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
  }
  const body = await parseBody(req, contactUpdateSchema);
  if (body.ownerId !== undefined && !canReassignRecord(user, body.ownerId || null, "contacts:update_all")) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Forbidden" } },
      { status: 403 }
    );
  }
  const tagIds = body.tags ? await resolveTags(user.organizationId, body.tags) : undefined;
  const { tags, email, ...data } = body;
  const contact = await db.contact.update({
    where: { id },
    data: {
      ...data,
      ...(email !== undefined ? { email } : {}),
      ...(data.companyId !== undefined ? { companyId: data.companyId || null } : {}),
      ...(data.ownerId !== undefined ? { ownerId: data.ownerId || null } : {}),
      ...(tagIds ? { tags: { set: tagIds.map((tid) => ({ id: tid })) } } : {}),
    },
    include: { tags: true },
  });
  await db.activity.create({
    data: {
      organizationId: user.organizationId,
      type: "UPDATED",
      title: `Contact updated: ${contact.firstName} ${contact.lastName}`,
      contactId: contact.id,
      userId: user.id,
    },
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "CONTACT_UPDATE",
    entityType: "contact",
    entityId: id,
    ipAddress: clientIp(req),
  });
  return ok(contact);
});

export const DELETE = apiHandler<Ctx>(async (req, ctx) => {
  const id = await resolveId(ctx);
  if (!id || id === "list" || id === "import" || id === "export") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Missing id" } }, { status: 404 });
  }
  const user = await requireApiUserWith("contacts:delete");
  const existing = await db.contact.findFirst({
    where: { id, organizationId: user.organizationId, deletedAt: null },
    select: { ownerId: true },
  });
  if (!existing) throw new ApiNotFoundError("Contact not found");
  if (!canWriteRecord(user, existing.ownerId, "contacts:delete_all")) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
  }
  await db.contact.update({ where: { id }, data: { deletedAt: new Date() } });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "CONTACT_DELETE",
    entityType: "contact",
    entityId: id,
    ipAddress: clientIp(req),
  });
  return ok({ deleted: true });
});

async function exportContacts(req: NextRequest) {
  const user = await requireApiUserWith("contacts:export");
  const q = parseQuery(req, listQuerySchema);
  const where = {
    ...recordScope(user, "contact", "read"),
    deletedAt: null,
    ...(q.status ? { status: q.status } : {}),
    ...(q.companyId ? { companyId: q.companyId } : {}),
    ...(q.ownerId ? { ownerId: q.ownerId } : {}),
  };
  const contacts = await db.contact.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { company: { select: { name: true } }, owner: { select: { name: true } } },
  });
  const header = ["firstName", "lastName", "email", "phone", "mobile", "title", "company", "owner", "status", "address", "city", "state", "country", "createdAt"];
  const rows = contacts.map((c) => [
    c.firstName,
    c.lastName,
    c.email,
    c.phone,
    c.mobile,
    c.title,
    c.company?.name ?? "",
    c.owner?.name ?? "",
    c.status,
    c.address,
    c.city,
    c.state,
    c.country,
    c.createdAt.toISOString(),
  ]);
  const csv = [header.join(","), ...rows.map((r) => r.map(escapeCsv).join(","))].join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=contacts.csv",
    },
  });
}

function escapeCsv(v: string): string {
  const cell = /[",\n]/.test(v) ? "\"" + v.replace(/"/g, "\"\"") + "\"" : v;
  return /^[=+\-@]/.test(cell) ? "'" + cell : cell;
}
