import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  apiHandler,
  ok,
  parseBody,
  parseQuery,
  ApiNotFoundError,
  ApiValidationError,
  clientIp,
} from "@/server/api";
import { requireApiUserWith, canAccessRecord } from "@/server/rbac";
import {
  sequenceCreateSchema,
  sequenceUpdateSchema,
  sequenceStepsReplaceSchema,
  sequenceEnrollSchema,
} from "@/lib/schemas";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { assertNotAlreadyEnrolled, MergeGuardError } from "@/server/dedupe-guard-stub";
import { buildUnsubscribeUrl } from "@/server/sequences";
import { randomBytes } from "node:crypto";

type Ctx = { params: Promise<{ id?: string[] }> };

async function resolvePath(ctx: Ctx): Promise<string[]> {
  const parts = ((await ctx?.params) ?? undefined) as unknown as { id?: string[] } | undefined;
  return parts?.id ?? [];
}

// Fragment identifiers for the nested resources that share this catch-all:
// /api/sequences/:id/enroll, /:id/enrollments, /enrollments/:id.
function splitPath(segs: string[]): { id: string | null; action: string | null; extra: string | null } {
  const [id, action, extra] = segs;
  return { id: id ?? null, action: action ?? null, extra: extra ?? null };
}

const enrollmentsQuerySchema = z.object({
  status: z.enum(["ACTIVE", "COMPLETED", "STOPPED", "UNSUBSCRIBED"]).optional(),
});

/**
 * GET /api/sequences — list the org's sequences with steps and active
 * enrollment counts.
 */
async function listSequences() {
  const user = await requireApiUserWith("settings:read");
  const sequences = await db.sequence.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { createdAt: "desc" },
    include: {
      steps: { orderBy: { position: "asc" } },
      _count: {
        select: {
          enrollments: {
            where: { status: "ACTIVE" },
          },
        },
      },
    },
  });
  return ok({
    sequences,
  });
}

async function getSequence(id: string) {
  const user = await requireApiUserWith("settings:read");
  const sequence = await db.sequence.findFirst({
    where: { id, organizationId: user.organizationId },
    include: { steps: { orderBy: { position: "asc" } } },
  });
  if (!sequence) throw new ApiNotFoundError("Sequence not found");
  return ok(sequence);
}

/** Create steps rows for a sequence from the validated steps payload. */
async function createSteps(
  sequenceId: string,
  steps: z.infer<typeof sequenceCreateSchema>["steps"]
) {
  await db.sequenceStep.createMany({
    data: steps.map((step, index) => ({
      sequenceId,
      position: step.position ?? index,
      delayHours: step.delayHours,
      subjectTemplate: step.subjectTemplate,
      bodyTemplate: step.bodyTemplate,
    })),
  });
}

async function createSequence(req: NextRequest) {
  const user = await requireApiUserWith("settings:manage");
  const body = await parseBody(req, sequenceCreateSchema);

  const positions = new Set(body.steps.map((s) => s.position ?? -1));
  if (positions.size !== body.steps.length) {
    throw new ApiValidationError([
      { path: ["steps"], message: "Step positions must be unique when provided" },
    ]);
  }

  const sequence = await db.sequence.create({
    data: {
      organizationId: user.organizationId,
      name: body.name,
      description: body.description,
      isActive: true,
      createdById: user.id,
    },
  });
  await createSteps(sequence.id, body.steps);

  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "SEQUENCE_CREATE",
    entityType: "sequence",
    entityId: sequence.id,
    ipAddress: clientIp(req),
    metadata: { name: body.name, steps: body.steps.length },
  });

  const full = await db.sequence.findUnique({
    where: { id: sequence.id },
    include: { steps: { orderBy: { position: "asc" } } },
  });
  return ok(full, { status: 201 });
}

