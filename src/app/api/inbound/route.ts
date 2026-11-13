import { z } from "zod";
import { apiHandler, ok, parseBody, parseQuery } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { db } from "@/server/db";

const listQuerySchema = z.object({
  contactId: z.string().trim().max(64).optional(),
  leadId: z.string().trim().max(64).optional(),
  status: z.enum(["UNREAD", "READ", "IGNORED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

const markReadSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(64)).min(1).max(200),
});

/**
 * GET /api/inbound — stored inbound replies for the org, newest first.
 * Optional ?contactId=/?leadId=/?status= filters plus paging. Admins and
 * managers see everything; reps see only rows whose matched contact.ownerId
 * or lead.assignedUserId is theirs or null (matches the emails route's use
 * of activities:read for the mail surface).
 */
export const GET = apiHandler(async (req) => {
  const user = await requireApiUserWith("activities:read");
  const q = parseQuery(req, listQuerySchema);

  const where: Record<string, unknown> = {
    organizationId: user.organizationId,
    ...(q.contactId ? { contactId: q.contactId } : {}),
    ...(q.leadId ? { leadId: q.leadId } : {}),
    ...(q.status ? { status: q.status } : {}),
  };
  if (user.role === "SALES_REP") {
    // Reps see only rows whose matched contact.ownerId or lead.assignedUserId
    // is theirs or null (unowned records are shared, per list-scoping rules).
    where.OR = [
      { contact: { ownerId: user.id } },
      { contact: { ownerId: null } },
      { lead: { assignedUserId: user.id } },
      { lead: { assignedUserId: null } },
    ];
  }

  const [total, emails] = await Promise.all([
    db.inboundEmail.count({ where }),
    db.inboundEmail.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, ownerId: true } },
        lead: { select: { id: true, firstName: true, lastName: true, assignedUserId: true } },
      },
    }),
  ]);
  return ok({ emails, total, page: q.page, pageSize: q.pageSize });
});

/**
 * POST /api/inbound — mark stored replies READ (unread → read semantics).
 * Org-scoped: ids from other orgs simply match no rows. Reuse activities:read
 * like the GET route and the emails route (a reader of the mail surface may
 * clear its unread badges).
 */
export const POST = apiHandler(async (req) => {
  const user = await requireApiUserWith("activities:read");
  const body = await parseBody(req, markReadSchema);

  const result = await db.inboundEmail.updateMany({
    where: {
      organizationId: user.organizationId,
      id: { in: body.ids },
      status: "UNREAD",
    },
    data: { status: "READ" },
  });
  return ok({ updated: result.count });
});
