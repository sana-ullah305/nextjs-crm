import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok, fail, parseQuery, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { saveFile, validateFile, getFileUrl } from "@/server/storage";
import type { Prisma } from "@/generated/prisma";

const ENTITY_TYPES = ["CONTACT", "COMPANY", "LEAD", "DEAL", "ACTIVITY", "NOTE", "EMAIL"] as const;

const listQuerySchema = z.object({
  entityType: z.enum(ENTITY_TYPES).optional(),
  entityId: z.string().trim().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

type Ctx = { params: Promise<{}> };

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const user = await requireApiUserWith("attachments:read");
  const q = parseQuery(req, listQuerySchema);
  const where: Prisma.AttachmentWhereInput = {
    organizationId: user.organizationId,
    deletedAt: null,
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
  };
  const [total, attachments] = await Promise.all([
    db.attachment.count({ where }),
    db.attachment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { uploadedBy: { select: { id: true, name: true, avatarColor: true } } },
    }),
  ]);
  return ok({ attachments, total, page: q.page, pageSize: q.pageSize });
});

async function findEntityRecord(entityType: string, entityId: string, organizationId: string) {
  switch (entityType) {
    case "CONTACT":
      return db.contact.findFirst({ where: { id: entityId, organizationId }, select: { id: true } });
    case "COMPANY":
      return db.company.findFirst({ where: { id: entityId, organizationId }, select: { id: true } });
    case "LEAD":
      return db.lead.findFirst({ where: { id: entityId, organizationId }, select: { id: true } });
    case "DEAL":
      return db.deal.findFirst({ where: { id: entityId, organizationId }, select: { id: true } });
    case "ACTIVITY":
      return db.activity.findFirst({ where: { id: entityId, organizationId }, select: { id: true } });
    case "NOTE":
      return db.note.findFirst({ where: { id: entityId, organizationId }, select: { id: true } });
    case "EMAIL":
      return db.sentEmail.findFirst({ where: { id: entityId, organizationId }, select: { id: true } });
    default:
      return null;
  }
}

export const POST = apiHandler<Ctx>(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireApiUserWith("attachments:create");
  const formData = await req.formData();
  const file = formData.get("file");
  const entityType = formData.get("entityType");
  const entityId = formData.get("entityId");

  if (!(file instanceof File) || typeof entityType !== "string" || typeof entityId !== "string") {
    return fail(400, "VALIDATION_ERROR", "Expected multipart/form-data with file, entityType, entityId");
  }
  if (!ENTITY_TYPES.includes(entityType as (typeof ENTITY_TYPES)[number])) {
    return fail(400, "VALIDATION_ERROR", `entityType must be one of ${ENTITY_TYPES.join(", ")}`);
  }
  if (!entityId.trim()) {
    return fail(400, "VALIDATION_ERROR", "entityId is required");
  }

  const validation = validateFile(file);
  if (!validation.ok) {
    return fail(400, "VALIDATION_ERROR", validation.error.message, { code: validation.error.code });
  }

  const record = await findEntityRecord(entityType, entityId.trim(), user.organizationId);
  if (!record) {
    return fail(400, "VALIDATION_ERROR", `${entityType.toLowerCase()} not found`);
  }

  const stored = await saveFile(file, user.organizationId);
  const attachment = await db.attachment.create({
    data: {
      filename: stored.path.split("/").pop() ?? file.name,
      originalName: file.name,
      mimeType: stored.mimeType,
      size: stored.size,
      path: stored.path,
      storageType: "LOCAL",
      organizationId: user.organizationId,
      entityType,
      entityId: entityId.trim(),
      uploadedById: user.id,
    },
    include: { uploadedBy: { select: { id: true, name: true, avatarColor: true } } },
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "ATTACHMENT_UPLOAD",
    entityType: "attachment",
    entityId: attachment.id,
    ipAddress: clientIp(req),
    metadata: { entityType, entityId: attachment.entityId, mimeType: attachment.mimeType, size: attachment.size },
  });
  return ok({ ...attachment, url: getFileUrl(attachment) }, { status: 201 });
});
