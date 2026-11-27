import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import type { Attachment } from "@/generated/prisma/client";

/**
 * Local-disk file storage for attachments.
 *
 * Files are stored under <UPLOAD_DIR>/<orgId>/<uuid>-<originalName> and served
 * through the /api/attachments routes, so every download is authenticated and
 * org-scoped. (S3 support can be added later behind the storageType flag.)
 */

export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "uploads";
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// Allowed mime types: images, PDF, Word, Excel, CSV, plain text.
export const ACCEPTED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.ms-excel", // .xls
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "text/csv",
  "text/plain",
] as const;

export type AcceptedMimeType = (typeof ACCEPTED_MIME_TYPES)[number];

export interface StoredFile {
  path: string; // relative path under cwd, e.g. uploads/{orgId}/{uuid}-{name}
  url: string; // server-relative download URL
  size: number;
  mimeType: string;
}

export interface FileValidationError extends Error {
  code: "FILE_TOO_LARGE" | "INVALID_FILE_TYPE";
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.+/g, ".");
}

export function validateFile(file: File): { ok: true } | { ok: false; error: FileValidationError } {
  if (file.size > MAX_FILE_SIZE) {
    const err = new Error(`File exceeds ${MAX_FILE_SIZE / 1024 / 1024} MB`) as FileValidationError;
    err.code = "FILE_TOO_LARGE";
    return { ok: false, error: err };
  }
  if (!ACCEPTED_MIME_TYPES.includes((file.type ?? "").toLowerCase() as AcceptedMimeType)) {
    const err = new Error(`Unsupported file type: ${file.type ?? "application/octet-stream"}`) as FileValidationError;
    err.code = "INVALID_FILE_TYPE";
    return { ok: false, error: err };
  }
  return { ok: true };
}

export async function saveFile(file: File, orgId: string): Promise<StoredFile> {
  const validation = validateFile(file);
  if (!validation.ok) throw validation.error;

  const dir = path.join(UPLOAD_DIR, orgId);
  await fs.mkdir(dir, { recursive: true });

  const filename = `${crypto.randomUUID()}-${safeName(file.name)}`;
  const fullPath = path.join(dir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buffer);

  const relativePath = path.join(UPLOAD_DIR, orgId, filename);
  return {
    path: relativePath,
    url: getFileUrl({ path: relativePath }),
    size: buffer.byteLength,
    mimeType: file.type ?? "application/octet-stream",
  };
}

/** Server-relative URL for accessing an attachment's file. */
export function getFileUrl(attachment: Pick<Attachment, "id"> | Pick<Attachment, "path">): string {
  const att = attachment as { id?: string; path?: string };
  if (att.path) {
    return `/api/attachments/${att.path.split(path.sep).join("/")}`;
  }
  return `/api/attachments/${att.id}`;
}

export async function deleteFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") throw e;
  }
}

/**
 * Resolve a storage path to an absolute filesystem path, refusing anything
 * that escapes the upload root (path-traversal guard).
 */
export function resolveUploadPath(filePath: string): string {
  const root = path.resolve(UPLOAD_DIR);
  const target = path.resolve(root, filePath);
  if (target !== root && !target.startsWith(root + path.sep)) {
    const err = new Error("Unsafe file path") as NodeJS.ErrnoException;
    err.code = "EINVAL";
    throw err;
  }
  return target;
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return false;
    throw e;
  }
}

export function createDownloadStream(filePath: string) {
  return createReadStream(filePath);
}

