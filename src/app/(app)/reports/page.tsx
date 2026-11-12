"use client";

import { useCallback, useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, FileBarChart } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { api, ApiError } from "@/lib/api-client";
import { formatCompactCurrency, formatCurrency } from "@/lib/format";

type ReportData = {
  summary: {
    revenue: number;
    dealsWon: number;
    dealsLost: number;
    winRate: number;
    totalLeads: number;
    convertedLeads: number;
    leadConversionRate: number;
    newContacts: number;
  };
  months: { month: string; revenue: number; dealsWon: number }[];
  teamPerformance: {
    userId: string;
    name: string;
    avatarColor: string;
    wonCount: number;
    wonValue: number;
    lostCount: number;
    openCount: number;
    openValue: number;
    winRate: number;
    leadsAssigned: number;
    leadsConverted: number;
  }[];
  funnel: { status: string; count: number }[];
  acquisitionBySource: { source: string; leads: number; converted: number }[];
};

export default function ReportsPage() {
  const [data, setData] = useState<ReportData | null>(null);
  const [period, setPeriod] = useState<"month" | "quarter" | "year">("quarter");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const d = await api.get<ReportData>(`/api/reports?period=${period}`);
      setData(d);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load reports");
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <EmptyState icon={FileBarChart} title="Reports unavailable" description={error} />;
  if (!data) return <div className="h-96 animate-pulse rounded-lg bg-muted" />;

  const { summary } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-sm text-muted-foreground">Sales, conversion, and team performance</p>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-md border border-border" role="tablist" aria-label="Report period">
            {(["month", "quarter", "year"] as const).map((p) => (
              <button
                key={p}
                role="tab"
                aria-selected={period === p}
                onClick={() => setPeriod(p)}
                className={
                  period === p
                    ? "bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-xs font-medium capitalize"
                    : "px-3 py-1.5 text-xs font-medium capitalize text-muted-foreground hover:bg-muted rounded-md"
                }
              >
                {p}
              </button>
            ))}
          </div>
          <a
            href={`/api/reports?period=${period}&format=csv`}
            download
            className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted"
          >
            <Download className="h-4 w-4" /> Export CSV
          </a>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Revenue</p>
            <p className="text-2xl font-bold">{formatCurrency(summary.revenue)}</p>
            <p className="text-xs text-muted-foreground">{summary.dealsWon} deals won</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Win rate</p>
            <p className="text-2xl font-bold">{summary.winRate}%</p>
            <p className="text-xs text-muted-foreground">
              {summary.dealsWon} won / {summary.dealsLost} lost
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Lead conversion</p>
            <p className="text-2xl font-bold">{summary.leadConversionRate}%</p>
            <p className="text-xs text-muted-foreground">
              {summary.convertedLeads} of {summary.totalLeads} leads
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">New contacts</p>
            <p className="text-2xl font-bold">{summary.newContacts}</p>
            <p className="text-xs text-muted-foreground">In selected period</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revenue by month</CardTitle>
          <CardDescription>Won deals over time</CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.months}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" fontSize={12} stroke="var(--muted-foreground)" />
              <YAxis
                fontSize={12}
                stroke="var(--muted-foreground)"
                tickFormatter={(v) => formatCompactCurrency(Number(v))}
              />
              <Tooltip
                formatter={(v) => formatCurrency(Number(v))}
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="revenue" fill="var(--primary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Lead funnel</CardTitle>
            <CardDescription>Lead progression by status</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.funnel.map((f, i) => {
              const max = Math.max(...data.funnel.map((x) => x.count), 1);
              return (
                <div key={f.status} className="flex items-center gap-3">
                  <span className="w-20 text-xs font-medium text-muted-foreground">{f.status}</span>
                  <div className="h-6 flex-1 overflow-hidden rounded-md bg-muted">
                    <div
                      className="flex h-full items-center justify-end rounded-md bg-primary/80 pr-2 text-[10px] font-semibold text-white"
                      style={{ width: `${Math.max(4, (f.count / max) * 100)}%` }}
                    >
                      {f.count}
                    </div>
                  </div>
                  {i > 0 && (
                    <span className="w-14 text-right text-[10px] text-muted-foreground">
                      {Math.round((f.count / (data.funnel[0]!.count || 1)) * 100)}%
                    </span>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Acquisition by source</CardTitle>
            <CardDescription>Where leads come from</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.acquisitionBySource.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No source data yet.</p>
            ) : (
              data.acquisitionBySource.map((s) => {
                const max = Math.max(...data.acquisitionBySource.map((x) => x.leads), 1);
                return (
                  <div key={s.source} className="flex items-center gap-3">
                    <span className="w-32 truncate text-xs font-medium text-muted-foreground">{s.source}</span>
                    <div className="h-6 flex-1 overflow-hidden rounded-md bg-muted">
                      <div
                        className="h-full rounded-md bg-success/70"
                        style={{ width: `${Math.max(4, (s.leads / max) * 100)}%` }}
                      />
                    </div>
                    <span className="w-16 text-right text-xs text-muted-foreground">
                      {s.leads} → {s.converted} ✓
                    </span>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team performance</CardTitle>
          <CardDescription>Won revenue, pipeline, and win rates</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.teamPerformance.map((u) => (
              <div key={u.userId} className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-2.5">
                  <Avatar name={u.name} color={u.avatarColor} />
                  <p className="font-medium">{u.name}</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Won</p>
                    <p className="font-semibold">
                      {formatCurrency(u.wonValue)} ({u.wonCount})
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Open pipeline</p>
                    <p className="font-semibold">{formatCurrency(u.openValue)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Win rate</p>
                    <p className="font-semibold">{u.winRate}%</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Leads converted</p>
                    <p className="font-semibold">
                      {u.leadsConverted}/{u.leadsAssigned}
                    </p>
                  </div>
                </div>
                <div className="mt-2">
                  <Badge variant={u.winRate >= 50 ? "success" : u.winRate >= 25 ? "warning" : "secondary"}>
                    {u.wonCount > 0 || u.lostCount > 0 ? `${u.winRate}% win rate` : "No closed deals"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
