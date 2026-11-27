/**
 * Integration tests for company merge and trash/restore.
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
import { POST as companyMergePost } from "@/app/api/merge/companies/route";
import { GET as companyMergePreviewGet } from "@/app/api/merge/companies/preview/route";
import { GET as trashGet, POST as trashPost } from "@/app/api/trash/route";
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
let managerId: string;
let repId: string;
let otherOrgAdminId: string;

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
  await db.organization.deleteMany();

  orgId = (await db.organization.create({ data: { name: "CoMerge Org" } })).id;
  otherOrgId = (await db.organization.create({ data: { name: "Other CoMerge Org" } })).id;
  const passwordHash = await hashPassword("password123");
  const admin = await db.user.create({
    data: { organizationId: orgId, name: "Admin", email: "admin@comerge.test", passwordHash, role: "ADMIN" },
  });
  adminId = admin.id;
  const manager = await db.user.create({
    data: { organizationId: orgId, name: "Manager", email: "manager@comerge.test", passwordHash, role: "MANAGER" },
  });
  managerId = manager.id;
  const rep = await db.user.create({
    data: { organizationId: orgId, name: "Rep", email: "rep@comerge.test", passwordHash, role: "SALES_REP" },
  });
  repId = rep.id;
  const otherAdmin = await db.user.create({
    data: { organizationId: otherOrgId, name: "Other", email: "other@comerge.test", passwordHash, role: "ADMIN" },
  });
  otherOrgAdminId = otherAdmin.id;
}, 120_000);

afterAll(async () => {
  await db.$disconnect();
});

describe("company merge preview", () => {
  it("returns a field diff, relation counts, tag union, and survivor recommendation", async () => {
    await loginAs("admin@comerge.test");
    const older = await db.company.create({
      data: { organizationId: orgId, name: "Acme", domain: "acme.com", ownerId: adminId },
    });
    const newer = await db.company.create({
      data: { organizationId: orgId, name: "Acme Inc", domain: "acme-inc.com" },
    });
    const tagA = await db.tag.create({ data: { organizationId: orgId, name: "vip" } });
    const tagB = await db.tag.create({ data: { organizationId: orgId, name: "west" } });
    await db.contact.create({
      data: {
        organizationId: orgId,
        firstName: "Old",
        lastName: "Co",
        email: "old@acme.test",
        companyId: older.id,
        tags: { connect: [{ id: tagA.id }] },
      },
    });
    await db.contact.create({
      data: {
        organizationId: orgId,
        firstName: "New",
        lastName: "Co",
        email: "new@acme.test",
        companyId: newer.id,
        tags: { connect: [{ id: tagB.id }] },
      },
    });
    await db.activity.create({
      data: { organizationId: orgId, type: "CALL", title: "call on newer co", companyId: newer.id, userId: adminId },
    });

    const res = await call(
      companyMergePreviewGet,
      makeRequest(`/api/merge/companies/preview?id=${older.id}&intoId=${newer.id}`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const preview = body.data;

    const nameField = preview.fields.find((f: { field: string }) => f.field === "name");
    expect(nameField.differs).toBe(true);
    expect(nameField.source).toBe("Acme");
    const domainField = preview.fields.find((f: { field: string }) => f.field === "domain");
    expect(domainField.source).toBe("acme.com");

    expect(preview.relations.contacts).toBe(1);
    expect(preview.relations.activities).toBe(0);
    expect(preview.tags.source).toEqual(["vip"]);
    expect(preview.tags.target).toEqual(["west"]);
    expect(preview.tags.combined).toEqual(["vip", "west"]);
    // Older record recommended as survivor.
    expect(preview.recommendedSurvivor).toBe("source");
  });

  it("forbids reps (403) and 404s cross-org ids", async () => {
    await loginAs("rep@comerge.test");
    const a = await db.company.create({ data: { organizationId: orgId, name: "R1" } });
    const b = await db.company.create({ data: { organizationId: orgId, name: "R2" } });
    const repRes = await call(
      companyMergePreviewGet,
      makeRequest(`/api/merge/companies/preview?id=${a.id}&intoId=${b.id}`)
    );
    expect(repRes.status).toBe(403);

    await loginAs("admin@comerge.test");
    const foreign = await db.company.create({
      data: { organizationId: otherOrgId, name: "Foreign", ownerId: otherOrgAdminId },
    });
    const crossRes = await call(
      companyMergePreviewGet,
      makeRequest(`/api/merge/companies/preview?id=${a.id}&intoId=${foreign.id}`)
    );
    expect(crossRes.status).toBe(404);
  });
});

describe("company merge execution", () => {
  it("re-points contacts/leads/deals/activities/notes/tasks, unions tags, soft-deletes loser, honors field choices, and audits", async () => {
    await loginAs("admin@comerge.test");
    const target = await db.company.create({
      data: { organizationId: orgId, name: "Keep Co", domain: "keep.test", ownerId: adminId },
    });
    const source = await db.company.create({
      data: { organizationId: orgId, name: "Lose Co", domain: "lose.test" },
    });
    const pipeline = await db.pipeline.create({ data: { organizationId: orgId, name: "cpm", isDefault: true } });
    const stage = await db.stage.create({ data: { pipelineId: pipeline.id, name: "cs", position: 0, probability: 10 } });

    const tagA = await db.tag.create({ data: { organizationId: orgId, name: "alpha" } });
    const tagB = await db.tag.create({ data: { organizationId: orgId, name: "beta" } });
    const sourceContact = await db.contact.create({
      data: {
        organizationId: orgId,
        firstName: "S",
        lastName: "Contact",
        email: "s@lose.test",
        companyId: source.id,
        tags: { connect: [{ id: tagA.id }] },
      },
    });
    await db.contact.create({
      data: {
        organizationId: orgId,
        firstName: "T",
        lastName: "Contact",
        email: "t@keep.test",
        companyId: target.id,
        tags: { connect: [{ id: tagB.id }] },
      },
    });
    const lead = await db.lead.create({
      data: { organizationId: orgId, firstName: "L", lastName: "Lead", email: "l@lose.test", companyId: source.id },
    });
    const deal = await db.deal.create({
      data: { organizationId: orgId, name: "deal on source co", companyId: source.id, stageId: stage.id, pipelineId: pipeline.id },
    });
    const activity = await db.activity.create({
      data: { organizationId: orgId, type: "CALL", title: "call on source co", companyId: source.id, userId: adminId },
    });
    const note = await db.note.create({
      data: { organizationId: orgId, body: "note on source co", companyId: source.id, userId: adminId },
    });
    const task = await db.task.create({
      data: { organizationId: orgId, title: "task on source co", relatedType: "company", relatedId: source.id, createdById: adminId },
    });

    const res = await call(
      companyMergePost,
      makeRequest("/api/merge/companies", {
        method: "POST",
        json: {
          sourceId: source.id,
          targetId: target.id,
          fieldChoices: { domain: "chosen.test", industry: "Tech" },
        },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.moved.contacts).toBe(1);
    expect(body.data.moved.leads).toBe(1);
    expect(body.data.moved.deals).toBe(1);
    expect(body.data.moved.activities).toBe(1);
    expect(body.data.moved.notes).toBe(1);
    expect(body.data.moved.tasks).toBe(1);
    expect(body.data.tagsMerged).toBeGreaterThanOrEqual(1);

    // Loser soft-deleted with summary pointer; survivor keeps values + choices.
    const loser = await db.company.findUnique({ where: { id: source.id } });
    expect(loser!.deletedAt).not.toBeNull();
    expect(loser!.summary).toContain(`Merged into company ${target.id} on`);
    const survivor = await db.company.findUnique({ where: { id: target.id } });
    expect(survivor!.name).toBe("Keep Co");
    expect(survivor!.domain).toBe("chosen.test");
    expect(survivor!.industry).toBe("Tech");

    // FK rows re-pointed.
    const movedContact = await db.contact.findUnique({ where: { id: sourceContact.id } });
    expect(movedContact!.companyId).toBe(target.id);
    // Tags combined: the source contact now also carries the survivor's tag.
    const movedTags = await db.contact.findUnique({
      where: { id: sourceContact.id },
      include: { tags: true },
    });
    const movedTagNames = movedTags!.tags.map((t) => t.name).sort();
    expect(movedTagNames).toEqual(["alpha", "beta"]);
    expect((await db.lead.findUnique({ where: { id: lead.id } }))!.companyId).toBe(target.id);
    expect((await db.deal.findUnique({ where: { id: deal.id } }))!.companyId).toBe(target.id);
    expect((await db.activity.findUnique({ where: { id: activity.id } }))!.companyId).toBe(target.id);
    expect((await db.note.findUnique({ where: { id: note.id } }))!.companyId).toBe(target.id);
    expect((await db.task.findUnique({ where: { id: task.id } }))!.relatedId).toBe(target.id);

    // Audit written.
    const audit = await db.auditLog.findFirst({
      where: { organizationId: orgId, action: "COMPANY_MERGE", entityId: target.id },
    });
    expect(audit).not.toBeNull();

    // No row hard-deleted.
    expect(await db.company.count({ where: { organizationId: orgId, id: source.id } })).toBe(1);
  });

  it("forbids reps (403), 404s cross-org, and rejects same-id merges (400)", async () => {
    const a = await db.company.create({ data: { organizationId: orgId, name: "G1" } });
    const b = await db.company.create({ data: { organizationId: orgId, name: "G2" } });

    await loginAs("rep@comerge.test");
    const repRes = await call(
      companyMergePost,
      makeRequest("/api/merge/companies", {
        method: "POST",
        json: { sourceId: a.id, targetId: b.id },
      })
    );
    expect(repRes.status).toBe(403);

    await loginAs("admin@comerge.test");
    const foreign = await db.company.create({
      data: { organizationId: otherOrgId, name: "ForeignCo", ownerId: otherOrgAdminId },
    });
    const crossRes = await call(
      companyMergePost,
      makeRequest("/api/merge/companies", {
        method: "POST",
        json: { sourceId: a.id, targetId: foreign.id },
      })
    );
    expect(crossRes.status).toBe(404);

    const sameRes = await call(
      companyMergePost,
      makeRequest("/api/merge/companies", {
        method: "POST",
        json: { sourceId: a.id, targetId: a.id },
      })
    );
    expect(sameRes.status).toBe(400);

    // Source untouched after failed attempts.
    expect((await db.company.findUnique({ where: { id: a.id } }))!.deletedAt).toBeNull();
  });

  it("lets managers merge (allowed) — manager has companies:merge", async () => {
    await loginAs("manager@comerge.test");
    const a = await db.company.create({ data: { organizationId: orgId, name: "MgrA", ownerId: managerId } });
    const b = await db.company.create({ data: { organizationId: orgId, name: "MgrB", ownerId: managerId } });
    const res = await call(
      companyMergePost,
      makeRequest("/api/merge/companies", {
        method: "POST",
        json: { sourceId: a.id, targetId: b.id },
      })
    );
    expect(res.status).toBe(200);
  });
});

describe("trash / restore", () => {
  it("lists soft-deleted companies and restores them (manager allowed)", async () => {
    await loginAs("manager@comerge.test");
    const c = await db.company.create({
      data: { organizationId: orgId, name: "Trashed Co", deletedAt: new Date() },
    });

    const listRes = await call(trashGet, makeRequest("/api/trash?type=company"));
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    const found = listBody.data.find((r: { id: string }) => r.id === c.id);
    expect(found).toBeTruthy();
    expect(found.title).toBe("Trashed Co");

    const restoreRes = await call(
      trashPost,
      makeRequest("/api/trash", {
        method: "POST",
        json: { type: "company", id: c.id, action: "restore" },
      })
    );
    expect(restoreRes.status).toBe(200);
    expect((await db.company.findUnique({ where: { id: c.id } }))!.deletedAt).toBeNull();

    // Audit written for restore.
    const audit = await db.auditLog.findFirst({
      where: { organizationId: orgId, action: "RECORD_RESTORE", entityId: c.id },
    });
    expect(audit).not.toBeNull();
  });

  it("hard-deletes only for admins; managers/restore perms enforced; reps forbidden", async () => {
    // Rep cannot restore.
    const repCo = await db.company.create({
      data: { organizationId: orgId, name: "Rep Co", deletedAt: new Date() },
    });
    await loginAs("rep@comerge.test");
    const repRestore = await call(
      trashPost,
      makeRequest("/api/trash", {
        method: "POST",
        json: { type: "company", id: repCo.id, action: "restore" },
      })
    );
    expect(repRestore.status).toBe(403);

    // Manager cannot hard-delete.
    await loginAs("manager@comerge.test");
    const mgrCo = await db.company.create({
      data: { organizationId: orgId, name: "Mgr Co", deletedAt: new Date(), ownerId: managerId },
    });
    const mgrHard = await call(
      trashPost,
      makeRequest("/api/trash", {
        method: "POST",
        json: { type: "company", id: mgrCo.id, action: "hard_delete" },
      })
    );
    expect(mgrHard.status).toBe(403);
    // Still present.
    expect(await db.company.count({ where: { id: mgrCo.id } })).toBe(1);

    // Admin can hard-delete.
    await loginAs("admin@comerge.test");
    const adminCo = await db.company.create({
      data: { organizationId: orgId, name: "Admin Co", deletedAt: new Date() },
    });
    const adminHard = await call(
      trashPost,
      makeRequest("/api/trash", {
        method: "POST",
        json: { type: "company", id: adminCo.id, action: "hard_delete" },
      })
    );
    expect(adminHard.status).toBe(200);
    expect(await db.company.count({ where: { id: adminCo.id } })).toBe(0);

    // Audit written for hard delete.
    const audit = await db.auditLog.findFirst({
      where: { organizationId: orgId, action: "RECORD_HARD_DELETE", entityId: adminCo.id },
    });
    expect(audit).not.toBeNull();
  });

  it("restores soft-deleted contacts and leads; 404s non-deleted and cross-org ids", async () => {
    await loginAs("admin@comerge.test");
    const contact = await db.contact.create({
      data: { organizationId: orgId, firstName: "Del", lastName: "Contact", email: "delc@trash.test", deletedAt: new Date() },
    });
    const lead = await db.lead.create({
      data: { organizationId: orgId, firstName: "Del", lastName: "Lead", email: "dell@trash.test", deletedAt: new Date() },
    });

    const contactRestore = await call(
      trashPost,
      makeRequest("/api/trash", {
        method: "POST",
        json: { type: "contact", id: contact.id, action: "restore" },
      })
    );
    expect(contactRestore.status).toBe(200);
    expect((await db.contact.findUnique({ where: { id: contact.id } }))!.deletedAt).toBeNull();

    const leadRestore = await call(
      trashPost,
      makeRequest("/api/trash", {
        method: "POST",
        json: { type: "lead", id: lead.id, action: "restore" },
      })
    );
    expect(leadRestore.status).toBe(200);
    expect((await db.lead.findUnique({ where: { id: lead.id } }))!.deletedAt).toBeNull();

    // Restoring a non-deleted record → 404.
    const live = await db.contact.create({
      data: { organizationId: orgId, firstName: "Live", lastName: "One", email: "live@trash.test" },
    });
    const notDeleted = await call(
      trashPost,
      makeRequest("/api/trash", {
        method: "POST",
        json: { type: "contact", id: live.id, action: "restore" },
      })
    );
    expect(notDeleted.status).toBe(404);

    // Cross-org deleted record → 404 (invisible).
    const foreign = await db.contact.create({
      data: { organizationId: otherOrgId, firstName: "Foreign", lastName: "Del", email: "f@trash.test", deletedAt: new Date(), ownerId: otherOrgAdminId },
    });
    const crossRestore = await call(
      trashPost,
      makeRequest("/api/trash", {
        method: "POST",
        json: { type: "contact", id: foreign.id, action: "restore" },
      })
    );
    expect(crossRestore.status).toBe(404);
    // Untouched in the DB.
    expect((await db.contact.findUnique({ where: { id: foreign.id } }))!.deletedAt).not.toBeNull();
    void repId;
  });
});
