import { apiHandler, ok } from "@/server/api";
import { requireApiUser } from "@/server/rbac";
import { db } from "@/server/db";

type Ctx = { params: Promise<{ id: string }> };

async function resolveId(ctx: Ctx): Promise<string | null> {
  const parts = (await ctx.params) as unknown as { id: string };
  const segs = parts.id;
  return segs ?? null;
}

export const GET = apiHandler(async () => {
  const user = await requireApiUser();
  const [notifications, unreadCount] = await Promise.all([
    db.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.notification.count({ where: { userId: user.id, isRead: false } }),
  ]);
  return ok({ notifications, unreadCount });
});

export const POST = apiHandler(async () => {
  const user = await requireApiUser();
  await db.notification.updateMany({
    where: { userId: user.id, isRead: false },
    data: { isRead: true },
  });
  return ok({ ok: true });
});

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const user = await requireApiUser();
  const action = new URL(req.url).searchParams.get("action");

  // Single-notification mark-read: PATCH /api/notifications/:id?action=mark-read
  const id = await resolveId(ctx);
  if (id && id !== "all" && action === "mark-read") {
    const result = await db.notification.updateMany({
      where: { id, userId: user.id },
      data: { isRead: true },
    });
    return ok({ ok: true, updated: result.count });
  }

  // No id or action=all: mark all as read.
  await db.notification.updateMany({
    where: { userId: user.id, isRead: false },
    data: { isRead: true },
  });
  return ok({ ok: true, updated: 0 });
});

export const DELETE = apiHandler<Ctx>(async (req, ctx) => {
  const user = await requireApiUser();
  const id = await resolveId(ctx);
  if (id && id !== "all") {
    await db.notification.deleteMany({ where: { id, userId: user.id } });
  } else {
    await db.notification.deleteMany({ where: { userId: user.id } });
  }
  return ok({ ok: true });
});
