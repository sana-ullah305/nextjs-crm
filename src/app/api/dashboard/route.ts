import { apiHandler, ok } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { db } from "@/server/db";

export const GET = apiHandler(async () => {
  const user = await requireApiUserWith("contacts:read");
  const orgId = user.organizationId;
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalContacts,
    newContacts,
    totalCompanies,
    newLeads30d,
    openLeads,
    convertedLeads,
    openDeals,
    wonDeals30d,
    pipelineValue,
    weightedPipeline,
    recentActivities,
    upcomingTasks,
    topPerformers,
    wonAll6m,
    leadsByStatusRaw,
  ] = await Promise.all([
    db.contact.count({ where: { organizationId: orgId, deletedAt: null } }),
    db.contact.count({
      where: { organizationId: orgId, deletedAt: null, createdAt: { gte: monthAgo } },
    }),
    db.company.count({ where: { organizationId: orgId, deletedAt: null } }),
    db.lead.count({
      where: { organizationId: orgId, deletedAt: null, createdAt: { gte: monthAgo } },
    }),
    db.lead.count({
      where: { organizationId: orgId, deletedAt: null, status: { in: ["NEW", "CONTACTED", "QUALIFIED"] } },
    }),
    db.lead.count({ where: { organizationId: orgId, deletedAt: null, status: "CONVERTED" } }),
    db.deal.count({ where: { organizationId: orgId, deletedAt: null, status: "OPEN" } }),
    db.deal.findMany({
      where: { organizationId: orgId, deletedAt: null, status: "WON", wonAt: { gte: monthAgo } },
      select: { value: true },
    }),
    db.deal.aggregate({
      where: { organizationId: orgId, deletedAt: null, status: "OPEN" },
      _sum: { value: true },
    }),
    db.deal.findMany({
      where: { organizationId: orgId, deletedAt: null, status: "OPEN" },
      select: { value: true, probability: true },
    }),
    db.activity.findMany({
      where: { organizationId: orgId },
      orderBy: { occurredAt: "desc" },
      take: 15,
      include: { user: { select: { id: true, name: true, avatarColor: true } } },
    }),
    db.task.findMany({
      where: {
        organizationId: orgId,
        status: { in: ["PENDING", "IN_PROGRESS"] },
        OR: [{ dueAt: null }, { dueAt: { lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) } }],
      },
      orderBy: [{ dueAt: "asc" }, { priority: "asc" }],
      take: 8,
      include: { assignedUser: { select: { id: true, name: true, avatarColor: true } } },
    }),
    db.user.findMany({
      where: { organizationId: orgId, isActive: true },
      select: {
        id: true,
        name: true,
        avatarColor: true,
        ownedDeals: {
          where: { deletedAt: null, status: "WON", wonAt: { gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) } },
          select: { value: true },
        },
      },
    }),
    db.deal.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: "WON",
        wonAt: { gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) },
      },
      select: { value: true, wonAt: true },
    }),
    db.lead.groupBy({
      by: ["status"],
      where: { organizationId: orgId, deletedAt: null },
      _count: true,
    }),
  ]);

  const trend: { month: string; revenue: number; deals: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const inMonth = wonAll6m.filter((d) => d.wonAt && d.wonAt >= start && d.wonAt < end);
    trend.push({
      month: start.toLocaleString("en-US", { month: "short" }),
      revenue: inMonth.reduce((s, d) => s + d.value, 0),
      deals: inMonth.length,
    });
  }

  const performers = topPerformers
    .map((u) => ({
      id: u.id,
      name: u.name,
      avatarColor: u.avatarColor,
      wonValue: u.ownedDeals.reduce((s: number, d: { value: number }) => s + d.value, 0),
      wonCount: u.ownedDeals.length,
    }))
    .sort((a, b) => b.wonValue - a.wonValue)
    .slice(0, 5);

  const conversionRate =
    openLeads + convertedLeads > 0
      ? Math.round((convertedLeads / (openLeads + convertedLeads)) * 100)
      : 0;

  return ok({
    kpis: {
      totalContacts,
      newContacts,
      totalCompanies,
      newLeads30d,
      openLeads,
      convertedLeads,
      openDeals,
      wonDeals30dCount: wonDeals30d.length,
      revenue30d: wonDeals30d.reduce((s, d) => s + d.value, 0),
      pipelineValue: pipelineValue._sum.value ?? 0,
      weightedPipeline: Math.round(
        weightedPipeline.reduce((s, d) => s + (d.value * d.probability) / 100, 0)
      ),
      conversionRate,
    },
    trend,
    leadsByStatus: leadsByStatusRaw.map((l) => ({ status: l.status, count: l._count })),
    recentActivities,
    upcomingTasks,
    topPerformers: performers,
  });
});
