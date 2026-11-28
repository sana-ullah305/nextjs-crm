import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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
import { POST as leadsPost } from "@/app/api/leads/[id]/route";
import { POST as contactsPost } from "@/app/api/contacts/[id]/route";
import { POST as sequencesPost } from "@/app/api/sequences/[id]/route";
import { PATCH as settingsPatch } from "@/app/api/settings/[[...section]]/route";
import db from "@/server/db";
import { hashPassword } from "@/server/auth";

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
function leadCtx(id: string) { return { params: Promise.resolve({ id: [id] }) }; }
function settingsCtx(segments?: string[] | undefined) { return { params: Promise.resolve({ section: segments }) }; }
function seqCtx() { return { params: Promise.resolve({ id: "" as string }) }; }

async function loginAs(email: string) {
  cookieStore.clear();
  const res = await call(loginRoute, makeRequest("/api/auth/login", { method: "POST", json: { email, password: "password123" } }), { params: Promise.resolve({}) });
  expect(res.status).toBe(200);
}

let orgId: string;
let adminId: string;
let pipelineId: string;
let stageId: string;
let leadId: string;

beforeAll(async () => {
  await db.session.deleteMany();
  await db.auditLog.deleteMany();
  await db.activity.deleteMany();
  await db.deal.deleteMany();
  await db.lead.deleteMany();
  await db.stage.deleteMany();
  await db.pipeline.deleteMany();
  await db.contact.deleteMany();
  await db.company.deleteMany();
  await db.sequenceStep.deleteMany();
  await db.sequence.deleteMany();
  await db.user.deleteMany();
  await db.organization.deleteMany();

  const passwordHash = await hashPassword("password123");
  orgId = (await db.organization.create({ data: { name: "Tx Org" } })).id;
  const admin = await db.user.create({ data: { organizationId: orgId, name: "Admin", email: "admin@tx.test", passwordHash, role: "ADMIN" } });
  adminId = admin.id;

  const pipeline = await db.pipeline.create({ data: { organizationId: orgId, name: "Default", isDefault: true } });
  pipelineId = pipeline.id;
  const stage = await db.stage.create({ data: { pipelineId, name: "New", position: 0, probability: 10, type: "OPEN" } });
  stageId = stage.id;

  const lead = await db.lead.create({ data: { organizationId: orgId, firstName: "Ada", lastName: "Lovelace", email: "ada@tx.test", status: "NEW", assignedUserId: adminId } });
  leadId = lead.id;
});

afterAll(async () => {
  await db.session.deleteMany();
  await db.auditLog.deleteMany();
  await db.activity.deleteMany();
  await db.deal.deleteMany();
  await db.lead.deleteMany();
  await db.stage.deleteMany();
  await db.pipeline.deleteMany();
  await db.contact.deleteMany();
  await db.company.deleteMany();
  await db.sequenceStep.deleteMany();
  await db.sequence.deleteMany();
  await db.user.deleteMany();
  await db.organization.deleteMany();
});

describe("transactional flows", () => {
  it("converts a lead atomically (contact + deal + lead update)", async () => {
    await loginAs("admin@tx.test");
    const res = await call(leadsPost, makeRequest(`/api/leads/${leadId}`, { method: "POST", json: { createDeal: true } }), leadCtx(leadId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.contact).toBeTruthy();
    expect(body.data.deal).toBeTruthy();
    const lead = await db.lead.findUnique({ where: { id: leadId } });
    expect(lead?.status).toBe("CONVERTED");
  });

  it("rolls back lead conversion when no pipeline exists", async () => {
    await loginAs("admin@tx.test");
    // create a second lead
    const lead2 = await db.lead.create({ data: { organizationId: orgId, firstName: "Grace", lastName: "Hopper", email: "grace@tx.test", status: "NEW", assignedUserId: adminId } });
    // remove all pipelines
    await db.stage.deleteMany({ where: { pipelineId: { in: (await db.pipeline.findMany({ where: { organizationId: orgId }, select: { id: true } })).map((p) => p.id) } } });
    await db.pipeline.deleteMany({ where: { organizationId: orgId } });
    const beforeContacts = await db.contact.count({ where: { organizationId: orgId } });
    const res = await call(leadsPost, makeRequest(`/api/leads/${lead2.id}`, { method: "POST", json: { createDeal: true } }), leadCtx(lead2.id));
    expect(res.status).not.toBe(200);
    const afterContacts = await db.contact.count({ where: { organizationId: orgId } });
    expect(afterContacts).toBe(beforeContacts);
    const l = await db.lead.findUnique({ where: { id: lead2.id } });
    expect(l?.status).not.toBe("CONVERTED");
    // restore pipeline
    const p = await db.pipeline.create({ data: { organizationId: orgId, name: "Default", isDefault: true } });
    await db.stage.create({ data: { pipelineId: p.id, name: "New", position: 0, probability: 10, type: "OPEN" } });
  });

  it("creates a sequence with steps atomically", async () => {
    await loginAs("admin@tx.test");
    const res = await call(sequencesPost, makeRequest("/api/sequences", { method: "POST", json: { name: "Flow", description: "", steps: [{ position: 0, delayHours: 1, subjectTemplate: "Hi", bodyTemplate: "Body" }] } }), seqCtx());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.steps.length).toBe(1);
  });

  it("imports contacts in batches", async () => {
    await loginAs("admin@tx.test");
    const rows = Array.from({ length: 55 }, (_, i) => ({ firstName: `C${i}`, lastName: "L", email: `c${i}@batch.test`, company: i % 2 === 0 ? "Acme" : "" }));
    const res = await call(contactsPost, makeRequest("/api/contacts/import", { method: "POST", json: { contacts: rows } }), { params: Promise.resolve({ id: ["import"] }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.imported).toBe(55);
    expect(body.data.skipped).toBe(0);
  });

  it("sets default pipeline atomically", async () => {
    await loginAs("admin@tx.test");
    const p2 = await db.pipeline.create({ data: { organizationId: orgId, name: "Second", isDefault: false } });
    const res = await call(settingsPatch, makeRequest(`/api/settings/pipelines/${p2.id}`, { method: "PATCH", json: { isDefault: true } }), settingsCtx(["pipelines", p2.id]));
    expect(res.status).toBe(200);
    const defaults = await db.pipeline.findMany({ where: { organizationId: orgId, isDefault: true } });
    expect(defaults.length).toBe(1);
    expect(defaults[0].id).toBe(p2.id);
  });
});
