/**
 * Tests for notification preferences (GET/PATCH) and single-notification
 * mark-one-read (PATCH /api/notifications/:id?action=mark-read).
 *
 * Same direct route-handler pattern as features.test.ts / api-integration.test.ts:
 * real Prisma against the isolated test DB, next/headers cookies swapped for an
 * in-memory store, no HTTP server.
 */
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

const cookieStore = new Map<string, { name: string; value: string }>();

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (_name: string) => null }),
  cookies: async () => ({
    get: (name: string) => cookieStore.get(name),
    set: (name: string, value: string) => cookieStore.set(name, { name, value }),
    delete: (name: string) => cookieStore.delete(name),
  }),
}));

import { POST as loginRoute } from "@/app/api/auth/login/route";
import { GET as prefsGet, PATCH as prefsPatch } from "@/app/api/settings/notifications/route";
import {
  GET as notificationsGet,
  PATCH as notificationsPatch,
} from "@/app/api/notifications/[id]/route";
import db from "@/server/db";
import { hashPassword } from "@/server/auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: any, ctx?: any) => Promise<Response>;

function call(handler: Handler, req: unknown, ctx?: unknown): Promise<Response> {
  return ctx !== undefined ? handler(req as never, ctx as never) : handler(req as never);
}

function makeRequest(
  pathname: string,
  init?: { method?: string; json?: unknown }
) {
  const url = new URL(`http://localhost:3000${pathname}`);
  return {
    url: url.toString(),
    method: init?.method ?? "GET",
    headers: new Headers(init?.json !== undefined ? { "content-type": "application/json" } : {}),
    json: async () => (init?.json !== undefined ? init.json : {}),
    cookies: {
      get: (name: string) => cookieStore.get(name),
      set: (name: string, value: string) => cookieStore.set(name, { name, value }),
      delete: (name: string) => cookieStore.delete(name),
    },
    nextUrl: url,
  };
}

function ctx(segments: string | undefined) {
  return { params: Promise.resolve({ id: segments as string }) };
}

let orgId: string;
let userId: string;

async function loginAs(email: string) {
  cookieStore.clear();
  const res = await call(
    loginRoute,
    makeRequest("/api/auth/login", { method: "POST", json: { email, password: "password123" } }),
    { params: Promise.resolve({}) }
  );
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  await db.session.deleteMany();
  await db.notification.deleteMany();
  await db.auditLog.deleteMany();
  await db.user.deleteMany();
  await db.organization.deleteMany();

  orgId = (await db.organization.create({ data: { name: "Notif Prefs Org" } })).id;
  const passwordHash = await hashPassword("password123");
  const user = await db.user.create({
    data: {
      organizationId: orgId,
      name: "Notif User",
      email: "notif@prefs.test",
      passwordHash,
      role: "ADMIN",
    },
  });
  userId = user.id;
}, 120_000);

afterAll(async () => {
  await db.$disconnect();
});

describe("notification preferences GET/PATCH", () => {
  it("returns defaults (both channels on, empty preferences) for a fresh user", async () => {
    await loginAs("notif@prefs.test");
    const res = await call(prefsGet, makeRequest("/api/settings/notifications"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.emailNotifications).toBe(true);
    expect(body.data.inAppNotifications).toBe(true);
    expect(body.data.preferences).toEqual({});
  });

  it("PATCH updates channel flags and per-type preferences (merged)", async () => {
    await loginAs("notif@prefs.test");
    const res = await call(
      prefsPatch,
      makeRequest("/api/settings/notifications", {
        method: "PATCH",
        json: {
          emailNotifications: false,
          preferences: { taskReminders: false, emailReplies: false },
        },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.emailNotifications).toBe(false);
    expect(body.data.preferences.taskReminders).toBe(false);
    expect(body.data.preferences.emailReplies).toBe(false);

    // Persisted to the DB.
    const row = await db.user.findUnique({ where: { id: userId } });
    expect(row?.emailNotifications).toBe(false);
    expect(row?.notificationPreferences).toMatchObject({
      taskReminders: false,
      emailReplies: false,
    });

    // A second PATCH merges rather than replaces: leadFollowUps added,
    // taskReminders stays false.
    const res2 = await call(
      prefsPatch,
      makeRequest("/api/settings/notifications", {
        method: "PATCH",
        json: { preferences: { leadFollowUps: false } },
      })
    );
    const body2 = await res2.json();
    expect(body2.data.preferences.taskReminders).toBe(false);
    expect(body2.data.preferences.leadFollowUps).toBe(false);
  });

  it("rejects unknown preference keys (strict validation)", async () => {
    await loginAs("notif@prefs.test");
    const res = await call(
      prefsPatch,
      makeRequest("/api/settings/notifications", {
        method: "PATCH",
        json: { preferences: { bogusKey: true } },
      })
    );
    expect(res.status).toBe(400);
  });

  it("writes an audit entry on update", async () => {
    await loginAs("notif@prefs.test");
    await db.auditLog.deleteMany({ where: { action: "NOTIFICATION_PREFS_UPDATE" } });
    await call(
      prefsPatch,
      makeRequest("/api/settings/notifications", {
        method: "PATCH",
        json: { inAppNotifications: false },
      })
    );
    const audit = await db.auditLog.findFirst({
      where: { organizationId: orgId, action: "NOTIFICATION_PREFS_UPDATE" },
    });
    expect(audit).not.toBeNull();
  });
});

describe("mark one notification read", () => {
  it("marks a single notification read and leaves others unread", async () => {
    await loginAs("notif@prefs.test");
    await db.notification.deleteMany({ where: { userId } });
    const a = await db.notification.create({
      data: { organizationId: orgId, userId, title: "First", body: "", type: "TASK", link: "/tasks" },
    });
    const b = await db.notification.create({
      data: { organizationId: orgId, userId, title: "Second", body: "", type: "TASK", link: "/tasks" },
    });

    const res = await call(
      notificationsPatch,
      makeRequest(`/api/notifications/${a.id}?action=mark-read`, { method: "PATCH" }),
      ctx(a.id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ok).toBe(true);
    expect(body.data.updated).toBe(1);

    const [ra, rb] = await Promise.all([
      db.notification.findUnique({ where: { id: a.id } }),
      db.notification.findUnique({ where: { id: b.id } }),
    ]);
    expect(ra?.isRead).toBe(true);
    expect(rb?.isRead).toBe(false);

    // Unread count reflects one remaining.
    const list = await call(notificationsGet, makeRequest("/api/notifications"));
    const listBody = await list.json();
    expect(listBody.data.unreadCount).toBe(1);
  });

  it("does not mark another user's notification read", async () => {
    await loginAs("notif@prefs.test");
    const other = await db.user.create({
      data: {
        organizationId: orgId,
        name: "Other",
        email: "other@prefs.test",
        passwordHash: await hashPassword("password123"),
        role: "SALES_REP",
      },
    });
    const foreign = await db.notification.create({
      data: { organizationId: orgId, userId: other.id, title: "Foreign", body: "", type: "TASK", link: "/tasks" },
    });

    const res = await call(
      notificationsPatch,
      makeRequest(`/api/notifications/${foreign.id}?action=mark-read`, { method: "PATCH" }),
      ctx(foreign.id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.updated).toBe(0);

    const still = await db.notification.findUnique({ where: { id: foreign.id } });
    expect(still?.isRead).toBe(false);
  });
});
