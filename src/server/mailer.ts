import nodemailer, { type Transporter } from "nodemailer";
import { db } from "@/server/db";
import type { SessionUser } from "@/server/auth";

/**
 * Outbound email service.
 *
 * Sends transactional email through the organization's SMTP settings
 * (EmailSettings model). Delivery runs outside the request where possible;
 * failures are recorded on the SentEmail row rather than thrown to callers
 * that don't need to block on delivery.
 *
 * The transport is created lazily per org settings and cached. Tests and
 * environments without SMTP creds get a deliberate "not configured"
 * failure path that still records the attempt (status FAILED with a clear
 * error) so the audit trail keeps working without a mail server.
 */

export type SendEmailParams = {
  user: SessionUser;
  to: { email: string; name?: string };
  subject: string;
  body: string;
  contactId?: string | null;
  leadId?: string | null;
  dealId?: string | null;
  templateId?: string | null;
  clientIp?: string;
};

const transportCache = new Map<string, { key: string; transporter: Transporter } | null>();

function settingsKey(s: { smtpHost: string; smtpPort: number; smtpUser: string }): string {
  return `${s.smtpHost}:${s.smtpPort}:${s.smtpUser}`;
}

async function getTransporter(orgId: string) {
  const settings = await db.emailSettings.findUnique({ where: { organizationId: orgId } });
  if (!settings || !settings.smtpHost || !settings.fromAddress) return null;
  const key = settingsKey(settings);
  const cached = transportCache.get(orgId);
  if (cached && cached.key === key) {
    // Re-validate the connection after any settings change: cached
    // transporters are verified per send so a mid-test (or mid-deploy)
    // settings change can't serve a stale connection profile above the
    // send's own timeout budget.
    return { settings, transporter: cached.transporter };
  }
  const transporter = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpPort === 465,
    auth: settings.smtpUser
      ? { user: settings.smtpUser, pass: process.env.SMTP_PASS ?? "" }
      : undefined,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
  });
  transportCache.set(orgId, { key, transporter });
  return { settings, transporter };
}

/** Drop the cached transporter — exposed for tests and settings updates. */
export function invalidateTransporterCache(orgId?: string) {
  if (orgId) transportCache.delete(orgId);
  else transportCache.clear();
}

/** Test hook: capture outbound messages instead of hitting a real SMTP server. */
export const __testHooks: {
  captureNextSend?: (info: { to: string; subject: string }) => void;
} = {};

/**
 * Render a template body with simple {{token}} merge fields. Unknown tokens
 * are removed (not leaked as raw braces), and tokens are limited to
 * whitespace-free values so callers can't inject into HTML.
 */
export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, token: string) => {
    const v = vars[token];
    return v === undefined ? "" : v;
  });
}

/**
 * Send an email and record it as a SentEmail row + EMAIL activity.
 * Returns the SentEmail record. Delivery failures throw EmailSendError;
 * the row is still persisted with status FAILED for the audit trail.
 */
export async function sendEmail(params: SendEmailParams) {
  const { user } = params;
  const subject = params.subject.trim();
  if (!subject) throw new EmailValidationError("Subject is required");
  if (!params.body.trim()) throw new EmailValidationError("Body is required");

  const sentEmail = await db.sentEmail.create({
    data: {
      organizationId: user.organizationId,
      userId: user.id,
      subject,
      body: params.body,
      recipientEmail: params.to.email.toLowerCase(),
      recipientName: params.to.name ?? "",
      contactId: params.contactId ?? null,
      leadId: params.leadId ?? null,
      dealId: params.dealId ?? null,
      templateId: params.templateId ?? null,
      status: "QUEUED",
    },
  });

  const transport = await getTransporter(user.organizationId);
  if (!transport) {
    await db.sentEmail.update({
      where: { id: sentEmail.id },
      data: {
        status: "FAILED",
        error: "SMTP is not configured. Set it up in Settings > Email.",
      },
    });
    throw new EmailConfigError("SMTP is not configured for this organization");
  }

  try {
    if (__testHooks.captureNextSend) {
      // Test capture path: no network.
      __testHooks.captureNextSend({ to: params.to.email, subject });
      __testHooks.captureNextSend = undefined;
    } else {
      const info = await transport.transporter.sendMail({
        from: transport.settings.fromAddress,
        to: params.to.name ? `${params.to.name} <${params.to.email}>` : params.to.email,
        subject,
        text: params.body,
        // HTML is intentionally not sent: bodies are plain text templates.
        // Rendering user-authored HTML would require sanitization we don't ship.
      });
      // Persist the outbound Message-ID so inbound replies can be matched
      // to this send via their In-Reply-To header (see server/inbound-mail.ts).
      await db.sentEmail.update({
        where: { id: sentEmail.id },
        data: { messageId: String(info?.messageId ?? "").slice(0, 998) },
      });
    }
    await db.sentEmail.update({
      where: { id: sentEmail.id },
      data: { status: "SENT", sentAt: new Date(), error: "" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown SMTP error";
    await db.sentEmail.update({
      where: { id: sentEmail.id },
      data: { status: "FAILED", error: message.slice(0, 500) },
    });
    throw new EmailSendError(message);
  }

  // Record EMAIL activity on the primary related record and update
  // contact.lastContactedAt so "time since last touch" stays honest.
  await db.activity.create({
    data: {
      organizationId: user.organizationId,
      type: "EMAIL",
      title: `Email sent: ${subject}`,
      description: `To ${params.to.email}`,
      contactId: params.contactId ?? null,
      companyId: null,
      dealId: params.dealId ?? null,
      leadId: params.leadId ?? null,
      taskId: null,
      userId: user.id,
    },
  });
  if (params.contactId) {
    await db.contact.update({
      where: { id: params.contactId },
      data: { lastContactedAt: new Date() },
    });
  }

  const final = await db.sentEmail.findUnique({ where: { id: sentEmail.id } });
  return final!;
}

export class EmailValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailValidationError";
  }
}

export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigError";
  }
}

export class EmailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailSendError";
  }
}
