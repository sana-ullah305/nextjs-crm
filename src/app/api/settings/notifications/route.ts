import { z } from "zod";
import { apiHandler, ok, parseBody, clientIp } from "@/server/api";
import { requireApiUser } from "@/server/rbac";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

const PREF_KEYS = [
  "taskReminders",
  "leadFollowUps",
  "emailReplies",
  "dealUpdates",
  "mentions",
  "systemAnnouncements",
] as const;

const preferencesSchema = z
  .object({
    taskReminders: z.boolean().optional(),
    leadFollowUps: z.boolean().optional(),
    emailReplies: z.boolean().optional(),
    dealUpdates: z.boolean().optional(),
    mentions: z.boolean().optional(),
    systemAnnouncements: z.boolean().optional(),
  })
  .strict();

const updateSchema = z
  .object({
    emailNotifications: z.boolean().optional(),
    inAppNotifications: z.boolean().optional(),
    preferences: preferencesSchema.optional(),
  })
  .strict();

function normalizePreferences(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const key of PREF_KEYS) {
      const value = (raw as Record<string, unknown>)[key];
      if (typeof value === "boolean") out[key] = value;
    }
  }
  return out;
}

function selectUser(id: string) {
  return db.user.findUnique({
    where: { id },
    select: {
      id: true,
      emailNotifications: true,
      inAppNotifications: true,
      notificationPreferences: true,
    },
  });
}

export const GET = apiHandler(async () => {
  const user = await requireApiUser();
  const record = await selectUser(user.id);
  return ok({
    emailNotifications: record?.emailNotifications ?? true,
    inAppNotifications: record?.inAppNotifications ?? true,
    preferences: normalizePreferences(record?.notificationPreferences),
  });
});

export const PATCH = apiHandler(async (req) => {
  const user = await requireApiUser();
  const body = await parseBody(req, updateSchema);

  const data: {
    emailNotifications?: boolean;
    inAppNotifications?: boolean;
    notificationPreferences?: Record<string, boolean>;
  } = {};

  if (body.emailNotifications !== undefined) data.emailNotifications = body.emailNotifications;
  if (body.inAppNotifications !== undefined) data.inAppNotifications = body.inAppNotifications;

  if (body.preferences !== undefined) {
    const current = await db.user.findUnique({
      where: { id: user.id },
      select: { notificationPreferences: true },
    });
    const merged = {
      ...normalizePreferences(current?.notificationPreferences),
      ...body.preferences,
    };
    data.notificationPreferences = merged;
  }

  if (Object.keys(data).length > 0) {
    await db.user.update({ where: { id: user.id }, data });
    await writeAudit({
      organizationId: user.organizationId,
      userId: user.id,
      action: "NOTIFICATION_PREFS_UPDATE",
      entityType: "user",
      entityId: user.id,
      ipAddress: clientIp(req),
    });
  }

  const record = await selectUser(user.id);
  return ok({
    emailNotifications: record?.emailNotifications ?? true,
    inAppNotifications: record?.inAppNotifications ?? true,
    preferences: normalizePreferences(record?.notificationPreferences),
  });
});
