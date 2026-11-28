/**
 * Quotations & Sales Orders API integration tests.
 *
 * Exercises real Prisma queries, real session auth, and real route handlers via
 * direct handler invocation — no HTTP server, no mocks except next/headers
 * cookies (swapped for an in-memory store).
 */
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

const cookieStore = new Map<string, { name: string; value: string }>();

vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
  cookies: async () => ({
    get: (name: string) => cookieStore.get(name),
    set: (name: string, value: string) => cookieStore.set(name, { name, value }),
    delete: (name: string) => cookieStore.delete(name),
  }),
}));

import { POST as loginRoute } from "@/app/api/auth/login/route";
import { GET as qList, POST as qCreate } from "@/app/api/quotations/route";
import { GET as qGet, PATCH as qPatch, DELETE as qDelete } from "@/app/api/quotations/[id]/route";
import { GET as qPdf } from "@/app/api/quotations/[id]/pdf/route";
import { GET as soList, POST as soCreate } from "@/app/api/sales-orders/route";
import { GET as soGet, PATCH as soPatch, DELETE as soDelete } from "@/app/api/sales-orders/[id]/route";
import db from "@/server/db";
import { hashPassword } from "@/server/auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  } as unknown as Request;
}

function ctx(segments: string | undefined) {
  return { params: Promise.resolve({ id: segments as string }) };
}

let orgId: string;
let dealId: string;
let contactId: string;
let companyId: string;
let productId: string;

beforeAll(async () => {
  // Wipe test DB data (schema applied by setup script).
  await db.salesOrderLineItem.deleteMany();
  await db.salesOrder.deleteMany();
  await db.quotationLineItem.deleteMany();
  await db.quotation.deleteMany();
  await db.session.deleteMany();
  await db.notification.deleteMany();
  await db.activity.deleteMany();
  await db.note.deleteMany();
  await db.task.deleteMany();
  await db.auditLog.deleteMany();
  await db.deal.deleteMany();
  await db.product.deleteMany();
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
  await db.user.create({
    data: { organizationId: orgId, name: "Admin", email: "admin@example.org", passwordHash, role: "ADMIN" },
  });
  await db.user.create({
    data: { organizationId: orgId, name: "Rep", email: "rep@example.org", passwordHash, role: "SALES_REP" },
  });
  const pipeline = await db.pipeline.create({
    data: { organizationId: orgId, name: "P", isDefault: true },
  });
  const stage = await db.stage.create({
    data: { pipelineId: pipeline.id, name: "S1", position: 0, probability: 10, type: "OPEN" },
  });
  const deal = await db.deal.create({
    data: {
      organizationId: orgId,
      name: "Test Deal",
      stageId: stage.id,
      pipelineId: pipeline.id,
    },
  });
  dealId = deal.id;
  const contact = await db.contact.create({
    data: { organizationId: orgId, firstName: "Jane", lastName: "Doe", email: "jane@example.org" },
  });
  contactId = contact.id;
  const company = await db.company.create({
    data: { organizationId: orgId, name: "Acme Co" },
  });
  companyId = company.id;
  const product = await db.product.create({
    data: { organizationId: orgId, name: "Widget", unitPrice: 10, currency: "USD" },
  });
  productId = product.id;
}, 120_000);

afterAll(async () => {
  await db.$disconnect();
});

async function loginAs(email: string) {
  cookieStore.clear();
  const res = await call(loginRoute, makeRequest("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    json: { email, password: "password123" },
  }), { params: Promise.resolve({}) });
  expect(res.status).toBe(200);
  return res;
}

function logout() {
  cookieStore.clear();
}

function qCtx(id: string | undefined) {
  return ctx(id);
}

