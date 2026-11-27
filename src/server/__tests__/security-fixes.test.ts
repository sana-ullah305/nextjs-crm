import { execSync } from "node:child_process";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";

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
import { GET as contactsGet, PATCH as contactsPatch } from "@/app/api/contacts/[[...id]]/route";
import { GET as leadsGet, POST as leadsPost } from "@/app/api/leads/[[...id]]/route";
import { GET as dealsGet, GET as dealsGetSingle } from "@/app/api/deals/[[...id]]/route";
import { GET as companiesGet, PATCH as companiesPatch } from "@/app/api/companies/[[...id]]/route";
import { GET as mergePreviewGet } from "@/app/api/merge/preview/route";
import { PATCH as usersPatch } from "@/app/api/users/[[...id]]/route";
import { POST as sequencesPost } from "@/app/api/sequences/[[...id]]/route";
import { GET as unsubscribeGet } from "@/app/api/unsubscribe/route";
import db from "@/server/db";
import { hashPassword } from "@/server/auth";
import { GET as meGet } from "@/app/api/auth/me/route";

type Handler = (req: any, ctx?: any) => Promise<Response>;
function call(handler: Handler, req: unknown, ctx?: unknown): Promise<Response> {
  return ctx !== undefined ? handler(req as never, ctx as never) : handler(req as never);
}
function makeRequest(pathname: string, init?: { method?: string; headers?: Record<string, string>; json?: unknown }) {
  const url = new URL(`http://localhost:3000${pathname}`);
  return {
    url: url.toString(),
    method: init?.method ?? "GET",
    headers: new Headers(init?.headers),
    json: async () => (init?.json !== undefined ? init.json : {}),
    cookies: {
      get: (name: string) => cookieStore.get(name),
      set: (name: string, value: string) => cookieStore.set(name, { name, value }),
      delete: (name: string) => cookieStore.delete(name),
    },
    nextUrl: url,
  };
}
function ctx(segments: string[] | undefined) {
  return { params: Promise.resolve({ id: segments }) };
}

let orgId: string;
let adminId: string;
let repAId: string;
let repBId: string;
let repCId: string;
let contactAId: string;
let contactBId: string;
let leadBId: string;
let dealBId: string;
let companyBId: string;

beforeAll(async () => {
  await db.session.deleteMany();
  await db.notification.deleteMany();
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
  await db.organization.deleteMany();

  orgId = (await db.organization.create({ data: { name: "Test Org" } })).id;
  const passwordHash = await hashPassword("password123");
  const admin = await db.user.create({ data: { organizationId: orgId, name: "Admin", email: "admin@example.org", passwordHash, role: "ADMIN" } });
  const repA = await db.user.create({ data: { organizationId: orgId, name: "RepA", email: "repa@example.org", passwordHash, role: "SALES_REP" } });
  const repB = await db.user.create({ data: { organizationId: orgId, name: "RepB", email: "repb@example.org", passwordHash, role: "SALES_REP" } });
  const repC = await db.user.create({ data: { organizationId: orgId, name: "RepC", email: "repc@example.org", passwordHash, role: "SALES_REP" } });
  adminId = admin.id;
  repAId = repA.id;
  repBId = repB.id;
  repCId = repC.id;

  const cA = await db.contact.create({ data: { organizationId: orgId, firstName: "Alice", lastName: "A", email: "alice@example.org", ownerId: repAId } });
  const cB = await db.contact.create({ data: { organizationId: orgId, firstName: "Bob", lastName: "B", email: "bob@example.org", ownerId: repBId } });
  contactAId = cA.id;
  contactBId = cB.id;

  const leadB = await db.lead.create({ data: { organizationId: orgId, firstName: "LeadB", lastName: "X", email: "leadb@example.org", ownerId: repBId, assignedUserId: repBId } });
  leadBId = leadB.id;

  const pipeline = await db.pipeline.create({ data: { organizationId: orgId, name: "P", isDefault: true } });
  const stage = await db.stage.create({ data: { pipelineId: pipeline.id, name: "S1", position: 0, probability: 10, type: "OPEN" } });
  const dealB = await db.deal.create({ data: { organizationId: orgId, name: "DealB", ownerId: repBId, stageId: stage.id, pipelineId: pipeline.id } });
  dealBId = dealB.id;

  const companyB = await db.company.create({ data: { organizationId: orgId, name: "CompanyB", ownerId: repBId } });
  companyBId = companyB.id;
}, 120_000);

afterAll(async () => { await db.$disconnect(); });

async function loginAs(email: string) {
  cookieStore.clear();
  const res = await call(loginRoute, makeRequest("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    json: { email, password: "password123" },
  }), { params: Promise.resolve({}) });
  expect(res.status).toBe(200);
}

