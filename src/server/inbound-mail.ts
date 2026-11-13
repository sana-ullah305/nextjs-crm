import { ImapFlow, type FetchMessageObject, type SearchObject } from "imapflow";
import { db } from "@/server/db";

/**
 * Inbound email reply tracking.
 *
 * Scans a shared IMAP inbox (IMAP_* env vars) for UNSEEN messages newer than
 * the newest stored `receivedAt` watermark and logs replies that belong to
 * the CRM:
 *
 *  1. Thread match (exact route): In-Reply-To points at a SentEmail row
 *     (matched via SentEmail.messageId). The reply is attributed to that
 *     send and its linked contact/lead.
 *  2. Fallback: sender matches the most recent open lead by email, else the
 *     most recent contact by email.
 *
 * Senders matching no lead AND no contact AND no thread are left unseen and
 * unlogged — unrelated mail is never stored.
 *
 * On a match the service stores an InboundEmail row (idempotent per
 * [organizationId, messageId]), logs an EMAIL activity, notifies the
 * owner/assignee, and moves a NEW lead to CONTACTED. Matched messages are
 * marked \Seen so the next scan skips them.
 *
 * `runInboundScan(now?)` is triggered by POST /api/inbound/run (cron /
 * scheduler friendly) and returns { stored, skipped, scannedAt } plus
 * `configured: false` instead of throwing when IMAP env vars are unset.
 */

export const INBOUND_STATUS = {
  UNREAD: "UNREAD",
  READ: "READ",
  IGNORED: "IGNORED",
} as const;

const OPEN_LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED"];
const MAX_BODY_BYTES = 100_000;
const SCAN_BATCH_LIMIT = 200;

export type InboundScanResult = {
  stored: number;
  skipped: number;
  scannedAt: string;
  configured?: boolean;
};

/** Parsed-message shape used by the scan and the test hook. */
export type ParsedInboundMessage = {
  messageId?: string;
  inReplyTo?: string;
  subject?: string;
  body?: string;
  receivedAt?: Date | string;
  fromEmail?: string;
  fromName?: string;
};

function imapConfig(): { host: string; port: number; user: string; pass: string; tls: boolean } | null {
  const host = process.env.IMAP_HOST?.trim();
  const user = process.env.IMAP_USER?.trim();
  const pass = process.env.IMAP_PASS;
  if (!host || !user || !pass) return null;
  return {
    host,
    port: Number(process.env.IMAP_PORT) || 993,
    user,
    pass,
    tls: (process.env.IMAP_TLS ?? "true").toLowerCase() !== "false",
  };
}

export function isInboundConfigured(): boolean {
  return imapConfig() !== null;
}

