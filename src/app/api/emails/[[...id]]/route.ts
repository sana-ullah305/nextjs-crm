import { apiHandler, ok, parseQuery, parseBody, clientIp } from "@/server/api";
import { requireApiUserWith, canAccessRecord } from "@/server/rbac";
import { db } from "@/server/db";
import { sendEmail, EmailValidationError, EmailConfigError, EmailSendError } from "@/server/mailer";
import { writeAudit } from "@/server/audit";
import { emailSendSchema } from "@/lib/schemas";
import { NextResponse } from "next/server";
import { z } from "zod";

type Ctx = { params: Promise<{ id?: string[] }> };

async function resolveId(ctx: Ctx): Promise<string | null> {
  const segs = (await ctx.params) as unknown as { id?: string[] };
  return segs?.id?.[0] ?? null;
}

/**
 * GET /api/emails — sent email history for the org (admin/manager see all,
 * reps see their own). Optional ?contactId=/?leadId=/?dealId= filters.
 */
export const GET = apiHandler<Ctx>(async (req, ctx) => {
  const user = await requireApiUserWith("activities:read");
  const id = await resolveId(ctx);

  const filterSchema = z.object({
    contactId: z.string().trim().max(64).optional(),
    leadId: z.string().trim().max(64).optional(),
    dealId: z.string().trim().max(64).optional(),
  });
  const queryFilters = id
    ? ({} as Record<string, string | undefined>)
    : (parseQuery(req, filterSchema) as unknown as Record<string, string | undefined>);

  const where: Record<string, unknown> = {
    organizationId: user.organizationId,
    ...Object.fromEntries(Object.entries(queryFilters).filter(([, v]) => v)),
  };
  if (user.role === "SALES_REP") {
    // Reps see only their own sends; managers/admins see the org history.
    where.userId = user.id;
  }

  const emails = await db.sentEmail.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      contact: { select: { id: true, firstName: true, lastName: true } },
      lead: { select: { id: true, firstName: true, lastName: true } },
      deal: { select: { id: true, name: true } },
      template: { select: { id: true, name: true } },
    },
  });
  return ok({ emails });
});

/**
 * POST /api/emails — send an outbound email via org SMTP settings.
 * Records a SentEmail row + EMAIL activity + contact lastContactedAt bump.
 */
export const POST = apiHandler(async (req) => {
  const user = await requireApiUserWith("email:send");
  const body = await parseBody(req, emailSendSchema);

  // Resolve and authorize the target record (if any) so the activity is
  // attached to a record the user can actually see.
  if (body.contactId) {
    const contact = await db.contact.findFirst({
      where: { id: body.contactId, organizationId: user.organizationId, deletedAt: null },
      select: { id: true, ownerId: true, email: true, firstName: true, lastName: true },
    });
    if (!contact) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Contact not found" } },
        { status: 404 }
      );
    }
    if (!canAccessRecord(user, contact.ownerId)) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "You do not have access to this contact" } },
        { status: 403 }
      );
    }
  }
  if (body.leadId) {
    const lead = await db.lead.findFirst({
      where: { id: body.leadId, organizationId: user.organizationId, deletedAt: null },
      select: { assignedUserId: true, ownerId: true },
    });
    if (!lead) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Lead not found" } },
        { status: 404 }
      );
    }
    if (!canAccessRecord(user, lead.assignedUserId)) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "You do not have access to this lead" } },
        { status: 403 }
      );
    }
  }

  try {
    const sent = await sendEmail({
      user,
      to: { email: body.to, name: body.toName },
      subject: body.subject,
      body: body.body,
      contactId: body.contactId ?? null,
      leadId: body.leadId ?? null,
      dealId: body.dealId ?? null,
      templateId: body.templateId ?? null,
      clientIp: clientIp(req),
    });
    await writeAudit({
      organizationId: user.organizationId,
      userId: user.id,
      action: "EMAIL_SEND",
      entityType: "sentEmail",
      entityId: sent.id,
      ipAddress: clientIp(req),
      metadata: { to: body.to, subject: body.subject },
    });
    return ok(sent, { status: 201 });
  } catch (err) {
    if (err instanceof EmailValidationError) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: err.message } },
        { status: 400 }
      );
    }
    if (err instanceof EmailConfigError) {
      return NextResponse.json(
        { error: { code: "EMAIL_NOT_CONFIGURED", message: err.message } },
        { status: 409 }
      );
    }
    if (err instanceof EmailSendError) {
      return NextResponse.json(
        { error: { code: "EMAIL_SEND_FAILED", message: "Email delivery failed", details: err.message } },
        { status: 502 }
      );
    }
    throw err;
  }
});

export const DELETE = apiHandler(async () =>
  NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Not found" } },
    { status: 404 }
  )
);