describe("Quotations API", () => {
  it("requires authentication", async () => {
    logout();
    const res = await call(qList, makeRequest("/api/quotations?dealId=" + dealId), qCtx(undefined));
    expect(res.status).toBe(401);
  });

  it("creates and lists quotations", async () => {
    await loginAs("admin@example.org");
    const res = await call(qCreate, makeRequest("/api/quotations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      json: {
        quotationNumber: "QUO-001",
        dealId,
        contactId,
        companyId,
        status: "DRAFT",
        validUntil: "2027-12-31",
        subtotal: 100,
        tax: 10,
        total: 110,
        notes: "Terms: net 30",
        lineItems: [
          { productId, name: "Widget", description: "A widget", quantity: 2, unitPrice: 10, total: 20 },
        ],
      },
    }), qCtx(undefined));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.data.quotationNumber).toBe("QUO-001");
    expect(data.data.lineItems).toHaveLength(1);
    expect(data.data.lineItems[0].name).toBe("Widget");
    const quoId = data.data.id;

    // List
    const listRes = await call(qList, makeRequest("/api/quotations?dealId=" + dealId), qCtx(undefined));
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.data.quotations).toHaveLength(1);
    expect(listData.data.quotations[0].id).toBe(quoId);

    // Get
    const getRes = await call(qGet, makeRequest("/api/quotations/" + quoId), qCtx(quoId));
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.data.id).toBe(quoId);
  });

  it("rejects duplicate quotation numbers", async () => {
    await loginAs("admin@example.org");
    const res = await call(qCreate, makeRequest("/api/quotations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      json: { quotationNumber: "QUO-001", dealId, lineItems: [] },
    }), qCtx(undefined));
    expect(res.status).toBe(409);
  });

  it("sales rep can create but not manage quotations", async () => {
    await loginAs("rep@example.org");
    const createRes = await call(qCreate, makeRequest("/api/quotations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      json: { quotationNumber: "QUO-REP", dealId, lineItems: [] },
    }), qCtx(undefined));
    expect(createRes.status).toBe(201);
    const data = await createRes.json();
    const quoId = data.data.id;

    const patchRes = await call(qPatch, makeRequest("/api/quotations/" + quoId, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      json: { status: "SENT" },
    }), qCtx(quoId));
    expect(patchRes.status).toBe(403);

    const delRes = await call(qDelete, makeRequest("/api/quotations/" + quoId, { method: "DELETE" }), qCtx(quoId));
    expect(delRes.status).toBe(403);
  });

  it("transitions quotation status and rejects terminal transitions", async () => {
    await loginAs("admin@example.org");
    const createRes = await call(qCreate, makeRequest("/api/quotations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      json: { quotationNumber: "QUO-002", dealId, lineItems: [] },
    }), qCtx(undefined));
    expect(createRes.status).toBe(201);
    const quoId = (await createRes.json()).data.id;

    // DRAFT -> SENT
    const sentRes = await call(qPatch, makeRequest("/api/quotations/" + quoId, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      json: { status: "SENT" },
    }), qCtx(quoId));
    expect(sentRes.status).toBe(200);
    expect((await sentRes.json()).data.status).toBe("SENT");

    // SENT -> ACCEPTED
    const accRes = await call(qPatch, makeRequest("/api/quotations/" + quoId, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      json: { status: "ACCEPTED" },
    }), qCtx(quoId));
    expect(accRes.status).toBe(200);

    // ACCEPTED -> SENT (terminal) rejected
    const badRes = await call(qPatch, makeRequest("/api/quotations/" + quoId, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      json: { status: "SENT" },
    }), qCtx(quoId));
    expect(badRes.status).toBe(400);
  });

  it("generates a PDF", async () => {
    await loginAs("admin@example.org");
    const createRes = await call(qCreate, makeRequest("/api/quotations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      json: { quotationNumber: "QUO-PDF", dealId, contactId, companyId, lineItems: [] },
    }), qCtx(undefined));
    expect(createRes.status).toBe(201);
    const quoId = (await createRes.json()).data.id;

    const pdfRes = await call(qPdf, makeRequest("/api/quotations/" + quoId + "/pdf"), qCtx(quoId));
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get("content-type")).toBe("application/pdf");
    const bytes = new Uint8Array(await pdfRes.arrayBuffer());
    const header = String.fromCharCode(...Array.from(bytes.slice(0, 5)));
    expect(header.startsWith("%PDF")).toBe(true);
  });

  it("deletes a quotation", async () => {
    await loginAs("admin@example.org");
    const createRes = await call(qCreate, makeRequest("/api/quotations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      json: { quotationNumber: "QUO-DEL", dealId, lineItems: [] },
    }), qCtx(undefined));
    expect(createRes.status).toBe(201);
    const quoId = (await createRes.json()).data.id;

    const delRes = await call(qDelete, makeRequest("/api/quotations/" + quoId, { method: "DELETE" }), qCtx(quoId));
    expect(delRes.status).toBe(200);
    expect((await delRes.json()).data.deleted).toBe(true);

    const getRes = await call(qGet, makeRequest("/api/quotations/" + quoId), qCtx(quoId));
    expect(getRes.status).toBe(404);
  });

  it("scopes to organization", async () => {
    await loginAs("admin@example.org");
    // Other org's quotation should not be visible
    const otherOrg = await db.organization.create({ data: { name: "Other Org" } });
    const otherQuo = await db.quotation.create({
      data: { organizationId: otherOrg.id, quotationNumber: "QUO-OTHER", dealId },
    });
    const getRes = await call(qGet, makeRequest("/api/quotations/" + otherQuo.id), qCtx(otherQuo.id));
    expect(getRes.status).toBe(404);
  });
});