describe("password change revokes all sessions", () => {
  it("invalidates existing sessions after a password change", async () => {
    await loginAs("repc@example.org");
    // confirm session works
    const me1 = await call(meGet, makeRequest("/api/auth/me") as never);
    expect(me1.status).toBe(200);

    // admin changes repC's password
    await loginAs("admin@example.org");
    const patch = await call(usersPatch, makeRequest(`/api/users/${repCId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      json: { password: "newpassword123" },
    }) as never, ctx([repCId]));
    expect(patch.status).toBe(200);

    // repA's old session cookie should no longer resolve to a user
    cookieStore.clear();
    // restore repA's token manually isn't possible (cookie wiped by loginAs) — instead verify no session rows remain
    const remaining = await db.session.count({ where: { userId: repCId } });
    expect(remaining).toBe(0);
  });
});

describe("RBAC filter-override (search cannot bypass visibility)", () => {
  it("rep searching by another rep's contact name sees nothing", async () => {
    await loginAs("repa@example.org");
    const res = await call(contactsGet, makeRequest("/api/contacts?q=Bob") as never, ctx(undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.total).toBe(0);
  });
});

describe("record-level read scoping", () => {
  it("rep cannot read another rep's contact/lead/deal/company (403)", async () => {
    await loginAs("repa@example.org");
    const c = await call(contactsGet, makeRequest(`/api/contacts/${contactBId}`) as never, ctx([contactBId]));
    expect(c.status).toBe(403);
    const l = await call(leadsGet, makeRequest(`/api/leads/${leadBId}`) as never, ctx([leadBId]));
    expect(l.status).toBe(403);
    const d = await call(dealsGetSingle, makeRequest(`/api/deals/${dealBId}`) as never, ctx([dealBId]));
    expect(d.status).toBe(403);
    const co = await call(companiesGet, makeRequest(`/api/companies/${companyBId}`) as never, ctx([companyBId]));
    expect(co.status).toBe(403);
  });

  it("rep cannot merge-preview another rep's records (403)", async () => {
    await loginAs("repa@example.org");
    const res = await call(mergePreviewGet, makeRequest(`/api/merge/preview?type=contact&id=${contactAId}&intoId=${contactBId}`) as never);
    expect(res.status).toBe(403);
  });
});

describe("owner/assignee reassignment validation", () => {
  it("rep cannot reassign contact to another user (403)", async () => {
    await loginAs("repa@example.org");
    const res = await call(contactsPatch, makeRequest(`/api/contacts/${contactAId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      json: { ownerId: repBId },
    }) as never, ctx([contactAId]));
    expect(res.status).toBe(403);
  });

  it("rep cannot reassign lead to another user (403)", async () => {
    await loginAs("repa@example.org");
    // create a lead owned by repA
    const res = await call(leadsPost, makeRequest("/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      json: { firstName: "L", lastName: "A", email: "la@example.org", assignedUserId: repAId },
    }) as never, ctx(undefined));
    expect(res.status).toBe(201);
    const leadId = (await res.json()).data.id;
    const patch = await call((await import("@/app/api/leads/[[...id]]/route")).PATCH, makeRequest(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      json: { assignedUserId: repBId },
    }) as never, ctx([leadId]));
    expect(patch.status).toBe(403);
  });

  it("manager can reassign contact to another user (200)", async () => {
    await loginAs("admin@example.org");
    const res = await call(contactsPatch, makeRequest(`/api/contacts/${contactAId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      json: { ownerId: repBId },
    }) as never, ctx([contactAId]));
    expect(res.status).toBe(200);
  });
});

describe("transactions", () => {
  it("lead conversion creates contact+deal+flips lead atomically; bad pipeline rolls back", async () => {
    // create a lead as admin
    await loginAs("admin@example.org");
    const created = await call(leadsPost, makeRequest("/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      json: { firstName: "Conv", lastName: "Lead", email: "conv@example.org" },
    }) as never, ctx(undefined));
    expect(created.status).toBe(201);
    const leadId = (await created.json()).data.id;

    // invalid pipelineId -> 404, and no contact created for this lead
    const bad = await call((await import("@/app/api/leads/[[...id]]/route")).POST, makeRequest(`/api/leads/${leadId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      json: { createDeal: true, pipelineId: "does-not-exist" },
    }) as never, ctx([leadId]));
    expect(bad.status).toBe(404);
    const lead = await db.lead.findUnique({ where: { id: leadId } });
    expect(lead?.status).toBe("NEW");
    const contacts = await db.contact.count({ where: { organizationId: orgId, email: "conv@example.org" } });
    expect(contacts).toBe(0);
  });

  it("sequence create wraps sequence+steps in a transaction (spy)", async () => {
    const spy = vi.spyOn(db, "$transaction");
    await loginAs("admin@example.org");
    const res = await call(sequencesPost, makeRequest("/api/sequences", {
      method: "POST",
      headers: { "content-type": "application/json" },
      json: {
        name: "Seq1",
        steps: [
          { position: 0, subjectTemplate: "s", bodyTemplate: "b", delayHours: 1 },
          { position: 1, subjectTemplate: "s2", bodyTemplate: "b2", delayHours: 2 },
        ],
      },
    }) as never, ctx(undefined));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.steps.length).toBe(2);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("unsubscribe (public page + API)", () => {
  it("returns 404 for unknown token and 400 for missing token", async () => {
    const missing = await call(unsubscribeGet, makeRequest("/api/unsubscribe") as never);
    expect(missing.status).toBe(400);
    const unknown = await call(unsubscribeGet, makeRequest("/api/unsubscribe?token=nope") as never);
    expect(unknown.status).toBe(404);
  });
});
