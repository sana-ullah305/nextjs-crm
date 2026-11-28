/**
 * Meetings + Calls API integration tests.
 *
 * Mirrors api-integration.test.ts: a dedicated test SQLite DB (configured in
 * vitest.setup.ts), real Prisma, real session auth, route handlers invoked
 * directly. next/headers cookies are swapped for an in-memory store.
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
import { GET as meetingsGet, POST as meetingsPost } from "@/app/api/meetings/route";
import { GET as meetingGet, PATCH as meetingPatch, DELETE as meetingDelete } from "@/app/api/meetings/[id]/route";
import { GET as attendeesGet, POST as attendeesPost } from "@/app/api/meetings/[id]/attendees/route";
import { PATCH as attendeePatch, DELETE as attendeeDelete } from "@/app/api/meetings/[id]/attendees/[attendeeId]/route";
import { GET as callsGet, POST as callsPost } from "@/app/api/calls/route";
import { GET as callGet, PATCH as callPatch, DELETE as callDelete } from "@/app/api/calls/[id]/route";
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
  };
}

function ctx(segments: string | undefined, attendeeId?: string) {
  return { params: Promise.resolve({ id: segments as string, attendeeId: attendeeId as string }) };
}

let orgId: string;
let contactId = "";

beforeAll(async () => {
  await db.session.deleteMany();
  await db.meetingAttendee.deleteMany();
  await db.meeting.deleteMany();
  await db.call.deleteMany();
  await db.auditLog.deleteMany();
  await db.contact.deleteMany();
  await db.user.deleteMany();
  await db.organization.deleteMany();

  orgId = (await db.organization.create({ data: { name: "Test Org" } })).id;
  const passwordHash = await hashPassword("password123");
  await db.user.create({
    data: { organizationId: orgId, name: "Admin", email: "admin@example.org", passwordHash, role: "ADMIN" },
  });
  await db.user.create({
    data: { organizationId: orgId, name: "Rep", email: "rep@example.org", passwordHash, role: "SALES_REP" },
  });
  const contact = await db.contact.create({
    data: { organizationId: orgId, firstName: "Ada", lastName: "Byron", email: "ada@example.org" },
  });
  contactId = contact.id;
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
}

describe("meetings CRUD", () => {
  let meetingId = "";

  it("rep schedules a meeting with an attendee", async () => {
    await loginAs("rep@example.org");
    const res = await meetingsPost(
      makeRequest("/api/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: {
          title: "Discovery call",
          startTime: new Date(Date.now() + 86_400_000).toISOString(),
          location: "Zoom",
          attendeeContactIds: [contactId],
        },
      }) as never,
      ctx(undefined)
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    meetingId = body.data.id;
    expect(body.data.status).toBe("SCHEDULED");
    expect(body.data.attendees.length).toBe(1);
  });

  it("lists meetings filtered by contact", async () => {
    const res = await meetingsGet(makeRequest(`/api/meetings?contactId=${contactId}`) as never, ctx(undefined));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.total).toBe(1);
  });

  it("gets a single meeting", async () => {
    const res = await meetingGet(makeRequest(`/api/meetings/${meetingId}`) as never, ctx(meetingId));
    expect(res.status).toBe(200);
    expect((await res.json()).data.title).toBe("Discovery call");
  });

  it("rep cannot manage (PATCH) a meeting they did not create", async () => {
    // Rep lacks meetings:manage -> 403 at permission gate.
    const res = await meetingPatch(
      makeRequest(`/api/meetings/${meetingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        json: { status: "COMPLETED" },
      }) as never,
      ctx(meetingId)
    );
    expect(res.status).toBe(403);
  });

  it("admin updates meeting status and outcome", async () => {
    await loginAs("admin@example.org");
    const res = await meetingPatch(
      makeRequest(`/api/meetings/${meetingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        json: { status: "COMPLETED", outcome: "Interested" },
      }) as never,
      ctx(meetingId)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("COMPLETED");
    expect(body.data.outcome).toBe("Interested");
  });

  it("admin adds, updates, and removes an attendee", async () => {
    const added = await attendeesPost(
      makeRequest(`/api/meetings/${meetingId}/attendees`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { contactId, status: "ACCEPTED" },
      }) as never,
      ctx(meetingId)
    );
    expect(added.status).toBe(201);
    const attendee = (await added.json()).data;

    const listed = await attendeesGet(makeRequest(`/api/meetings/${meetingId}/attendees`) as never, ctx(meetingId));
    expect((await listed.json()).data.attendees.length).toBeGreaterThanOrEqual(1);

    const patched = await attendeePatch(
      makeRequest(`/api/meetings/${meetingId}/attendees/${attendee.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        json: { status: "ATTENDED" },
      }) as never,
      ctx(meetingId, attendee.id)
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).data.status).toBe("ATTENDED");

    const del = await attendeeDelete(
      makeRequest(`/api/meetings/${meetingId}/attendees/${attendee.id}`, { method: "DELETE" }) as never,
      ctx(meetingId, attendee.id)
    );
    expect(del.status).toBe(200);
  });

  it("validates missing title", async () => {
    const res = await meetingsPost(
      makeRequest("/api/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { startTime: new Date().toISOString() },
      }) as never,
      ctx(undefined)
    );
    expect(res.status).toBe(400);
  });

  it("admin deletes a meeting", async () => {
    const res = await meetingDelete(makeRequest(`/api/meetings/${meetingId}`, { method: "DELETE" }) as never, ctx(meetingId));
    expect(res.status).toBe(200);
    const row = await db.meeting.findUnique({ where: { id: meetingId } });
    expect(row).toBeNull();
  });
});

describe("calls CRUD", () => {
  let callId = "";

  it("rep logs a call against a contact", async () => {
    await loginAs("rep@example.org");
    const res = await callsPost(
      makeRequest("/api/calls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        json: { title: "Intro call", contactId, direction: "OUTBOUND", duration: 320, outcome: "Follow up" },
      }) as never,
      ctx(undefined)
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    callId = body.data.id;
    expect(body.data.duration).toBe(320);
    expect(body.data.direction).toBe("OUTBOUND");
  });

  it("lists calls filtered by contact", async () => {
    const res = await callsGet(makeRequest(`/api/calls?contactId=${contactId}`) as never, ctx(undefined));
    expect(res.status).toBe(200);
    expect((await res.json()).data.total).toBe(1);
  });

  it("gets a single call", async () => {
    const res = await callGet(makeRequest(`/api/calls/${callId}`) as never, ctx(callId));
    expect(res.status).toBe(200);
    expect((await res.json()).data.title).toBe("Intro call");
  });

  it("rep cannot manage (PATCH) a call", async () => {
    const res = await callPatch(
      makeRequest(`/api/calls/${callId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        json: { outcome: "Updated" },
      }) as never,
      ctx(callId)
    );
    expect(res.status).toBe(403);
  });

  it("admin updates and deletes a call", async () => {
    await loginAs("admin@example.org");
    const patched = await callPatch(
      makeRequest(`/api/calls/${callId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        json: { outcome: "Closed", duration: 600 },
      }) as never,
      ctx(callId)
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).data.duration).toBe(600);

    const del = await callDelete(makeRequest(`/api/calls/${callId}`, { method: "DELETE" }) as never, ctx(callId));
    expect(del.status).toBe(200);
    expect(await db.call.findUnique({ where: { id: callId } })).toBeNull();
  });

  it("blocks unauthenticated access", async () => {
    cookieStore.clear();
    const res = await callsGet(makeRequest("/api/calls") as never, ctx(undefined));
    expect(res.status).toBe(401);
  });
});
