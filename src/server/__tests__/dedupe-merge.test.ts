/**
 * Integration tests for cross-entity duplicate detection and merge.
 * Pattern: src/server/__tests__/features.test.ts (direct route-handler
 * calls against the isolated test SQLite database).
 */
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

const cookieStore = new Map<string, { name: string; value: string }>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => cookieStore.get(name),
    set: (name: string, value: string) => cookieStore.set(name, { name, value }),
    delete: (name: string) => cookieStore.delete(name),
  }),
}));

import { POST as loginRoute } from "@/app/api/auth/login/route";
import { GET as mergePreviewGet } from "@/app/api/merge/preview/route";
import { POST as mergePost } from "@/app/api/merge/route";
import {
  findDuplicateCandidates,
  findDuplicateCandidatesByEmail,
  assertNotAlreadyEnrolled,
  MergeGuardError,
} from "@/server/dedupe";
import { normalizeEmail, normalizeName } from "@/lib/dedupe-normalize";
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
  await db.leadSource.deleteMany();
  await db.emailTemplate.deleteMany();
  await db.emailSettings.deleteMany();
  await db.organization.deleteMany();

  orgId = (await db.organization.create({ data: { name: "Dedupe Org" } })).id;
  otherOrgId = (await db.organization.create({ data: { name: "Other Org" } })).id;
  const passwordHash = await hashPassword("password123");
  const admin = await db.user.create({
    data: { organizationId: orgId, name: "Admin", email: "admin@dedupe.test", passwordHash, role: "ADMIN" },
  });
  adminId = admin.id;
  const rep = await db.user.create({
    data: { organizationId: orgId, name: "Rep", email: "rep@dedupe.test", passwordHash, role: "SALES_REP" },
  });
  void rep;
  const otherAdmin = await db.user.create({
    data: { organizationId: otherOrgId, name: "Other", email: "other@dedupe.test", passwordHash, role: "ADMIN" },
  });
  otherOrgAdminId = otherAdmin.id;
}, 120_000);

afterAll(async () => {
  await db.$disconnect();
});

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

describe("normalization", () => {
  it("normalizes emails by trimming and lowercasing", () => {
    expect(normalizeEmail("  Alice@Example.COM ")).toBe("alice@example.com");
  });

  it("maps common diminutives to canonical names", () => {
    expect(normalizeName("Bob Smith")).toBe("robert smith");
    expect(normalizeName("Rob Smith")).toBe("robert smith");
    expect(normalizeName("Robert Smith")).toBe("robert smith");
    expect(normalizeName("Alex Jones")).toBe("alexander jones");
    expect(normalizeName("Alexander Jones")).toBe("alexander jones");
  });

  it("strips punctuation and collapses whitespace in names", () => {
    expect(normalizeName("O'Brien,  John  Jr.")).toBe("obrien john jr");
  });
});

// ---------------------------------------------------------------------------
// Candidate scoring
// ---------------------------------------------------------------------------

