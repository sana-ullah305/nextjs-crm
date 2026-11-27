import { apiHandler, ok, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { db } from "@/server/db";
import { encrypt } from "@/server/encryption";
import { writeAudit } from "@/server/audit";
import { z } from "zod";
import { emailSettingsSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ section?: string[] }> };

/**
 * Email (SMTP) settings API, mounted as /api/settings/email.
 * Kept separate from the main settings route because it shares the
 * emailSettingsSchema and has a simpler read/write shape.
 *
 * GET    /api/settings/email — read current SMTP config (secret-free fields
 *                              only; smtp password is never stored or returned).
 * PATCH  /api/settings/email — update SMTP config (settings:manage).
 */
export const GET = apiHandler<Ctx>(async () => {
  const user = await requireApiUserWith("settings:read");
  const settings = await db.emailSettings.findUnique({
    where: { organizationId: user.organizationId },
  });
  return ok({ settings });
});

export const PATCH = apiHandler<Ctx>(async (req, _ctx) => {
  const user = await requireApiUserWith("settings:manage");
  const body = await parseEmailSettings(req);

  const data: {
    smtpHost?: string;
    smtpPort?: number;
    smtpUser?: string;
  smtpPasswordEncrypted?: string;
    fromAddress?: string;
    notificationsEnabled?: boolean;
  } = {};
  if (body.smtpHost !== undefined) data.smtpHost = body.smtpHost;
  if (body.smtpPort !== undefined) data.smtpPort = body.smtpPort;
  if (body.smtpUser !== undefined) data.smtpUser = body.smtpUser;
  if (body.smtpPassword !== undefined && body.smtpPassword) data.smtpPasswordEncrypted = encrypt(body.smtpPassword);
  if (body.fromAddress !== undefined) data.fromAddress = body.fromAddress;
  if (body.notificationsEnabled !== undefined) data.notificationsEnabled = body.notificationsEnabled;

  const settings = await db.emailSettings.upsert({
    where: { organizationId: user.organizationId },
    create: { organizationId: user.organizationId, ...data },
    update: data,
  });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "EMAIL_SETTINGS_UPDATE",
    entityType: "emailSettings",
    entityId: settings.id,
    ipAddress: clientIp(req),
  });
  return ok({ settings });
});

async function parseEmailSettings(req: Parameters<typeof import("@/server/api").parseBody>[0]) {
  const { parseBody } = await import("@/server/api");
  return parseBody(req, emailSettingsSchema);
}

export const POST = apiHandler<Ctx>(async (req, _ctx) => {
  const user = await requireApiUserWith("settings:manage");
  const body = await req.json().catch(() => ({}));
  if (body?.action !== "test") return ok({ error: "Unknown action" });
  const { getTransporter } = await import("@/server/mailer");
  const t = await getTransporter(user.organizationId);
  if (!t) return ok({ ok: false, error: "SMTP not configured" });
  try {
    await t.transporter.verify();
    return ok({ ok: true });
  } catch (e) {
    return ok({ ok: false, error: e instanceof Error ? e.message : "verify failed" });
  }
});
