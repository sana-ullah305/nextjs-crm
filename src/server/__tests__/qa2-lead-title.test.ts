/**
 * QA Round 2 probe (contract: .agents/skills/crm-qa-round2/SKILL.md).
 *
 * Regression test for the FIXED merge fieldChoices crash: the merge body
 * accepts `fieldChoices.title` (zod allow-list), and the apply loop used
 * to write every chosen key onto the survivor with the SAME keys for
 * contacts AND leads. Lead has no `title` column, so a lead-into-lead
 * merge with a title choice raised a Prisma Unknown-argument error → 500.
 * Fixed in src/app/api/merge/route.ts: `title` is dropped from the
 * survivor updates when the target is a lead (the choice is ignored
 * rather than applied; the merge itself completes normally).
 * The UI merge dialog only offers fields from the preview's CHOICE_FIELDS
 * list, and the preview diff for a lead always reports title "" — this
 * path is reachable by direct API callers (manager/admin) only.
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
import { POST as mergePost } from "@/app/api/merge/route";
import db from "@/server/db";
import { hashPassword } from "@/server/auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: any, ctx?: any) => Promise<Response>;

function call(handler: Handler, req: unknown, ctx?: unknown): Promise<Response> {
  return ctx !== undefined ? handler(req as never, ctx as never) : handler(req as never);
}

function makeRequest(pathname: string, init?: { method?: string; json?: unknown }) {
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

let orgId: string;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "QA2 Title Org" } });
  orgId = org.id;
  const adminId = (
    await db.user.create({
      data: {
        organizationId: orgId,
        email: "admin@qa2title.test",
        name: "QA Title",
        role: "ADMIN",
        passwordHash: await hashPassword("password123"),
        isActive: true,
      },
    })
  ).id;
  void adminId;

  cookieStore.clear();
  const res = await call(
    loginRoute,
    makeRequest("/api/auth/login", { method: "POST", json: { email: "admin@qa2title.test", password: "password123" } }),
    { params: Promise.resolve({}) }
  );
  expect(res.status).toBe(200);
});

afterAll(async () => {
  await db.note.deleteMany({ where: { lead: { organizationId: orgId } } });
  await db.lead.deleteMany({ where: { organizationId: orgId } });
  await db.contact.deleteMany({ where: { organizationId: orgId } });
  await db.session.deleteMany({ where: { user: { organizationId: orgId } } });
  await db.user.deleteMany({ where: { organizationId: orgId } });
  await db.organization.delete({ where: { id: orgId } });
});

describe("QA2 regression: fieldChoices.title on a lead survivor", () => {
  // Fixed: POST /api/merge used to apply every fieldChoices key with the
  // same keys for contacts AND leads (src/app/api/merge/route.ts apply
  // loop). Lead has no `title` column, so `lead-into-lead` with a title
  // choice hit Prisma "Unknown argument" → 500. The fix drops `title`
  // from the survivor updates when targetKind === "lead" — the choice is
  // ignored and the merge completes.
  it("lead-into-lead merge with a title choice succeeds; title ignored, no corruption", async () => {
    const target = await db.lead.create({
      data: { organizationId: orgId, firstName: "Keep", lastName: "Title", email: "keep-title@qa2.test" },
    });
    const source = await db.lead.create({
      data: { organizationId: orgId, firstName: "Lose", lastName: "Title", email: "lose-title@qa2.test" },
    });

    const res = await call(
      mergePost,
      makeRequest("/api/merge", {
        method: "POST",
        json: {
          type: "lead-into-lead",
          sourceId: source.id,
          targetId: target.id,
          fieldChoices: { title: "CTO" },
        },
      })
    );
    expect(res.status).toBe(200);
    const survivor = await db.lead.findUnique({ where: { id: target.id } });
    expect(survivor?.deletedAt).toBeNull();
    const loser = await db.lead.findUnique({ where: { id: source.id } });
    expect(loser?.deletedAt).not.toBeNull();
  });
});
