import { apiHandler, ok, parseQuery } from "@/server/api";
import { requireApiUserWith, hasPermission } from "@/server/rbac";
import { db } from "@/server/db";
import { searchQuerySchema } from "@/lib/schemas";

export type SearchResults = {
  contacts: Array<{ id: string; label: string; sub: string; href: string }>;
  companies: Array<{ id: string; label: string; sub: string; href: string }>;
  leads: Array<{ id: string; label: string; sub: string; href: string }>;
  deals: Array<{ id: string; label: string; sub: string; href: string }>;
  tasks: Array<{ id: string; label: string; sub: string; href: string }>;
};

/**
 * GET /api/search?q=<term> — global search across contacts, companies,
 * leads, deals, and tasks, scoped to the caller's organization and RBAC
 * visibility rules (reps only see records they own or that are unowned).
 */
export const GET = apiHandler(async (req) => {
  const user = await requireApiUserWith("contacts:read");
  const { q, limit } = parseQuery(req, searchQuerySchema);
  const orgId = user.organizationId;
  const seeAll = hasPermission(user, "contacts:read_all");

  // Search conditions are ANDed with visibility conditions using explicit
  // nested AND/OR — a duplicated OR key in the object literal would silently
  // overwrite the visibility clause (classic RBAC-bypass footgun).
  const [contacts, companies, leads, deals, tasks] = await Promise.all([
    db.contact.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        AND: [
          {
            OR: [
              { firstName: { contains: q } },
              { lastName: { contains: q } },
              { email: { contains: q } },
            ],
          },
          ...(seeAll
            ? []
            : [{ OR: [{ ownerId: user.id }, { ownerId: null }] }]),
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        title: true,
        ownerId: true,
      },
      take: limit,
      orderBy: { updatedAt: "desc" },
    }),
    db.company.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        AND: [
          {
            OR: [{ name: { contains: q } }, { domain: { contains: q } }],
          },
          ...(seeAll
            ? []
            : [{ OR: [{ ownerId: user.id }, { ownerId: null }] }]),
        ],
      },
      select: { id: true, name: true, domain: true, ownerId: true },
      take: limit,
      orderBy: { updatedAt: "desc" },
    }),
    db.lead.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: { not: "CONVERTED" },
        AND: [
          {
            OR: [
              { firstName: { contains: q } },
              { lastName: { contains: q } },
              { email: { contains: q } },
              { companyName: { contains: q } },
            ],
          },
          ...(seeAll
            ? []
            : [
                {
                  OR: [
                    { assignedUserId: user.id },
                    { ownerId: user.id },
                    { assignedUserId: null },
                  ],
                },
              ]),
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        companyName: true,
        email: true,
        assignedUserId: true,
        ownerId: true,
      },
      take: limit,
      orderBy: { updatedAt: "desc" },
    }),
    db.deal.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: "OPEN",
        name: { contains: q },
        ...(seeAll ? {} : { OR: [{ ownerId: user.id }, { ownerId: null }] }),
      },
      select: { id: true, name: true, value: true, currency: true, ownerId: true },
      take: limit,
      orderBy: { updatedAt: "desc" },
    }),
    db.task.findMany({
      where: {
        organizationId: orgId,
        status: { in: ["PENDING", "IN_PROGRESS"] },
        title: { contains: q },
        ...(seeAll
          ? {}
          : { OR: [{ assignedUserId: user.id }, { assignedUserId: null }] }),
      },
      select: { id: true, title: true, dueAt: true, assignedUserId: true },
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const results: SearchResults = {
    contacts: contacts.map((c) => ({
      id: c.id,
      label: `${c.firstName} ${c.lastName}`,
      sub: c.title || c.email,
      href: `/contacts/${c.id}`,
    })),
    companies: companies.map((c) => ({
      id: c.id,
      label: c.name,
      sub: c.domain,
      href: `/companies/${c.id}`,
    })),
    leads: leads.map((l) => ({
      id: l.id,
      label: `${l.firstName} ${l.lastName}`,
      sub: l.companyName || l.email,
      href: `/leads?q=${encodeURIComponent(`${l.firstName} ${l.lastName}`)}`,
    })),
    deals: deals.map((d) => ({
      id: d.id,
      label: d.name,
      sub: `${d.currency} ${Math.round(d.value).toLocaleString()}`,
      href: `/pipeline?deal=${d.id}`,
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      label: t.title,
      sub: t.dueAt ? `Due ${new Date(t.dueAt).toLocaleDateString()}` : "",
      href: "/tasks",
    })),
  };

  return ok({ query: q, results });
});
