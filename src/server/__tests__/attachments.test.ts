import { beforeAll, afterAll, describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const cookieStore = new Map<string, { name: string; value: string }>();

vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
  cookies: async () => ({
    get: (name: string) => cookieStore.get(name),
    set: (name: string, value: string) => cookieStore.set(name, { name, value }),
    delete: (name: string) => cookieStore.delete(name),
  }),
}));

import { GET as attachmentsGet, POST as attachmentsPost } from "@/app/api/attachments/route";
import { GET as attachmentGet, DELETE as attachmentDelete } from "@/app/api/attachments/[[...id]]/route";
import db from "@/server/db";
import { hashPassword } from "@/server/auth";
import { resolveUploadPath } from "@/server/storage";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: any, ctx?: any) => Promise<Response>;

function call(handler: Handler, req: unknown, ctx?: unknown): Promise<Response> {
  return ctx !== undefined ? handler(req as never, ctx as never) : handler(req as never);
}

function makeRequest(pathname: string, init?: { method?: string; headers?: Record<string, string>; body?: unknown }) {
  const url = new URL(`http://localhost:3000${pathname}`);
  return {
    url: url.toString(),
    method: init?.method ?? "GET",
    headers: new Headers(init?.headers),
    body: init?.body,
    formData: async () => {
      const fd = new FormData();
      if (init?.body instanceof FormData) {
        for (const [key, value] of init.body.entries()) fd.append(key, value);
      }
      return fd;
    },
    json: async () => (init?.body !== undefined ? JSON.parse(String(init.body)) : {}),
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
let userId: string;
let contactId: string;
let dealId: string;

beforeAll(async () => {
  await db.attachment.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
  await db.organization.deleteMany();
  await db.deal.deleteMany();
  await db.contact.deleteMany();

  orgId = (await db.organization.create({ data: { name: "Test Org Attachments" } })).id;
  const passwordHash = await hashPassword("password123");
  const user = await db.user.create({
    data: { organizationId: orgId, name: "Attachments User", email: "attach@example.org", passwordHash, role: "ADMIN" },
  });
  userId = user.id;

  const contact = await db.contact.create({
    data: { organizationId: orgId, firstName: "Attach", lastName: "Contact", email: "attach@example.org" },
  });
  contactId = contact.id;

  const pipeline = await db.pipeline.create({ data: { organizationId: orgId, name: "P" } });
  const stage = await db.stage.create({ data: { pipelineId: pipeline.id, name: "S1", position: 0 } });
  const deal = await db.deal.create({
    data: { organizationId: orgId, name: "Attach Deal", stageId: stage.id, pipelineId: pipeline.id },
  });
  dealId = deal.id;
}, 120_000);

afterAll(async () => {
  await db.$disconnect();
});

async function loginAs(email: string) {
  cookieStore.clear();
  const { POST: loginRoute } = await import("@/app/api/auth/login/route");
  const res = await call(loginRoute, makeRequest("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  }));
  expect(res.status).toBe(200);
}

function logout() {
  cookieStore.clear();
}

function makeMultipart(file: File, entityType: string, entityId: string) {
  const formData = new FormData();
  formData.append("entityType", entityType);
  formData.append("entityId", entityId);
  formData.append("file", file);
  return formData;
}

describe("Attachments API routes", () => {
  beforeEach(() => {
    logout();
  });

  it("requires auth for GET and POST", async () => {
    const res = await attachmentsGet(makeRequest("/api/attachments") as never, ctx(undefined));
    expect(res.status).toBe(401);

    const res2 = await attachmentsPost(makeRequest("/api/attachments") as never, ctx(undefined));
    expect(res2.status).toBe(401);
  });

  it("uploads a file, lists, downloads and deletes it", async () => {
    await loginAs("attach@example.org");

    const file = new File(["hello world"], "hello.txt", { type: "text/plain" });
    const res = await attachmentsPost(
      makeRequest("/api/attachments", {
        method: "POST",
        body: makeMultipart(file, "CONTACT", contactId),
      }) as never,
      ctx(undefined)
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.originalName).toBe("hello.txt");
    expect(body.data.mimeType).toBe("text/plain");
    expect(body.data.size).toBe(5);
    expect(body.data.storageType).toBe("LOCAL");
    expect(body.data.entityType).toBe("CONTACT");
    expect(body.data.entityId).toBe(contactId);
    expect(body.data.uploadedBy.id).toBe(userId);
    expect(typeof body.data.url).toBe("string");
    expect(body.data.path).toContain(`uploads/${orgId}/`);

    // List with entity filter
    const list = await attachmentsGet(
      makeRequest(`/api/attachments?entityType=CONTACT&entityId=${contactId}`) as never,
      ctx(undefined)
    );
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(listBody.data.attachments).toHaveLength(1);
    expect(listBody.data.attachments[0].id).toBe(body.data.id);

    // Download by attachment id
    const dl = await attachmentGet(makeRequest(`/api/attachments/${body.data.id}`) as never, ctx(undefined));
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("text/plain");
    expect(dl.headers.get("content-disposition") ?? "").toContain("hello.txt");
    const buffer = Buffer.from(await dl.arrayBuffer());
    expect(buffer.toString()).toBe("hello world");

    // Download by storage path
    const relPath = body.data.path;
    const byPath = await attachmentGet(
      makeRequest(`/api/attachments/${relPath}`) as never,
      ctx(undefined)
    );
    expect(byPath.status).toBe(200);

    // File exists on disk
    expect(fs.existsSync(resolveUploadPath(relPath))).toBe(true);

    // Delete
    const del = await attachmentDelete(
      makeRequest(`/api/attachments/${body.data.id}`, { method: "DELETE" }) as never,
      ctx(undefined)
    );
    expect(del.status).toBe(200);
    expect((await del.json()).data).toEqual({ deleted: true });

    // Soft-deleted: no longer downloadable by id, file removed
    const gone = await attachmentGet(makeRequest(`/api/attachments/${body.data.id}`) as never, ctx(undefined));
    expect(gone.status).toBe(404);
    expect(fs.existsSync(resolveUploadPath(relPath))).toBe(false);

    const row = await db.attachment.findUnique({ where: { id: body.data.id } });
    expect(row?.deletedAt).not.toBeNull();
  });

  it("rejects files that are too large or have an unsupported type", async () => {
    await loginAs("attach@example.org");

    const big = new File(new Array(11 * 1024 * 1024).fill("x"), "big.pdf", { type: "application/pdf" });
    const resBig = await attachmentsPost(
      makeRequest("/api/attachments", { method: "POST", body: makeMultipart(big, "CONTACT", contactId) }) as never,
      ctx(undefined)
    );
    expect(resBig.status).toBe(400);

    const bad = new File(["bad"], "evil.exe", { type: "application/x-msdownload" });
    const resBad = await attachmentsPost(
      makeRequest("/api/attachments", { method: "POST", body: makeMultipart(bad, "CONTACT", contactId) }) as never,
      ctx(undefined)
    );
    expect(resBad.status).toBe(400);
  });

  it("requires a valid entity", async () => {
    await loginAs("attach@example.org");
    const file = new File(["x"], "x.txt", { type: "text/plain" });
    const res = await attachmentsPost(
      makeRequest("/api/attachments", {
        method: "POST",
        body: makeMultipart(file, "CONTACT", "000000000000000000000000"),
      }) as never,
      ctx(undefined)
    );
    expect(res.status).toBe(400);
  });

  it("attaches to a deal and returns 404 for unknown download/delete", async () => {
    await loginAs("attach@example.org");
    const file = new File(["deal-doc"], "deal.pdf", { type: "application/pdf" });
    const res = await attachmentsPost(
      makeRequest("/api/attachments", { method: "POST", body: makeMultipart(file, "DEAL", dealId) }) as never,
      ctx(undefined)
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.entityType).toBe("DEAL");
    expect(body.data.entityId).toBe(dealId);

    const missing = await attachmentGet(makeRequest("/api/attachments/does-not-exist") as never, ctx(undefined));
    expect(missing.status).toBe(404);
    const missingDel = await attachmentDelete(
      makeRequest("/api/attachments/does-not-exist", { method: "DELETE" }) as never,
      ctx(undefined)
    );
    expect(missingDel.status).toBe(404);
  });
});
