/**
 * Integration tests for GET /api/dedupe/candidates.
 * Pattern: src/server/__tests__/dedupe-merge.test.ts (direct route-handler
 * calls against the isolated test SQLite database).
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
import { GET as candidatesGet } from "@/app/api/dedupe/candidates/route";
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

async function loginAs(email: string) {
  cookieStore.clear();
  const res = await call(
    loginRoute,
    makeRequest("/api/auth/login", { method: "POST", json: { email, password: "password123" } }),
    { params: Promise.resolve({}) }
  );
  expect(res.status).toBe(200);
}

let orgId: string;
let otherOrgId: string;
let adminId: string;

beforeAll(async () => {
  await db.session.deleteMany();
  await db.notification.deleteMany();
  await db.followUpReminder.deleteMany();
  await db.sentEmail.deleteMany();
  await db.inboundEmail.deleteMany();
  await db.activity.deleteMany();
  await db.note.deleteMany();
  await db.task.deleteMany();
  await db.auditLog.deleteMany();
  await db.deal.deleteMany();
  await db.lead.deleteMany();
  await db.stage.deleteMany();
  await db.pipeline.deleteMany();
  await db.contact.deleteMany();
  await db.tag.deleteMany();
  await db.company.deleteMany();
  await db.user.deleteMany();
  await db.leadSource.deleteMany();
  await db.emailTemplate.deleteMany();
  await db.emailSettings.deleteMany();
  await db.organization.deleteMany();

  orgId = (await db.organization.create({ data: { name: "Candidates Org" } })).id;
  otherOrgId = (await db.organization.create({ data: { name: "Other Candidates Org" } })).id;
  const passwordHash = await hashPassword("password123");
  const admin = await db.user.create({
    data: { organizationId: orgId, name: "Admin", email: "admin@cand.test", passwordHash, role: "ADMIN" },
  });
  adminId = admin.id;
  const rep = await db.user.create({
    data: { organizationId: orgId, name: "Rep", email: "rep@cand.test", passwordHash, role: "SALES_REP" },
  });
  void rep;
  await db.user.create({
    data: { organizationId: otherOrgId, name: "Other", email: "other@cand.test", passwordHash, role: "ADMIN" },
  });
}, 120_000);

afterAll(async () => {
  await db.$disconnect();
});

describe("GET /api/dedupe/candidates", () => {
  it("returns scored candidates across contacts and leads for a contact subject", async () => {
    await loginAs("admin@cand.test");
    const company = await db.company.create({ data: { organizationId: orgId, name: "Cand Co" } });
    const subject = await db.contact.create({
      data: { organizationId: orgId, companyId: company.id, firstName: "Grace", lastName: "Hopper", email: "grace@navy.mil", ownerId: adminId },
    });
    // exact email match (100) on a lead
    await db.lead.create({
      data: { organizationId: orgId, firstName: "Totally", lastName: "Different", email: "Grace@Navy.MIL" },
    });
    // company + last name (35) on a contact
    await db.contact.create({
      data: { organizationId: orgId, companyId: company.id, firstName: "Anna", lastName: "Hopper", email: "anna@navy.mil" },
    });
    // below threshold - must not appear
    await db.contact.create({
      data: { organizationId: orgId, firstName: "Marcus", lastName: "Chao", email: "marcus@x.test" },
    });

    const res = await call(
      candidatesGet,
      makeRequest(`/api/dedupe/candidates?entityType=contact&entityId=${subject.id}`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const candidates = body.data.candidates;
    expect(candidates.length).toBe(2);
    expect(body.data.total).toBe(2);
    // highest score first
    expect(candidates[0].score).toBe(100);
    expect(candidates[0].matchReasons).toContain("email_exact");
    expect(candidates[1].score).toBe(35);
    expect(candidates[1].matchReasons).toContain("company+last_name");
    // company name is surfaced for the contact candidate
    const contactCand = candidates.find((c: { type: string }) => c.type === "contact");
    expect(contactCand.company).toBe("Cand Co");
  });

  it("returns scored candidates for a lead subject", async () => {
    await loginAs("admin@cand.test");
    const subject = await db.lead.create({
      data: { organizationId: orgId, firstName: "Robert", lastName: "Frost", email: "robert@frost.test" },
    });
    await db.contact.create({
      data: { organizationId: orgId, firstName: "Bob", lastName: "Frost", email: "different@y.test" },
    });
    const res = await call(
      candidatesGet,
      makeRequest(`/api/dedupe/candidates?entityType=lead&entityId=${subject.id}`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.candidates.length).toBe(1);
    expect(body.data.candidates[0].score).toBe(45);
    expect(body.data.candidates[0].matchReasons).toContain("first+last_name");
  });

  it("honors the limit query parameter", async () => {
    await loginAs("admin@cand.test");
    const subject = await db.contact.create({
      data: { organizationId: orgId, firstName: "Limit", lastName: "Test", email: "limit@sub.test" },
    });
    for (let i = 0; i < 3; i++) {
      await db.contact.create({
        data: { organizationId: orgId, firstName: "Limit", lastName: "Test", email: `limit${i}@x.test` },
      });
    }
    const res = await call(
      candidatesGet,
      makeRequest(`/api/dedupe/candidates?entityType=contact&entityId=${subject.id}&limit=2`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.candidates.length).toBe(2);
    // total reflects the full match count, not the truncated page
    expect(body.data.total).toBe(3);
  });

  it("excludes soft-deleted, converted, and linked leads as candidates", async () => {
    await loginAs("admin@cand.test");
    const subject = await db.contact.create({
      data: { organizationId: orgId, firstName: "Excl", lastName: "Check", email: "excl@sub.test" },
    });
    await db.contact.create({
      data: { organizationId: orgId, firstName: "Excl", lastName: "Check", email: "excl@sub.test", deletedAt: new Date() },
    });
    await db.lead.create({
      data: { organizationId: orgId, firstName: "Excl", lastName: "Check", email: "excl@sub.test", status: "CONVERTED" },
    });
    await db.lead.create({
      data: { organizationId: orgId, firstName: "Excl", lastName: "Check", email: "excl@sub.test", contactId: subject.id },
    });
    const res = await call(
      candidatesGet,
      makeRequest(`/api/dedupe/candidates?entityType=contact&entityId=${subject.id}`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.candidates).toHaveLength(0);
  });

  it("never returns candidates from another organization", async () => {
    await loginAs("admin@cand.test");
    const subject = await db.contact.create({
      data: { organizationId: orgId, firstName: "Iso", lastName: "Test", email: "iso@org.test" },
    });
    await db.contact.create({
      data: { organizationId: otherOrgId, firstName: "Iso", lastName: "Test", email: "iso@org.test" },
    });
    await db.lead.create({
      data: { organizationId: otherOrgId, firstName: "Iso", lastName: "Test", email: "iso@org.test" },
    });
    const res = await call(
      candidatesGet,
      makeRequest(`/api/dedupe/candidates?entityType=contact&entityId=${subject.id}`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.candidates).toHaveLength(0);
  });

  it("returns an empty list when the subject id is unknown or from another org", async () => {
    await loginAs("admin@cand.test");
    const res = await call(
      candidatesGet,
      makeRequest(`/api/dedupe/candidates?entityType=contact&entityId=nonexistent-id`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.candidates).toHaveLength(0);
    expect(body.data.total).toBe(0);
  });

  it("is reachable by a sales rep (dedupe:read granted to every role)", async () => {
    await loginAs("rep@cand.test");
    const subject = await db.contact.create({
      data: { organizationId: orgId, firstName: "Rep", lastName: "Can", email: "repcan@sub.test" },
    });
    await db.contact.create({
      data: { organizationId: orgId, firstName: "Rep", lastName: "Can", email: "repcan@sub.test" },
    });
    const res = await call(
      candidatesGet,
      makeRequest(`/api/dedupe/candidates?entityType=contact&entityId=${subject.id}`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.candidates.length).toBe(1);
  });

  it("rejects anonymous callers with 401", async () => {
    cookieStore.clear();
    const res = await call(
      candidatesGet,
      makeRequest(`/api/dedupe/candidates?entityType=contact&entityId=whatever`)
    );
    expect(res.status).toBe(401);
  });

  it("rejects an invalid entityType with 400", async () => {
    await loginAs("admin@cand.test");
    const res = await call(
      candidatesGet,
      makeRequest(`/api/dedupe/candidates?entityType=company&entityId=whatever`)
    );
    expect(res.status).toBe(400);
  });

  it("rejects a missing entityId with 400", async () => {
    await loginAs("admin@cand.test");
    const res = await call(
      candidatesGet,
      makeRequest(`/api/dedupe/candidates?entityType=contact`)
    );
    expect(res.status).toBe(400);
  });
});
