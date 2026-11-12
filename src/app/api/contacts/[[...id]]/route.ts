import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseBody, parseQuery, ApiNotFoundError, clientIp } from "@/server/api";
import { requireApiUserWith, hasPermission, canAccessRecord } from "@/server/rbac";
import { contactCreateSchema, contactUpdateSchema, contactImportSchema } from "@/lib/schemas";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

type Ctx = { params: Promise<{ id?: string[] }> };

async function resolveId(ctx: Ctx): Promise<string | null> {
  const parts = (await ctx.params) as unknown as { id?: string[] };
  const segs = parts.id;
  return segs && segs.length > 0 && segs[0] ? segs[0] : null;
}

const listQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.string().trim().max(30).optional(),
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
  return getContact(id);
});

async function listContacts(req: NextRequest) {
  const user = await requireApiUserWith("contacts:read");
  const q = parseQuery(req, listQuerySchema);
  const where = {
    organizationId: user.organizationId,
    deletedAt: null,
    ...(hasPermission(user, "contacts:read_all")
      ? {}
      : { OR: [{ ownerId: user.id }, { ownerId: null }] }),
    ...(q.status ? { status: q.status } : {}),
    ...(q.companyId ? { companyId: q.companyId } : {}),
    ...(q.ownerId ? { ownerId: q.ownerId } : {}),
    ...(q.q
      ? {
          OR: [
            { firstName: { contains: q.q } },
            { lastName: { contains: q.q } },
            { email: { contains: q.q } },
            { phone: { contains: q.q } },
          ],
        }
      : {}),
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
    where: { id, organizationId: user.organizationId, deletedAt: null },
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

function csvEscape(v: string): string {
  const cell = /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return /^[=+\-@]/.test(cell) ? `'${cell}` : cell;
}

async function exportContacts(req: NextRequest) {
  const user = await requireApiUserWith("contacts:export");
  const contacts = await db.contact.findMany({
    where: {
      organizationId: user.organizationId,
      deletedAt: null,
      ...(hasPermission(user, "contacts:read_all")
        ? {}
        : { OR: [{ ownerId: user.id }, { ownerId: null }] }),
    },
    include: { company: { select: { name: true } }, tags: true },
    orderBy: { createdAt: "desc" },
    take: 10000,
  });
  const header = "First Name,Last Name,Email,Phone,Title,Company,Status,City,Country,Tags";
  const rows = contacts.map((c) =>
    [
      c.firstName,
      c.lastName,
      c.email,
      c.phone,
      c.title,
      c.company?.name ?? "",
      c.status,
      c.city,
      c.country,
      c.tags.map((t) => t.name).join("; "),
    ]
      .map((x) => csvEscape(String(x ?? "")))
      .join(",")
  );
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "CONTACT_EXPORT",
    ipAddress: clientIp(req),
    metadata: { count: contacts.length },
  });
  return new NextResponse([header, ...rows].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contacts-${Date.now()}.csv"`,
    },
  });
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
      phone: body.phone,
      mobile: body.mobile ?? "",
      title: body.title,
      companyId: body.companyId || null,
      ownerId: body.ownerId || user.id,
      status: body.status,
      address: body.address,
      city: body.city,
      state: body.state,
      country: body.country,
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
  let imported = 0;
  let skipped = 0;
  for (const row of body.contacts) {
    if (!row.firstName) {
      skipped++;
      continue;
    }
    const dup = row.email
      ? await db.contact.findFirst({
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
      const company = await db.company.findFirst({
        where: { organizationId: user.organizationId, name: row.company, deletedAt: null },
        select: { id: true },
      });
      companyId =
        company?.id ??
        (await db.company.create({
          data: { organizationId: user.organizationId, name: row.company },
        })).id;
    }
    await db.contact.create({
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
  const canUpdate = hasPermission(user, "contacts:update_all") || existing.ownerId === user.id;
  if (!canUpdate) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
  }
  const body = await parseBody(req, contactUpdateSchema);
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
    entityId: contact.id,
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
  const canDelete = hasPermission(user, "contacts:delete_all") || existing.ownerId === user.id;
  if (!canDelete) {
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
