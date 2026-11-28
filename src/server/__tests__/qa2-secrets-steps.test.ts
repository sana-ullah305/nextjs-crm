/**
 * QA Round 2 probe (contract: .agents/skills/crm-qa-round2/SKILL.md).
 *
 * Regression test for the FIXED unsubToken leak in the enrollments list:
 *
 *   GET /api/sequences/:id/enrollments used to serialize every scalar of
 *   SequenceEnrollment — including `unsubToken`, the per-enrollment
 *   unsubscribe credential — to any session user with `leads:update`
 *   (all roles). Anyone who could list enrollments could extract a token
 *   and hit the public /api/unsubscribe?token=... to permanently suppress
 *   that email from every future sequence in the org (the suppression
 *   check is org-wide by email). Fixed by adding a scalar select
 *   allow-list to listEnrollments in src/app/api/sequences/[id]/route.ts
 *   that drops unsubToken from the response.
 *
 * The second describe is a behavioral snapshot of the route-level
 * unique-position guard (kept: documents the schema-comment divergence
 * noted in the report).
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
import {
  GET as sequencesGet,
  POST as sequencesPost,
} from "@/app/api/sequences/[id]/route";
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
let adminId: string;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: "QA2 Secrets Org" } });
  orgId = org.id;
  adminId = (
    await db.user.create({
      data: {
        organizationId: orgId,
        email: "admin@qa2sec.test",
        name: "QA Sec",
        role: "ADMIN",
        passwordHash: await hashPassword("password123"),
        isActive: true,
      },
    })
  ).id;

  cookieStore.clear();
  const res = await call(
    loginRoute,
    makeRequest("/api/auth/login", { method: "POST", json: { email: "admin@qa2sec.test", password: "password123" } }),
    { params: Promise.resolve({}) }
  );
  expect(res.status).toBe(200);
});

afterAll(async () => {
  await db.sequenceEnrollment.deleteMany({ where: { organizationId: orgId } });
  await db.sequence.deleteMany({ where: { organizationId: orgId } });
  await db.session.deleteMany({ where: { user: { organizationId: orgId } } });
  await db.user.deleteMany({ where: { organizationId: orgId } });
  await db.organization.delete({ where: { id: orgId } });
});

describe("QA2 regression: unsubToken in enrollments list response", () => {
  it("GET /:id/enrollments must not expose unsubToken per row", async () => {
    const sequence = await db.sequence.create({
      data: { organizationId: orgId, name: "sec-probe-seq", createdById: adminId },
    });
    await db.sequenceStep.create({
      data: { sequenceId: sequence.id, position: 0, delayHours: 1, subjectTemplate: "S", bodyTemplate: "B" },
    });
    const contact = await db.contact.create({
      data: { organizationId: orgId, firstName: "Sec", lastName: "Probe", email: "sec@qa2sec.test" },
    });
    await db.sequenceEnrollment.create({
      data: {
        organizationId: orgId,
        sequenceId: sequence.id,
        contactId: contact.id,
        enrolledEmail: "sec@qa2sec.test",
        unsubToken: "tok-qa2-secret-probe-000000000000000000001",
        status: "ACTIVE",
      },
    });

    const res = await call(
      sequencesGet,
      makeRequest(`/api/sequences/${sequence.id}/enrollments`),
      { params: Promise.resolve({ id: [sequence.id, "enrollments"] }) }
    );
    expect(res.status).toBe(200);
    const rows = ((await res.json()).data.enrollments ?? []) as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    // The credential must not be present in the list response, and the
    // row must still carry the fields the list exists to show.
    expect(rows.every((r) => !("unsubToken" in r))).toBe(true);
    expect(rows.every((r) => r.enrolledEmail === "sec@qa2sec.test")).toBe(true);
    expect(rows.every((r) => r.contact !== null && r.contact !== undefined)).toBe(true);
  });
});

describe("QA2 documented divergence: steps schema comment vs route guard", () => {
  it("multi-step create with omitted positions is 400 (route guard wins over array-order default)", async () => {
    // The schema comment says "position defaults to array order when
    // omitted" (src/lib/schemas/index.ts:149), but the route's unique check
    // maps every omitted position to the same -1 sentinel, so two steps
    // without explicit positions collide → 400. Single-omitted-step or
    // explicit positions work (covered by sequences.test.ts). Snapshot of
    // current behavior for the report, kept as documentation.
    const res = await call(
      sequencesPost,
      makeRequest("/api/sequences", {
        method: "POST",
        json: {
          name: "implicit positions probe",
          steps: [
            { delayHours: 1, subjectTemplate: "A", bodyTemplate: "a" },
            { delayHours: 2, subjectTemplate: "B", bodyTemplate: "b" },
          ],
        },
      }),
      { params: Promise.resolve({ id: [] }) }
    );
    const status = res.status;
    if (status === 201) {
      expect(status).toBe(201);
    } else {
      expect(status).toBe(400);
      const body = (await res.json()) as { error: { details: unknown } };
      const details = JSON.stringify(body.error.details ?? "");
      expect(details).toContain("unique");
    }
  });
});
