import { NextRequest } from "next/server";
import { z } from "zod";
import {
  apiHandler,
  ok,
  parseBody,
  parseQuery,
  ApiNotFoundError,
  clientIp,
} from "@/server/api";
import { requireApiUser, requireApiUserWith } from "@/server/rbac";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

/**
 * Trash / restore API for soft-deleted companies, contacts, and leads.
 *
 *   GET    /api/trash?type=company|contact|lead  — list soft-deleted rows
 *   POST   /api/trash  { type, id, action: "restore" | "hard_delete" }
 *
 * Permissions:
 *   - listing requires `contacts:read` (covers companies too, matching the
 *     rest of the app);
 *   - restore requires `record:restore` (manager/admin);
 *   - hard_delete requires `record:hard_delete` (admin only) and is
 *     irreversible — related rows cascade via the schema's onDelete rules.
 */

const trashQuerySchema = z.object({
  type: z.enum(["company", "contact", "lead"]).default("company"),
});

const trashBodySchema = z.object({
  type: z.enum(["company", "contact", "lead"]),
  id: z.string().trim().min(1),
  action: z.enum(["restore", "hard_delete"]),
});

type TrashType = "company" | "contact" | "lead";

type TrashRow = {
  id: string;
  title: string;
  subtitle: string;
  deletedAt: Date | null;
  summary: string;
  owner: string | null;
};

export const GET = apiHandler(async (req: NextRequest) => {
  await requireApiUserWith("contacts:read");
  const q = parseQuery(req, trashQuerySchema);
  return ok(await listTrash(q.type));
});

async function listTrash(type: TrashType): Promise<TrashRow[]> {
  if (type === "company") {
    const rows = await db.company.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      take: 200,
      select: {
        id: true,
        name: true,
        domain: true,
        deletedAt: true,
        summary: true,
        owner: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.name,
      subtitle: r.domain,
      deletedAt: r.deletedAt,
      summary: r.summary,
      owner: r.owner?.name ?? null,
    }));
  }
  if (type === "contact") {
    const rows = await db.contact.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      take: 200,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        deletedAt: true,
        summary: true,
        owner: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      title: `${r.firstName} ${r.lastName}`.trim() || r.email,
      subtitle: r.email,
      deletedAt: r.deletedAt,
      summary: r.summary,
      owner: r.owner?.name ?? null,
    }));
  }
  const rows = await db.lead.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    take: 200,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      deletedAt: true,
      summary: true,
      owner: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    title: `${r.firstName} ${r.lastName}`.trim() || r.email,
    subtitle: r.email,
    deletedAt: r.deletedAt,
    summary: r.summary,
    owner: r.owner?.name ?? null,
  }));
}

export const POST = apiHandler(async (req: NextRequest) => {
  const body = await parseBody(req, trashBodySchema);
  const user = await requireApiUser();

  if (body.action === "restore") {
    const actor = await requireApiUserWith("record:restore");
    return ok(await restoreRecord(body.type, body.id, actor));
  }
  // hard_delete — admin only.
  const actor = await requireApiUserWith("record:hard_delete");
  return ok(await hardDeleteRecord(req, body.type, body.id, actor));
});

async function restoreRecord(
  type: TrashType,
  id: string,
  user: { id: string; organizationId: string }
) {
  const where = { id, organizationId: user.organizationId, deletedAt: { not: null } };
  const existing =
    type === "company"
      ? await db.company.findFirst({ where, select: { id: true } })
      : type === "contact"
        ? await db.contact.findFirst({ where, select: { id: true } })
        : await db.lead.findFirst({ where, select: { id: true } });
  if (!existing) throw new ApiNotFoundError("Deleted record not found");

  if (type === "company") {
    await db.company.update({ where: { id }, data: { deletedAt: null } });
  } else if (type === "contact") {
    await db.contact.update({ where: { id }, data: { deletedAt: null } });
  } else {
    await db.lead.update({ where: { id }, data: { deletedAt: null } });
  }
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "RECORD_RESTORE",
    entityType: type,
    entityId: id,
  });
  return { restored: true, id };
}

async function hardDeleteRecord(
  req: NextRequest,
  type: TrashType,
  id: string,
  user: { id: string; organizationId: string }
) {
  const where = { id, organizationId: user.organizationId, deletedAt: { not: null } };
  const existing =
    type === "company"
      ? await db.company.findFirst({ where, select: { id: true } })
      : type === "contact"
        ? await db.contact.findFirst({ where, select: { id: true } })
        : await db.lead.findFirst({ where, select: { id: true } });
  if (!existing) throw new ApiNotFoundError("Deleted record not found");

  if (type === "company") {
    await db.company.delete({ where: { id } });
  } else if (type === "contact") {
    await db.contact.delete({ where: { id } });
  } else {
    await db.lead.delete({ where: { id } });
  }
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "RECORD_HARD_DELETE",
    entityType: type,
    entityId: id,
    ipAddress: clientIp(req),
  });
  return { deleted: true, id };
}
