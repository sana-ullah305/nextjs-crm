import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { db } from "@/server/db";

const reportQuerySchema = z.object({
  period: z.enum(["month", "quarter", "year"]).default("month"),
  format: z.enum(["json", "csv"]).default("json"),
});

type ReportRow = Record<string, string | number>;

function csvEscape(v: string | number): string {
  const cell = String(v ?? "");
  const quoted = /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
  return /^[=+\-@]/.test(quoted) ? `'${quoted}` : quoted;
}

function toCsv(rows: ReportRow[], columns: Array<{ key: string; header: string }>): string {
  const header = columns.map((c) => c.header).join(",");
  const body = rows.map((r) => columns.map((c) => csvEscape(r[c.key] ?? "")).join(",")).join("\n");
  return [header, body].join("\n");
}

function periodStart(period: string): Date {
  const now = new Date();
  if (period === "year") return new Date(now.getFullYear() - 1, now.getMonth(), 1);
  if (period === "quarter") return new Date(now.getFullYear(), now.getMonth() - 3, 1);
  return new Date(now.getFullYear(), now.getMonth() - 1, 1);
}

export const GET = apiHandler(async (req) => {
  const user = await requireApiUserWith("reports:read");
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const q = reportQuerySchema.parse(params);
  const orgId = user.organizationId;
  const start = periodStart(q.period);

  const [wonDeals, lostDeals, leads, contacts, users, sources] = await Promise.all([
    db.deal.findMany({
      where: { organizationId: orgId, deletedAt: null, status: "WON", wonAt: { gte: start } },
      select: { id: true, value: true, wonAt: true, ownerId: true, sourceId: true },
    }),
    db.deal.findMany({
      where: { organizationId: orgId, deletedAt: null, status: "LOST", lostAt: { gte: start } },
      select: { id: true, value: true, lostReason: true },
    }),
    db.lead.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: { id: true, status: true, sourceId: true, createdAt: true, convertedAt: true },
    }),
    db.contact.findMany({
      where: { organizationId: orgId, deletedAt: null, createdAt: { gte: start } },
      select: { id: true, createdAt: true },
    }),
    db.user.findMany({
      where: { organizationId: orgId, isActive: true },
      select: {
        id: true,
        name: true,
        avatarColor: true,
        ownedDeals: { where: { deletedAt: null }, select: { id: true, status: true, value: true } },
        assignedLeads: { where: { deletedAt: null }, select: { id: true, status: true } },
      },
    }),
    db.leadSource.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true },
    }),
  ]);

  const now = new Date();
  const spanMonths = q.period === "year" ? 13 : q.period === "quarter" ? 4 : 2;
  const months: { month: string; revenue: number; dealsWon: number }[] = [];
  for (let i = spanMonths - 1; i >= 0; i--) {
    const s = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const e = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const won = wonDeals.filter((d) => d.wonAt && d.wonAt >= s && d.wonAt < e);
    months.push({
      month: s.toLocaleString("en-US", { month: "short", year: "2-digit" }),
      revenue: won.reduce((sum, d) => sum + d.value, 0),
      dealsWon: won.length,
    });
  }

  const teamPerformance = users.map((u) => {
    const owned = u.ownedDeals;
    const won = owned.filter((d) => d.status === "WON");
    const lost = owned.filter((d) => d.status === "LOST");
    const open = owned.filter((d) => d.status === "OPEN");
    return {
      userId: u.id,
      name: u.name,
      avatarColor: u.avatarColor,
      wonCount: won.length,
      wonValue: won.reduce((s, d) => s + d.value, 0),
      lostCount: lost.length,
      openCount: open.length,
      openValue: open.reduce((s, d) => s + d.value, 0),
      winRate:
        won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0,
      leadsAssigned: u.assignedLeads.length,
      leadsConverted: u.assignedLeads.filter((l) => l.status === "CONVERTED").length,
    };
  });

  const funnel = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED"].map((status) => ({
    status,
    count: leads.filter((l) => l.status === status).length,
  }));

  const sourceMap = new Map(sources.map((s) => [s.id, s.name]));
  const acquisitionBySource = sources
    .map((s) => {
      const rows = leads.filter((l) => l.sourceId === s.id);
      return {
        source: s.name,
        leads: rows.length,
        converted: rows.filter((l) => l.status === "CONVERTED").length,
      };
    })
    .filter((s) => s.leads > 0 || sourceMap.size === 0)
    .sort((a, b) => b.leads - a.leads);
  void sourceMap;

  const totalLeads = leads.length;
  const convertedLeads = leads.filter((l) => l.status === "CONVERTED").length;

  const summary = {
    revenue: wonDeals.reduce((s, d) => s + d.value, 0),
    dealsWon: wonDeals.length,
    dealsLost: lostDeals.length,
    winRate:
      wonDeals.length + lostDeals.length > 0
        ? Math.round((wonDeals.length / (wonDeals.length + lostDeals.length)) * 100)
        : 0,
    totalLeads,
    convertedLeads,
    leadConversionRate: totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0,
    newContacts: contacts.length,
  };

  if (q.format === "csv") {
    const rows: ReportRow[] = [];
    rows.push({ section: "SUMMARY", metric: "Revenue", value: summary.revenue });
    rows.push({ section: "SUMMARY", metric: "Deals Won", value: summary.dealsWon });
    rows.push({ section: "SUMMARY", metric: "Win Rate %", value: summary.winRate });
    rows.push({ section: "SUMMARY", metric: "Total Leads", value: summary.totalLeads });
    rows.push({ section: "SUMMARY", metric: "Lead Conversion %", value: summary.leadConversionRate });
    for (const m of months) rows.push({ section: "MONTHLY", metric: m.month, value: m.revenue });
    for (const t of teamPerformance) rows.push({ section: "TEAM", metric: t.name, value: t.wonValue });
    for (const s of acquisitionBySource) rows.push({ section: "SOURCE", metric: s.source, value: s.leads });
    const csv = toCsv(rows, [
      { key: "section", header: "Section" },
      { key: "metric", header: "Metric" },
      { key: "value", header: "Value" },
    ]);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="report-${q.period}-${Date.now()}.csv"`,
      },
    });
  }

  return ok({ summary, months, teamPerformance, funnel, acquisitionBySource });
});