async function updateSequence(req: NextRequest, id: string) {
  const user = await requireApiUserWith("settings:manage");
  const body = await parseBody(req, sequenceUpdateSchema);
  const sequence = await db.sequence.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { id: true },
  });
  if (!sequence) throw new ApiNotFoundError("Sequence not found");

  const updated = await db.sequence.update({
    where: { id: sequence.id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    },
    include: { steps: { orderBy: { position: "asc" } } },
  });

  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "SEQUENCE_UPDATE",
    entityType: "sequence",
    entityId: sequence.id,
    ipAddress: clientIp(req),
    metadata: { ...body },
  });
  return ok(updated);
}

/**
 * PATCH /api/sequences/:id/steps — replace the steps array wholesale. Active
 * enrollments keep their currentStep index; the scheduler stops enrollments
 * whose currentStep no longer resolves ("step missing").
 */
async function replaceSteps(req: NextRequest, id: string) {
  const user = await requireApiUserWith("settings:manage");
  const body = await parseBody(req, sequenceStepsReplaceSchema);
  const sequence = await db.sequence.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { id: true },
  });
  if (!sequence) throw new ApiNotFoundError("Sequence not found");

  const positions = new Set(body.steps.map((s) => s.position ?? -1));
  if (positions.size !== body.steps.length) {
    throw new ApiValidationError([
      { path: ["steps"], message: "Step positions must be unique when provided" },
    ]);
  }

  await db.$transaction([
    db.sequenceStep.deleteMany({ where: { sequenceId: sequence.id } }),
    db.sequenceStep.createMany({
      data: body.steps.map((step, index) => ({
        sequenceId: sequence.id,
        position: step.position ?? index,
        delayHours: step.delayHours,
        subjectTemplate: step.subjectTemplate,
        bodyTemplate: step.bodyTemplate,
      })),
    }),
  ]);

  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "SEQUENCE_STEPS_REPLACED",
    entityType: "sequence",
    entityId: sequence.id,
    ipAddress: clientIp(req),
    metadata: { steps: body.steps.length },
  });

  const full = await db.sequence.findUnique({
    where: { id: sequence.id },
    include: { steps: { orderBy: { position: "asc" } } },
  });
  return ok(full);
}

/**
 * DELETE /api/sequences/:id — soft-only when the sequence has ever had
 * enrollments (isActive = false); hard delete only with zero enrollments ever.
 */
async function deleteSequence(req: NextRequest, id: string) {
  const user = await requireApiUserWith("settings:manage");
  const sequence = await db.sequence.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { id: true, name: true },
  });
  if (!sequence) throw new ApiNotFoundError("Sequence not found");

  const enrollmentCount = await db.sequenceEnrollment.count({
    where: { sequenceId: sequence.id },
  });
  if (enrollmentCount > 0) {
    await db.sequence.update({
      where: { id: sequence.id },
      data: { isActive: false },
    });
    await writeAudit({
      organizationId: user.organizationId,
      userId: user.id,
      action: "SEQUENCE_ARCHIVE",
      entityType: "sequence",
      entityId: sequence.id,
      ipAddress: clientIp(req),
      metadata: { name: sequence.name, enrollments: enrollmentCount },
    });
    return ok({ archived: true });
  }

  await db.sequence.delete({ where: { id: sequence.id } });
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "SEQUENCE_DELETE",
    entityType: "sequence",
    entityId: sequence.id,
    ipAddress: clientIp(req),
    metadata: { name: sequence.name },
  });
  return ok({ archived: false, deleted: true });
}

// ---- Enrollment ----