function dateOr(value: Date | string | undefined, fallback: Date): Date {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? fallback : value;
  if (typeof value === "string" && value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fallback;
}

/**
 * Turn an ImapFlow fetch response into the parsed-message shape the
 * processing logic consumes. Reads the first text/plain part through
 * downloadMany for the body; HTML-only mail is stored with an empty body
 * rather than pulling a parser dependency.
 */
async function toParsedMessage(
  client: ImapFlow,
  msg: FetchMessageObject
): Promise<ParsedInboundMessage | null> {
  const env = msg.envelope;
  if (!env) return null;
  let body = "";
  try {
    const textPart = findTextPart(msg.bodyStructure);
    if (textPart) {
      const downloaded = await client.downloadMany(String(msg.uid), [textPart], { uid: true });
      const content = downloaded?.[textPart]?.content;
      if (content) body = content.toString("utf8").slice(0, MAX_BODY_BYTES);
    }
  } catch {
    // Body extraction is best-effort; headers alone still identify a reply.
  }
  return {
    messageId: env.messageId?.trim() || "",
    inReplyTo: env.inReplyTo?.trim() || "",
    subject: env.subject ?? "",
    body,
    receivedAt: dateOr(msg.internalDate, new Date()),
    fromEmail: env.from?.[0]?.address?.toLowerCase() ?? "",
    fromName: env.from?.[0]?.name ?? "",
  };
}

type BodyStructureLike = {
  part?: string;
  type?: string;
  childNodes?: BodyStructureLike[];
};

function findTextPart(node: BodyStructureLike | undefined): string | null {
  if (!node) return null;
  const type = (node.type ?? "").toLowerCase();
  if (type === "text/plain" && node.part) return node.part;
  if (type.startsWith("multipart/") && node.childNodes?.length) {
    for (const child of node.childNodes) {
      const found = findTextPart(child);
      if (found) return found;
    }
  }
  return null;
}

type MatchedContext = {
  organizationId: string;
  sentEmailId: string | null;
  lead: {
    id: string;
    status: string;
    assignedUserId: string | null;
    ownerId: string | null;
    firstName: string;
    lastName: string;
  } | null;
  contact: {
    id: string;
    ownerId: string | null;
    firstName: string;
    lastName: string;
  } | null;
  userId: string | null;
};

/** Exact route: In-Reply-To points at an outbound SentEmail row. */
async function matchByThread(inReplyTo: string): Promise<MatchedContext | null> {
  if (!inReplyTo) return null;
  const sent = await db.sentEmail.findFirst({
    where: { messageId: inReplyTo },
    select: {
      id: true,
      organizationId: true,
      contactId: true,
      leadId: true,
      lead: {
        select: { id: true, status: true, assignedUserId: true, ownerId: true, firstName: true, lastName: true },
      },
      contact: {
        select: { id: true, ownerId: true, firstName: true, lastName: true },
      },
    },
  });
  if (!sent) return null;
  const userId = await resolveSystemUserId(
    sent.organizationId,
    sent.lead ? sent.lead.assignedUserId ?? sent.lead.ownerId : sent.contact?.ownerId ?? null
  );
  return { organizationId: sent.organizationId, sentEmailId: sent.id, lead: sent.lead, contact: sent.contact, userId };
}

/** Fallback: sender matches the most recent open lead by email (org-scoped per org). */
async function matchByLead(fromEmail: string): Promise<MatchedContext | null> {
  const lead = await db.lead.findFirst({
    where: {
      email: fromEmail,
      deletedAt: null,
      status: { in: OPEN_LEAD_STATUSES },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      organizationId: true,
      status: true,
      assignedUserId: true,
      ownerId: true,
      firstName: true,
      lastName: true,
    },
  });
  if (!lead) return null;
  const userId = await resolveSystemUserId(lead.organizationId, lead.assignedUserId ?? lead.ownerId);
  return {
    organizationId: lead.organizationId,
    sentEmailId: null,
    lead: { id: lead.id, status: lead.status, assignedUserId: lead.assignedUserId, ownerId: lead.ownerId, firstName: lead.firstName, lastName: lead.lastName },
    contact: null,
    userId,
  };
}

/** Fallback: sender matches the most recent contact by email. */
async function matchByContact(fromEmail: string): Promise<MatchedContext | null> {
  const contact = await db.contact.findFirst({
    where: { email: fromEmail, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, organizationId: true, ownerId: true, firstName: true, lastName: true },
  });
  if (!contact) return null;
  const userId = await resolveSystemUserId(contact.organizationId, contact.ownerId);
  return {
    organizationId: contact.organizationId,
    sentEmailId: null,
    lead: null,
    contact: { id: contact.id, ownerId: contact.ownerId, firstName: contact.firstName, lastName: contact.lastName },
    userId,
  };
}

/**
 * Resolve the "system" user for the auto-logged activity/notification: the
 * matched record's owner/assignee, else the org's first admin. Returns null
 * only when the org has no active users at all.
 */
async function resolveSystemUserId(
  organizationId: string,
  ownerId: string | null
): Promise<string | null> {
  if (ownerId) return ownerId;
  const admin = await db.user.findFirst({
    where: { organizationId, role: "ADMIN", isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (admin) return admin.id;
  const anyUser = await db.user.findFirst({
    where: { organizationId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return anyUser?.id ?? null;
}

/**
 * Core matching/storage/side-effect logic for one parsed message. Shared by
 * the IMAP scan and tests via __testProcessMessage. Returns "stored",
 * "skipped" (duplicate Message-ID) or "unmatched" (nothing stored).
 */
export async function processInboundMessage(
  parsed: ParsedInboundMessage,
  now: Date = new Date()
): Promise<"stored" | "skipped" | "unmatched"> {
  const messageId = parsed.messageId?.trim() ?? "";
  if (!messageId) return "unmatched";
  const fromEmail = parsed.fromEmail?.toLowerCase().trim() ?? "";
  const inReplyTo = parsed.inReplyTo?.trim() ?? "";

  // Exact thread route first...
  let match: MatchedContext | null = await matchByThread(inReplyTo);

  // ...then the sender fallbacks.
  if (!match && fromEmail) match = await matchByLead(fromEmail);
  if (!match && fromEmail) match = await matchByContact(fromEmail);
  if (!match) return "unmatched";

  // Idempotent: one row per [org, Message-ID]. The unique constraint races
  // only under concurrent scans, which the run permission makes impossible.
  const duplicate = await db.inboundEmail.findFirst({
    where: { organizationId: match.organizationId, messageId },
    select: { id: true },
  });
  if (duplicate) return "skipped";

  const stored = await db.inboundEmail.create({
    data: {
      organizationId: match.organizationId,
      fromEmail: fromEmail || "",
      fromName: parsed.fromName ?? "",
      subject: parsed.subject ?? "",
      body: parsed.body ?? "",
      messageId,
      inReplyTo,
      sentEmailId: match.sentEmailId,
      contactId: match.contact?.id ?? null,
      leadId: match.lead?.id ?? null,
      status: INBOUND_STATUS.UNREAD,
      receivedAt: dateOr(parsed.receivedAt, now),
    },
  });

  // There is no user to attribute the automatic logging to, so it lands on
  // the matched record's owner (or the org's first admin).
  const userId = match.userId ?? (await resolveSystemUserId(match.organizationId, null));
  if (!userId) return "stored";

  const subject = parsed.subject ?? "";
  await db.activity.create({
    data: {
      organizationId: match.organizationId,
      type: "EMAIL",
      title: `Email received: ${subject}`,
      description: `From ${fromEmail || "unknown sender"}`,
      contactId: match.contact?.id ?? null,
      companyId: null,
      dealId: null,
      leadId: match.lead?.id ?? null,
      taskId: null,
      userId,
    },
  });

  const link = match.lead
    ? `/leads/${match.lead.id}`
    : match.contact
      ? `/contacts/${match.contact.id}`
      : "/emails";
  await db.notification.create({
    data: {
      organizationId: match.organizationId,
      userId,
      title: `Email received: ${subject}`,
      body: `${fromEmail || "An unknown sender"} replied.`,
      type: "INFO",
      link,
    },
  });

  if (match.lead && match.lead.status === "NEW") {
    await db.lead.update({
      where: { id: match.lead.id },
      data: { status: "CONTACTED" },
    });
  }

  void stored;
  return "stored";
}

/** Test hook: run the matching/storage/side-effect path on a parsed message. */
export async function __testProcessMessage(
  parsed: ParsedInboundMessage,
  now: Date = new Date()
): Promise<"stored" | "skipped" | "unmatched"> {
  return processInboundMessage(parsed, now);
}

/**
 * Scan the configured IMAP inbox for unseen replies and process them.
 * Returns { stored: 0, skipped: 0, configured: false } when the IMAP env
 * vars are unset, rather than throwing.
 */
export async function runInboundScan(now: Date = new Date()): Promise<InboundScanResult> {
  const config = imapConfig();
  if (!config) {
    return { stored: 0, skipped: 0, scannedAt: now.toISOString(), configured: false };
  }

  const newest = await db.inboundEmail.findFirst({
    orderBy: { receivedAt: "desc" },
    select: { receivedAt: true },
  });
  const watermark = newest?.receivedAt ?? new Date(0);

  const searchQuery: SearchObject = { seen: false, since: watermark };
  let stored = 0;
  let skipped = 0;

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.tls,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search(searchQuery, { uid: true });
      for (const uid of (Array.isArray(uids) ? uids : []).slice(-SCAN_BATCH_LIMIT)) {
        const msg = await client.fetchOne(String(uid), { uid: true, envelope: true, internalDate: true, bodyStructure: true, size: true }, { uid: true });
        if (!msg) continue;
        const receivedAt = dateOr(msg.internalDate, now);
        if (receivedAt <= watermark) continue;
        const parsed = await toParsedMessage(client, msg);
        if (!parsed) continue;
        const outcome = await processInboundMessage(parsed, now);
        if (outcome === "unmatched") {
          // Unrelated mail is left unlogged; count it so callers see the scan worked.
          skipped++;
          continue;
        }
        skipped += outcome === "skipped" ? 1 : 0;
        stored += outcome === "stored" ? 1 : 0;
        // Stored and already-known messages are marked seen: they are either
        // logged or previously handled, so the next scan skips them.
        await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }).catch(() => undefined);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }

  return { stored, skipped, scannedAt: now.toISOString() };
}
