import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { apiHandler, ok, fail, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { deleteFile, fileExists, resolveUploadPath } from "@/server/storage";

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
};

function mimeForFileName(fileName: string): string {
  const ext = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function respondWithFile(buffer: Buffer, mimeType: string, fileName: string) {
  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}

type Ctx = { params: Promise<{ id: string }> };

async function resolveSegments(ctx: Ctx): Promise<string[]> {
  const parts = (await ctx.params) as unknown as { id?: string };
  return parts.id ? [parts.id] : [];
}

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const user = await requireApiUserWith("attachments:read");
  const segs = await resolveSegments(ctx);

  // GET /api/attachments/<attachmentId> — serve by database record.
  if (segs.length === 1) {
    const attachment = await db.attachment.findFirst({
      where: { id: segs[0], organizationId: user.organizationId, deletedAt: null },
      select: { path: true, mimeType: true, originalName: true, size: true },
    });
    if (!attachment) {
      return fail(404, "NOT_FOUND", "Attachment not found");
    }
    const fullPath = resolveUploadPath(attachment.path);
    if (!(await fileExists(fullPath))) {
      return fail(404, "NOT_FOUND", "File not on disk");
    }
    const buffer = await readFile(fullPath);
    return respondWithFile(buffer, attachment.mimeType, attachment.originalName);
  }

  // GET /api/attachments/uploads/<orgId>/<file> — direct path serve, org-scoped.
  if (segs.length < 3 || segs[0] !== "uploads" || segs[1] !== user.organizationId) {
    return fail(400, "VALIDATION_ERROR", "Expected /api/attachments/uploads/<orgId>/<file>");
  }
  const filePath = segs.join("/");
  const fullPath = resolveUploadPath(filePath);
  if (!(await fileExists(fullPath))) {
    return fail(404, "NOT_FOUND", "File not on disk");
  }
  const buffer = await readFile(fullPath);
  return respondWithFile(buffer, mimeForFileName(segs[segs.length - 1] ?? ""), segs[segs.length - 1] ?? "download");
});

export const DELETE = apiHandler<Ctx>(async (req, ctx) => {
  const user = await requireApiUserWith("attachments:delete");
  const segs = await resolveSegments(ctx);
  if (segs.length !== 1) {
    return fail(400, "VALIDATION_ERROR", "Expected /api/attachments/<attachmentId>");
  }

  const attachment = await db.attachment.findFirst({
    where: { id: segs[0], organizationId: user.organizationId },
    select: { id: true, path: true, deletedAt: true, uploadedById: true },
  });
  if (!attachment) {
    return fail(404, "NOT_FOUND", "Attachment not found");
  }
  const isPrivileged = user.role === "ADMIN" || user.role === "MANAGER";
  if (attachment.uploadedById !== user.id && !isPrivileged) {
    return fail(403, "FORBIDDEN", "Forbidden");
  }
  if (!attachment.deletedAt) {
    await db.attachment.update({
      where: { id: segs[0] },
      data: { deletedAt: new Date() },
    });
    await deleteFile(attachment.path);
    await writeAudit({
      organizationId: user.organizationId,
      userId: user.id,
      action: "ATTACHMENT_DELETE",
      entityType: "attachment",
      entityId: segs[0],
      ipAddress: clientIp(req),
    });
  }
  return ok({ deleted: true });
});