/** POST /api/sequences/:id/enroll — enroll one contact or lead. */
async function enrollRecord(req: NextRequest, sequenceId: string) {
  // Any role may enroll records they can access; the per-record check below
  // enforces ownership for reps.
  const user = await requireApiUserWith("leads:update");
  const body = await parseBody(req, sequenceEnrollSchema);

  const sequence = await db.sequence.findFirst({
    where: { id: sequenceId, organizationId: user.organizationId, isActive: true },
    select: { id: true, name: true },
  });
  if (!sequence) throw new ApiNotFoundError("Sequence not found or inactive");

  const firstStep = await db.sequenceStep.findFirst({
    where: { sequenceId: sequence.id },
    orderBy: { position: "asc" },
    select: { position: true, delayHours: true },
  });
  if (!firstStep) throw new ApiNotFoundError("Sequence has no steps");

  let email: string;
  let contactId: string | null = null;
  let leadId: string | null = null;
  if (body.contactId) {
    const contact = await db.contact.findFirst({
      where: { id: body.contactId, organizationId: user.organizationId, deletedAt: null },
      select: { id: true, email: true, ownerId: true },
    });
    if (!contact) throw new ApiNotFoundError("Contact not found");
    if (!canAccessRecord(user, contact.ownerId)) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "You do not have access to this contact" } },
        { status: 403 }
      );
    }
    email = contact.email;
    contactId = contact.id;
  } else {
    const lead = await db.lead.findFirst({
      where: { id: body.leadId!, organizationId: user.organizationId, deletedAt: null },
      select: { id: true, email: true, assignedUserId: true, ownerId: true },
    });
    if (!lead) throw new ApiNotFoundError("Lead not found");
    if (!canAccessRecord(user, lead.assignedUserId)) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "You do not have access to this lead" } },
        { status: 403 }
      );
    }
    email = lead.email;
    leadId = lead.id;
  }

  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Record has no email address" } },
      { status: 400 }
    );
  }

  // Enrollment guard (dedupe stub in this workspace; real dedupe.ts at merge).
  try {
    await assertNotAlreadyEnrolled(user.organizationId, normalized);
  } catch (err) {
    if (err instanceof MergeGuardError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: 409 }
      );
    }
    throw err;
  }

  const unsubToken = randomBytes(32).toString("hex");
  const nextSendAt = new Date(Date.now() + firstStep.delayHours * 60 * 60 * 1000);
  try {
    const enrollment = await db.sequenceEnrollment.create({
      data: {
        organizationId: user.organizationId,
        sequenceId: sequence.id,
        contactId,
        leadId,
        enrolledEmail: normalized,
        currentStep: firstStep.position,
        nextSendAt,
        status: "ACTIVE",
        responderUserId: user.id,
        unsubToken,
      },
      include: {
        sequence: { select: { id: true, name: true } },
      },
    });

    await writeAudit({
      organizationId: user.organizationId,
      userId: user.id,
      action: "SEQUENCE_ENROLL",
      entityType: "sequenceEnrollment",
      entityId: enrollment.id,
      ipAddress: clientIp(req),
      metadata: {
        sequenceId: sequence.id,
        contactId,
        leadId,
        email: normalized,
        unsubUrl: buildUnsubscribeUrl(unsubToken),
      },
    });
    return ok(enrollment, { status: 201 });
  } catch (err) {
    // The (sequenceId, contactId)/(sequenceId, leadId) DB unique is a safety
    // net: a P2002 here means an ACTIVE enrollment already exists for this
    // record (the race window between the guard and the create).
    if (
      err instanceof Error &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: { code: "ALREADY_ENROLLED", message: "This record is already enrolled in this sequence" } },
        { status: 409 }
      );
    }
    throw err;
  }
}

/**
 * GET /api/sequences/:id/enrollments?status= — enrollments for a sequence.
 * Reps see only rows whose contact.ownerId / lead.assignedUserId is theirs
 * or unassigned; managers/admins see all.
 */