describe("Sales Orders API", () => {
  it("requires authentication", async () => {
    logout();
    const res = await call(soList, makeRequest("/api/sales-orders"), qCtx(undefined));
    expect(res.status).toBe(401);
  });

  it("creates and lists sales orders", async () => {
    await loginAs("admin@example.org");
    const res = await call(soCreate, makeRequest("/api/sales-orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      json: {
        orderNumber: "SO-001",
        dealId,
        contactId,
        companyId,
        status: "PENDING",
        orderDate: "2027-01-15",
        subtotal: 100,
        tax: 10,
        total: 110,
        shippingAddress: "123 Main St",
        notes: "Please ship fast",
        lineItems: [
          { productId, name: "Widget", description: "A widget", quantity: 2, unitPrice: 10, total: 20 },
        ],
      },
    }), qCtx(undefined));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.data.orderNumber).toBe("SO-001");
    expect(data.data.lineItems).toHaveLength(1);
    const soId = data.data.id;

    const listRes = await call(soList, makeRequest("/api/sales-orders?dealId=" + dealId), qCtx(undefined));
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.data.salesOrders).toHaveLength(1);

    const getRes = await call(soGet, makeRequest("/api/sales-orders/" + soId), qCtx(soId));
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).data.id).toBe(soId);
  });

  it("sales rep can create but not manage sales orders", async () => {
    await loginAs("rep@example.org");
    const createRes = await call(soCreate, makeRequest("/api/sales-orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      json: { orderNumber: "SO-REP", dealId, lineItems: [] },
    }), qCtx(undefined));
    expect(createRes.status).toBe(201);
    const data = await createRes.json();
    const soId = data.data.id;

    const patchRes = await call(soPatch, makeRequest("/api/sales-orders/" + soId, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      json: { status: "CONFIRMED" },
    }), qCtx(soId));
    expect(patchRes.status).toBe(403);

    const delRes = await call(soDelete, makeRequest("/api/sales-orders/" + soId, { method: "DELETE" }), qCtx(soId));
    expect(delRes.status).toBe(403);
  });

  it("transitions sales order status and rejects terminal transitions", async () => {
    await loginAs("admin@example.org");
    const createRes = await call(soCreate, makeRequest("/api/sales-orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      json: { orderNumber: "SO-002", dealId, lineItems: [] },
    }), qCtx(undefined));
    expect(createRes.status).toBe(201);
    const soId = (await createRes.json()).data.id;

    // PENDING -> CONFIRMED
    const confRes = await call(soPatch, makeRequest("/api/sales-orders/" + soId, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      json: { status: "CONFIRMED" },
    }), qCtx(soId));
    expect(confRes.status).toBe(200);
    expect((await confRes.json()).data.status).toBe("CONFIRMED");

    // CONFIRMED -> COMPLETED
    const compRes = await call(soPatch, makeRequest("/api/sales-orders/" + soId, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      json: { status: "COMPLETED" },
    }), qCtx(soId));
    expect(compRes.status).toBe(200);

    // COMPLETED -> CONFIRMED (terminal) rejected
    const badRes = await call(soPatch, makeRequest("/api/sales-orders/" + soId, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      json: { status: "CONFIRMED" },
    }), qCtx(soId));
    expect(badRes.status).toBe(400);
  });

  it("deletes a sales order", async () => {
    await loginAs("admin@example.org");
    const createRes = await call(soCreate, makeRequest("/api/sales-orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      json: { orderNumber: "SO-DEL", dealId, lineItems: [] },
    }), qCtx(undefined));
    expect(createRes.status).toBe(201);
    const soId = (await createRes.json()).data.id;

    const delRes = await call(soDelete, makeRequest("/api/sales-orders/" + soId, { method: "DELETE" }), qCtx(soId));
    expect(delRes.status).toBe(200);
    expect((await delRes.json()).data.deleted).toBe(true);

    const getRes = await call(soGet, makeRequest("/api/sales-orders/" + soId), qCtx(soId));
    expect(getRes.status).toBe(404);
  });
});