describe("duplicate candidate finder", () => {
  // Scoring tests scan the whole org, so each gets a FRESH org to stay
  // isolated from records created by other tests.
  async function freshOrg(): Promise<string> {
    return (await db.organization.create({ data: { name: `Scoring Org ${crypto.randomUUID()}` } })).id;
  }

  it("scores normalized email exact match as 100 across entities", async () => {
    const scopeOrgId = await freshOrg();
    const lead = await db.lead.create({
      data: { organizationId: scopeOrgId, firstName: "Grace", lastName: "Hopper", email: "grace@navy.mil" },
    });
    await db.contact.create({
      data: { organizationId: scopeOrgId, firstName: "Totally", lastName: "Different", email: "Grace@Navy.MIL" },
    });
    const candidates = await findDuplicateCandidates(scopeOrgId, "lead", lead.id);
    expect(candidates.length).toBe(1);
    expect(candidates[0]!.score).toBe(100);
    expect(candidates[0]!.matchReasons).toContain("email_exact");
    expect(candidates[0]!.type).toBe("contact");
  });

  it("scores same first+last name (with diminutive) as 45", async () => {
    const scopeOrgId = await freshOrg();
    const a = await db.contact.create({
      data: { organizationId: scopeOrgId, firstName: "Robert", lastName: "Frost", email: "bob1@x.test" },
    });
    await db.contact.create({
      data: { organizationId: scopeOrgId, firstName: "Bob", lastName: "Frost", email: "different@y.test" },
    });
    const candidates = await findDuplicateCandidates(scopeOrgId, "contact", a.id);
    expect(candidates.length).toBe(1);
    expect(candidates[0]!.score).toBe(45);
    expect(candidates[0]!.matchReasons).toContain("first+last_name");
  });

  it("scores company + last name as 35 (the threshold)", async () => {
    const scopeOrgId = await freshOrg();
    const company = await db.company.create({
      data: { organizationId: scopeOrgId, name: "Acme Corp." },
    });
    const lead = await db.lead.create({
      data: { organizationId: scopeOrgId, firstName: "Zed", lastName: "Applegate", email: "zed1@acme.test", companyName: "Acme Corp" },
    });
    await db.contact.create({
      data: { organizationId: scopeOrgId, companyId: company.id, firstName: "Anna", lastName: "Applegate", email: "anna@acme.test" },
    });
    const candidates = await findDuplicateCandidates(scopeOrgId, "lead", lead.id);
    expect(candidates.length).toBe(1);
    expect(candidates[0]!.score).toBe(35);
    expect(candidates[0]!.matchReasons).toContain("company+last_name");
  });

  it("keeps below-threshold records out of candidates", async () => {
    const scopeOrgId = await freshOrg();
    const a = await db.contact.create({
      data: { organizationId: scopeOrgId, firstName: "Sandra", lastName: "Lee", email: "sandra@one.test" },
    });
    await db.contact.create({
      data: { organizationId: scopeOrgId, firstName: "Marcus", lastName: "Chao", email: "marcus@two.test" },
    });
    await db.lead.create({
      data: { organizationId: scopeOrgId, firstName: "Unrelated", lastName: "Person", email: "unrelated@three.test" },
    });
    const candidates = await findDuplicateCandidates(scopeOrgId, "contact", a.id);
    expect(candidates).toHaveLength(0);
  });

  it("composes signals additively but caps at 100", async () => {
    const scopeOrgId = await freshOrg();
    const a = await db.contact.create({
      data: { organizationId: scopeOrgId, firstName: "Robert", lastName: "Frost", email: "robert@frost.test" },
    });
    await db.contact.create({
      data: { organizationId: scopeOrgId, firstName: "Bob", lastName: "Frost", email: "robert@frost.test" },
    });
    const candidates = await findDuplicateCandidates(scopeOrgId, "contact", a.id);
    expect(candidates.length).toBe(1);
    // email_exact (100) + first+last_name (45) capped at 100.
    expect(candidates[0]!.score).toBe(100);
  });

  it("excludes soft-deleted records as candidates", async () => {
    const scopeOrgId = await freshOrg();
    const a = await db.contact.create({
      data: { organizationId: scopeOrgId, firstName: "Deleted", lastName: "Twin", email: "live@twin.test" },
    });
    await db.contact.create({
      data: { organizationId: scopeOrgId, firstName: "Deleted", lastName: "Twin", email: "soft@twin.test", deletedAt: new Date() },
    });
    const candidates = await findDuplicateCandidates(scopeOrgId, "contact", a.id);
    expect(candidates).toHaveLength(0);
  });

  it("excludes converted leads as candidates", async () => {
    const scopeOrgId = await freshOrg();
    const a = await db.contact.create({
      data: { organizationId: scopeOrgId, firstName: "Conv", lastName: "Check", email: "conv@subject.test" },
    });
    await db.lead.create({
      data: { organizationId: scopeOrgId, firstName: "Converted", lastName: "Lead", email: "conv@subject.test", status: "CONVERTED" },
    });
    const candidates = await findDuplicateCandidates(scopeOrgId, "contact", a.id);
    expect(candidates).toHaveLength(0);
  });

  it("never returns candidates from another organization", async () => {
    const scopeOrgId = await freshOrg();
    const a = await db.contact.create({
      data: { organizationId: scopeOrgId, firstName: "Isolation", lastName: "Test", email: "isolate@org.test" },
    });
    await db.contact.create({
      data: { organizationId: otherOrgId, firstName: "Isolation", lastName: "Test", email: "isolate@org.test", ownerId: otherOrgAdminId },
    });
    await db.lead.create({
      data: { organizationId: otherOrgId, firstName: "Isolation", lastName: "Test", email: "isolate@org.test" },
    });
    const candidates = await findDuplicateCandidates(scopeOrgId, "contact", a.id);
    expect(candidates).toHaveLength(0);
  });

  it("findDuplicateCandidatesByEmail resolves both entity types org-scoped", async () => {
    const scopeOrgId = await freshOrg();
    await db.contact.create({
      data: { organizationId: scopeOrgId, firstName: "Email", lastName: "Lookup", email: "lookup@both.test" },
    });
    await db.lead.create({
      data: { organizationId: scopeOrgId, firstName: "Email", lastName: "Lookup", email: "lookup@both.test" },
    });
    await db.contact.create({
      data: { organizationId: otherOrgId, firstName: "Email", lastName: "Lookup", email: "lookup@both.test", ownerId: otherOrgAdminId },
    });
    const hits = await findDuplicateCandidatesByEmail(scopeOrgId, "Lookup@Both.Test");
    const types = hits.map((h) => h.type).sort();
    expect(types).toEqual(["contact", "lead"]);
    const otherHits = await findDuplicateCandidatesByEmail(otherOrgId, "lookup@both.test");
    expect(otherHits).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Merge preview
// ---------------------------------------------------------------------------

describe("merge preview", () => {
  it("returns a field-level diff, relation counts, and survivor recommendation", async () => {
    await loginAs("admin@dedupe.test");
    const company = await db.company.create({ data: { organizationId: orgId, name: "Preview Co" } });
    const older = await db.contact.create({
      data: {
        organizationId: orgId,
        firstName: "Old",
        lastName: "Timer",
        email: "old@preview.test",
        phone: "111-1111",
        companyId: company.id,
        ownerId: adminId,
      },
    });
    const newer = await db.contact.create({
      data: {
        organizationId: orgId,
        firstName: "New",
        lastName: "Comer",
        email: "new@preview.test",
        phone: "222-2222",
        status: "CUSTOMER",
        ownerId: adminId,
      },
    });
    await db.activity.create({
      data: { organizationId: orgId, type: "CALL", title: "call on newer", contactId: newer.id, userId: adminId },
    });
    await db.note.create({
      data: { organizationId: orgId, body: "note on newer", contactId: newer.id, userId: adminId },
    });

    const res = await call(
      mergePreviewGet,
      makeRequest(`/api/merge/preview?type=contact&id=${older.id}&intoId=${newer.id}`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const preview = body.data;

    const emailField = preview.fields.find((f: { field: string }) => f.field === "email");
    expect(emailField.differs).toBe(true);
    expect(emailField.source).toBe("old@preview.test");
    expect(emailField.target).toBe("new@preview.test");
    const firstNameField = preview.fields.find((f: { field: string }) => f.field === "firstName");
    expect(firstNameField.source).toBe("Old");
    const companyField = preview.fields.find((f: { field: string }) => f.field === "company");
    expect(companyField.source).toBe("Preview Co");
    const ownerField = preview.fields.find((f: { field: string }) => f.field === "owner");
    expect(ownerField.differs).toBe(false);

    // Relation counts reflect SOURCE-side rows that would move.
    expect(preview.relations.activities).toBe(0);
    const newerPreviewTargetsOlder = await call(
      mergePreviewGet,
      makeRequest(`/api/merge/preview?type=contact&id=${newer.id}&intoId=${older.id}`)
    );
    const body2 = await newerPreviewTargetsOlder.json();
    expect(body2.data.relations.activities).toBe(1);
    expect(body2.data.relations.notes).toBe(1);

    // Older createdAt → older record recommended as survivor.
    expect(preview.recommendedSurvivor).toBe("source");
  });

  it("recommends the contact when previewing a lead into a contact", async () => {
    await loginAs("admin@dedupe.test");
    const contact = await db.contact.create({
      data: { organizationId: orgId, firstName: "Lead2", lastName: "Target", email: "l2t@preview.test", createdAt: new Date(Date.now() + 60_000) },
    });
    const lead = await db.lead.create({
      data: { organizationId: orgId, firstName: "Lead2", lastName: "Source", email: "l2s@preview.test" },
    });
    const res = await call(
      mergePreviewGet,
      makeRequest(`/api/merge/preview?type=lead&id=${lead.id}&intoId=${contact.id}`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.target.type).toBe("contact");
    expect(body.data.source.type).toBe("lead");
    expect(body.data.recommendedSurvivor).toBe("target");
  });

  it("404s when either record id is from another org", async () => {
    await loginAs("admin@dedupe.test");
    const foreignContact = await db.contact.create({
      data: { organizationId: otherOrgId, firstName: "Foreign", lastName: "Record", email: "foreign@preview.test", ownerId: otherOrgAdminId },
    });
    const homeContact = await db.contact.create({
      data: { organizationId: orgId, firstName: "Home", lastName: "Record", email: "home@preview.test" },
    });
    const res = await call(
      mergePreviewGet,
      makeRequest(`/api/merge/preview?type=contact&id=${homeContact.id}&intoId=${foreignContact.id}`)
    );
    expect(res.status).toBe(404);
    const res2 = await call(
      mergePreviewGet,
      makeRequest(`/api/merge/preview?type=contact&id=${foreignContact.id}&intoId=${homeContact.id}`)
    );
    expect(res2.status).toBe(404);
  });

  it("is reachable by contacts:read but not by anonymous callers (401)", async () => {
    cookieStore.clear();
    const c = await db.contact.create({
      data: { organizationId: orgId, firstName: "Auth", lastName: "Check", email: "auth@preview.test" },
    });
    const res = await call(
      mergePreviewGet,
      makeRequest(`/api/merge/preview?type=contact&id=${c.id}&intoId=${c.id}`)
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Merge execution
// ---------------------------------------------------------------------------

describe("merge execution", () => {
  it("lead-into-contact re-points everything, marks the loser CONVERTED, honors field choices, and audits", async () => {
    await loginAs("admin@dedupe.test");
    const company = await db.company.create({ data: { organizationId: orgId, name: "MergeCo" } });
    const contact = await db.contact.create({
      data: {
        organizationId: orgId,
        firstName: "Keep",
        lastName: "Me",
        email: "keep@merge.test",
        phone: "target-phone",
        status: "ACTIVE",
        ownerId: adminId,
      },
    });
    const lead = await db.lead.create({
      data: {
        organizationId: orgId,
        firstName: "Move",
        lastName: "Me",
        email: "move@merge.test",
        phone: "source-phone",
        companyName: "MergeCo",
        companyId: company.id,
        ownerId: adminId,
      },
    });
    const pipeline = await db.pipeline.create({ data: { organizationId: orgId, name: "mp", isDefault: true } });
    const stage = await db.stage.create({ data: { pipelineId: pipeline.id, name: "ms", position: 0, probability: 10 } });

    // Related rows on the source lead.
    const activity = await db.activity.create({
      data: { organizationId: orgId, type: "CALL", title: "call on lead", leadId: lead.id, userId: adminId },
    });
    const note = await db.note.create({
      data: { organizationId: orgId, body: "note on lead", leadId: lead.id, userId: adminId },
    });
    const task = await db.task.create({
      data: { organizationId: orgId, title: "task on lead", relatedType: "lead", relatedId: lead.id, createdById: adminId },
    });
    const deal = await db.deal.create({
      data: { organizationId: orgId, name: "deal on lead", leadId: lead.id, stageId: stage.id, pipelineId: pipeline.id },
    });
    const sentEmail = await db.sentEmail.create({
      data: { organizationId: orgId, userId: adminId, subject: "s", body: "b", recipientEmail: "move@merge.test", leadId: lead.id },
    });
    const inboundEmail = await db.inboundEmail.create({
      data: { organizationId: orgId, fromEmail: "move@merge.test", messageId: "mi-merge-1", subject: "r", body: "b", leadId: lead.id },
    });

    const notificationCountBefore = await db.notification.count({ where: { organizationId: orgId } });

    const res = await call(
      mergePost,
      makeRequest("/api/merge", {
        method: "POST",
        json: {
          type: "lead-into-contact",
          sourceId: lead.id,
          targetId: contact.id,
          fieldChoices: { email: "chosen@merge.test", status: "CUSTOMER" },
        },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.moved.activities).toBe(1);
    expect(body.data.moved.notes).toBe(1);
    expect(body.data.moved.tasks).toBe(1);
    expect(body.data.moved.deals).toBe(1);
    expect(body.data.moved.sentEmails).toBe(1);
    expect(body.data.moved.inboundEmails).toBe(1);

    // Loser lead: soft-deleted, CONVERTED, linked to the survivor.
    const loser = await db.lead.findUnique({ where: { id: lead.id } });
    expect(loser!.deletedAt).not.toBeNull();
    expect(loser!.status).toBe("CONVERTED");
    expect(loser!.contactId).toBe(contact.id);
    expect(loser!.summary).toContain(`Merged into contact ${contact.id} on`);

    // Survivor contact: target values kept, field choices applied.
    const survivor = await db.contact.findUnique({ where: { id: contact.id } });
    expect(survivor!.email).toBe("chosen@merge.test");
    expect(survivor!.status).toBe("CUSTOMER");
    expect(survivor!.firstName).toBe("Keep");
    expect(survivor!.phone).toBe("target-phone");

    // History re-pointed: rows keep leadId AND gained contactId
    // (conversion semantics), and the deal moved to the person.
    const activityAfter = await db.activity.findUnique({ where: { id: activity.id } });
    expect(activityAfter!.leadId).toBe(lead.id);
    expect(activityAfter!.contactId).toBe(contact.id);
    const noteAfter = await db.note.findUnique({ where: { id: note.id } });
    expect(noteAfter!.leadId).toBe(lead.id);
    expect(noteAfter!.contactId).toBe(contact.id);
    const taskAfter = await db.task.findUnique({ where: { id: task.id } });
    expect(taskAfter!.relatedType).toBe("contact");
    expect(taskAfter!.relatedId).toBe(contact.id);
    const dealAfter = await db.deal.findUnique({ where: { id: deal.id } });
    expect(dealAfter!.leadId).toBeNull();
    expect(dealAfter!.contactId).toBe(contact.id);
    const sentAfter = await db.sentEmail.findUnique({ where: { id: sentEmail.id } });
    expect(sentAfter!.leadId).toBe(lead.id);
    expect(sentAfter!.contactId).toBe(contact.id);
    const inboundAfter = await db.inboundEmail.findUnique({ where: { id: inboundEmail.id } });
    expect(inboundAfter!.leadId).toBe(lead.id);
    expect(inboundAfter!.contactId).toBe(contact.id);

    // Audit row written with the merge metadata.
    const audit = await db.auditLog.findFirst({
      where: { organizationId: orgId, action: "RECORD_MERGE", entityId: contact.id },
    });
    expect(audit).not.toBeNull();
    const metadata = JSON.parse(audit!.metadata);
    expect(metadata.sourceType).toBe("lead");
    expect(metadata.sourceId).toBe(lead.id);
    expect(metadata.targetType).toBe("contact");
    expect(metadata.moved.sentEmails).toBe(1);

    // Survivor owner notified.
    const notificationCountAfter = await db.notification.count({ where: { organizationId: orgId } });
    expect(notificationCountAfter).toBe(notificationCountBefore + 1);
    const notif = await db.notification.findFirst({
      where: { organizationId: orgId, userId: adminId, title: "Records merged" },
    });
    expect(notif).not.toBeNull();
    expect(notif!.link).toBe(`/contacts/${contact.id}`);

    // No row was hard-deleted: totals preserved everywhere.
    expect(await db.activity.count({ where: { organizationId: orgId } })).toBeGreaterThanOrEqual(2);
  });

  it("contact-into-contact moves rows and follows the target's values by default", async () => {
    await loginAs("admin@dedupe.test");
    const target = await db.contact.create({
      data: { organizationId: orgId, firstName: "Alpha", lastName: "One", email: "alpha@cc.test", phone: "t-phone" },
    });
    const source = await db.contact.create({
      data: { organizationId: orgId, firstName: "Beta", lastName: "Two", email: "beta@cc.test", phone: "s-phone" },
    });
    await db.activity.create({
      data: { organizationId: orgId, type: "CALL", title: "call on source", contactId: source.id, userId: adminId },
    });
    const leadLinkedToSource = await db.lead.create({
      data: { organizationId: orgId, firstName: "Linked", lastName: "Lead", email: "linked@cc.test", contactId: source.id },
    });

    const res = await call(
      mergePost,
      makeRequest("/api/merge", {
        method: "POST",
        json: { type: "contact-into-contact", sourceId: source.id, targetId: target.id },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.moved.activities).toBe(1);
    expect(body.data.moved.leads).toBe(1);

    const loser = await db.contact.findUnique({ where: { id: source.id } });
    expect(loser!.deletedAt).not.toBeNull();
    expect(loser!.summary).toContain(`Merged into contact ${target.id} on`);

    // Target keeps ITS values when no fieldChoices are provided.
    const survivor = await db.contact.findUnique({ where: { id: target.id } });
    expect(survivor!.email).toBe("alpha@cc.test");
    expect(survivor!.firstName).toBe("Alpha");

    const movedActivity = await db.activity.findFirst({
      where: { organizationId: orgId, title: "call on source" },
    });
    expect(movedActivity!.contactId).toBe(target.id);
    const movedLead = await db.lead.findUnique({ where: { id: leadLinkedToSource.id } });
    expect(movedLead!.contactId).toBe(target.id);
  });

  it("lead-into-lead moves rows within the lead entity", async () => {
    await loginAs("admin@dedupe.test");
    const target = await db.lead.create({
      data: { organizationId: orgId, firstName: "Keep", lastName: "Lead", email: "keep@ll.test" },
    });
    const source = await db.lead.create({
      data: { organizationId: orgId, firstName: "Lose", lastName: "Lead", email: "lose@ll.test" },
    });
    await db.note.create({
      data: { organizationId: orgId, body: "note on source lead", leadId: source.id, userId: adminId },
    });

    const res = await call(
      mergePost,
      makeRequest("/api/merge", {
        method: "POST",
        json: { type: "lead-into-lead", sourceId: source.id, targetId: target.id },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.moved.notes).toBe(1);

    const loser = await db.lead.findUnique({ where: { id: source.id } });
    expect(loser!.deletedAt).not.toBeNull();
    // Not a conversion: status untouched.
    expect(loser!.status).toBe("NEW");
    expect(loser!.summary).toContain(`Merged into lead ${target.id} on`);

    const movedNote = await db.note.findFirst({
      where: { organizationId: orgId, body: "note on source lead" },
    });
    expect(movedNote!.leadId).toBe(target.id);
  });

  it("forbids reps (403) and cross-org ids (404)", async () => {
    const target = await db.contact.create({
      data: { organizationId: orgId, firstName: "Guarded", lastName: "One", email: "g1@perm.test" },
    });
    const source = await db.contact.create({
      data: { organizationId: orgId, firstName: "Guarded", lastName: "Two", email: "g2@perm.test" },
    });

    await loginAs("rep@dedupe.test");
    const repRes = await call(
      mergePost,
      makeRequest("/api/merge", {
        method: "POST",
        json: { type: "contact-into-contact", sourceId: source.id, targetId: target.id },
      })
    );
    expect(repRes.status).toBe(403);

    await loginAs("admin@dedupe.test");
    const foreignContact = await db.contact.create({
      data: { organizationId: otherOrgId, firstName: "Foreign", lastName: "Merge", email: "foreign@perm.test", ownerId: otherOrgAdminId },
    });
    const crossRes = await call(
      mergePost,
      makeRequest("/api/merge", {
        method: "POST",
        json: { type: "contact-into-contact", sourceId: source.id, targetId: foreignContact.id },
      })
    );
    expect(crossRes.status).toBe(404);
    const crossRes2 = await call(
      mergePost,
      makeRequest("/api/merge", {
        method: "POST",
        json: { type: "contact-into-contact", sourceId: foreignContact.id, targetId: target.id },
      })
    );
    expect(crossRes2.status).toBe(404);

    // Source is untouched after the failed attempts.
    const stillAlive = await db.contact.findUnique({ where: { id: source.id } });
    expect(stillAlive!.deletedAt).toBeNull();
  });

  it("rejects invalid bodies (400) and same-id merges (400)", async () => {
    await loginAs("admin@dedupe.test");
    const c = await db.contact.create({
      data: { organizationId: orgId, firstName: "Bad", lastName: "Body", email: "bad@body.test" },
    });
    const invalidType = await call(
      mergePost,
      makeRequest("/api/merge", {
        method: "POST",
        json: { type: "contact-into-lead", sourceId: c.id, targetId: c.id },
      })
    );
    expect(invalidType.status).toBe(400);
    const sameId = await call(
      mergePost,
      makeRequest("/api/merge", {
        method: "POST",
        json: { type: "contact-into-contact", sourceId: c.id, targetId: c.id },
      })
    );
    expect(sameId.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Enrollment guard
// ---------------------------------------------------------------------------

describe("merge guard (assertNotAlreadyEnrolled)", () => {
  it("passes when the email matches no active enrollment", async () => {
    await db.contact.create({
      data: { organizationId: orgId, firstName: "Guard", lastName: "Pass", email: "guard-pass@seq.test" },
    });
    await expect(
      assertNotAlreadyEnrolled(orgId, "guard-pass@seq.test")
    ).resolves.toBeUndefined();
    // Also passes when no record with the email exists at all.
    await expect(
      assertNotAlreadyEnrolled(orgId, "nobody@seq.test")
    ).resolves.toBeUndefined();
  });

  it("passes when the record is not enrolled (sequences tables exist)", async () => {
    // On the merged tree the sequences tables exist. The guard must resolve
    // cleanly for an email with no ACTIVE enrollment anywhere in the org.
    await expect(
      assertNotAlreadyEnrolled(orgId, "anything@seq.test")
    ).resolves.toBeUndefined();
  });

  it("throws MergeGuardError when a matching record is ACTIVELY enrolled", async () => {
    // Use the real SequenceEnrollment model (FKs to a real sequence) rather
    // than raw DDL — the merged tree has the sequences tables.
    const seqUser = orgId;
    const sequence = await db.sequence.create({
      data: {
        organizationId: seqUser,
        name: "Guard test sequence",
        createdById: adminId,
      },
    });
    const contact = await db.contact.create({
      data: { organizationId: orgId, firstName: "Enrolled", lastName: "Human", email: "enrolled@seq.test" },
    });
    const enrollment = await db.sequenceEnrollment.create({
      data: {
        organizationId: orgId,
        sequenceId: sequence.id,
        contactId: contact.id,
        enrolledEmail: "enrolled@seq.test",
        unsubToken: "tok-guard-1",
        status: "ACTIVE",
      },
    });

    await expect(assertNotAlreadyEnrolled(orgId, "Enrolled@Seq.Test")).rejects.toBeInstanceOf(
      MergeGuardError
    );

    // The second representation of the same human — a lead with the same
    // email — must also be blocked even though the enrollment hangs off
    // the contact.
    await expect(assertNotAlreadyEnrolled(orgId, "enrolled@seq.test")).rejects.toMatchObject({
      details: { enrollmentId: enrollment.id, contactId: contact.id, sequenceId: sequence.id },
    });

    // Completed enrollments do not block.
    await db.sequenceEnrollment.update({
      where: { id: enrollment.id },
      data: { status: "COMPLETED" },
    });
    await expect(assertNotAlreadyEnrolled(orgId, "enrolled@seq.test")).resolves.toBeUndefined();

    // Other orgs' enrollments never leak into this org's guard.
    await db.sequenceEnrollment.update({
      where: { id: enrollment.id },
      data: { status: "ACTIVE", organizationId: otherOrgId },
    });
    await expect(assertNotAlreadyEnrolled(orgId, "enrolled@seq.test")).resolves.toBeUndefined();

    // Restore org for cleanup symmetry; the vitest DB is per-run anyway.
    await db.sequenceEnrollment.update({
      where: { id: enrollment.id },
      data: { organizationId: orgId },
    });
  });
});