async function listEnrollments(req: NextRequest, sequenceId: string) {
  const user = await requireApiUserWith("leads:update");
  const q = parseQuery(req, enrollmentsQuerySchema);
  const sequence = await db.sequence.findFirst({
    where: { id: sequenceId, organizationId: user.organizationId },
    select: { id: true },
  });
  if (!sequence) throw new ApiNotFoundError("Sequence not found");

  const where: Record<string, unknown> = {
    organizationId: user.organizationId,
    sequenceId: sequence.id,
    ...(q.status ? { status: q.status } : {}),
  };
  if (user.role === "SALES_REP") {
    where.OR = [
      { contact: { ownerId: user.id } },
      { contact: { ownerId: null } },
      { lead: { assignedUserId: user.id } },
      { lead: { assignedUserId: null } },
    ];
  }

  const enrollments = await db.sequenceEnrollment.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      organizationId: true,
      sequenceId: true,
      contactId: true,
      leadId: true,
      enrolledEmail: true,
      currentStep: true,
      nextSendAt: true,
      status: true,
      stoppedReason: true,
      responderUserId: true,
      createdAt: true,
      updatedAt: true,
      contact: { select: { id: true, firstName: true, lastName: true, ownerId: true } },
      lead: { select: { id: true, firstName: true, lastName: true, assignedUserId: true } },
    },
  });
  return ok({ enrollments });
}

/** DELETE /api/sequences/enrollments/:id — cancel an enrollment. */
async function cancelEnrollment(req: NextRequest, enrollmentId: string) {
  const user = await requireApiUserWith("leads:update");
  const enrollment = await db.sequenceEnrollment.findFirst({
    where: { id: enrollmentId, organizationId: user.organizationId },
    select: {
      id: true,
      status: true,
      contactId: true,
      leadId: true,
      contact: { select: { ownerId: true } },
      lead: { select: { assignedUserId: true } },
    },
  });
  if (!enrollment) throw new ApiNotFoundError("Enrollment not found");

  const ownerId = enrollment.contactId
    ? enrollment.contact?.ownerId
    : enrollment.lead?.assignedUserId ?? null;
  if (!canAccessRecord(user, ownerId)) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "You do not have access to this enrollment" } },
      { status: 403 }
    );
  }

  const result = await db.sequenceEnrollment.updateMany({
    where: { id: enrollment.id, status: "ACTIVE" },
    data: { status: "STOPPED", stoppedReason: "cancelled by user", nextSendAt: null },
  });
  if (result.count === 0) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Enrollment is not active" } },
      { status: 400 }
    );
  }

  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "SEQUENCE_UNENROLL",
    entityType: "sequenceEnrollment",
    entityId: enrollment.id,
    ipAddress: clientIp(req),
    metadata: { reason: "cancelled by user" },
  });
  return ok({ cancelled: result.count });
}

// ---- Routing ----

export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const segs = await resolvePath(ctx);
  const { id, action } = splitPath(segs);
  if (!id) return listSequences();
  if (!action) return getSequence(id);
  if (action === "enrollments") return listEnrollments(req, id);
  throw new ApiNotFoundError("Unknown route");
});

export const POST = apiHandler<Ctx>(async (req, ctx) => {
  const segs = await resolvePath(ctx);
  const { id, action } = splitPath(segs);
  if (!id && !action) return createSequence(req);
  if (id && action === "enroll") return enrollRecord(req, id);
  throw new ApiNotFoundError("Unknown route");
});

export const PATCH = apiHandler<Ctx>(async (req, ctx) => {
  const segs = await resolvePath(ctx);
  const { id, action } = splitPath(segs);
  if (id && action === "steps") return replaceSteps(req, id);
  if (id && !action) return updateSequence(req, id);
  throw new ApiNotFoundError("Unknown route");
});

export const DELETE = apiHandler<Ctx>(async (req, ctx) => {
  const segs = await resolvePath(ctx);
  const { id, action } = splitPath(segs);
  // DELETE /api/sequences/enrollments/:id (literal first segment) vs
  // DELETE /api/sequences/:id (a sequence id).
  if (id === "enrollments" && action) return cancelEnrollment(req, action);
  if (id && !action) return deleteSequence(req, id);
  throw new ApiNotFoundError("Unknown route");
});
