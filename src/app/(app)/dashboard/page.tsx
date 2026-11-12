"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Briefcase,
  CalendarClock,
  CheckCircle2,
  DollarSign,
  Percent,
  Phone,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";
import { formatCompactCurrency, formatCurrency, relativeDue, timeAgo } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

type DashboardData = {
  kpis: {
    totalContacts: number;
    newContacts: number;
    totalCompanies: number;
    newLeads30d: number;
    openLeads: number;
    convertedLeads: number;
    openDeals: number;
    wonDeals30dCount: number;
    revenue30d: number;
    pipelineValue: number;
    weightedPipeline: number;
    conversionRate: number;
  };
  trend: { month: string; revenue: number; deals: number }[];
  leadsByStatus: { status: string; count: number }[];
  recentActivities: {
    id: string;
    type: string;
    title: string;
    occurredAt: string;
    user: { name: string; avatarColor: string };
  }[];
  upcomingTasks: {
    id: string;
    title: string;
    type: string;
    priority: string;
    dueAt: string | null;
    assignedUser: { name: string; avatarColor: string } | null;
  }[];
  topPerformers: { id: string; name: string; avatarColor: string; wonValue: number; wonCount: number }[];
};

const STATUS_COLORS: Record<string, string> = {
  NEW: "#6366f1",
  CONTACTED: "#0ea5e9",
  QUALIFIED: "#f59e0b",
  CONVERTED: "#16a34a",
  UNQUALIFIED: "#94a3b8",
};

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-lg bg-accent p-2.5">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {label}
          </p>
          <p className="text-xl font-bold">{value}</p>
          {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

const ACTIVITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  CALL: Phone,
  MEETING: Users,
  EMAIL: Users,
  NOTE: CheckCircle2,
  CREATED: UserPlus,
  UPDATED: CheckCircle2,
  STAGE_CHANGE: Briefcase,
  DEAL_WON: DollarSign,
  DEAL_LOST: DollarSign,
  CONVERTED: Percent,
  TASK_COMPLETED: CheckCircle2,
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<DashboardData>("/api/dashboard")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return <EmptyState icon={TrendingUp} title="Failed to load dashboard" description={error} />;
  }
  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  const { kpis } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Revenue pulse for the last 30 days</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Users} label="Total Customers" value={String(kpis.totalContacts)} sub={`+${kpis.newContacts} new in 30d`} />
        <KpiCard icon={UserPlus} label="New Leads (30d)" value={String(kpis.newLeads30d)} sub={`${kpis.openLeads} open overall`} />
        <KpiCard icon={Briefcase} label="Active Deals" value={String(kpis.openDeals)} sub={`${formatCompactCurrency(kpis.pipelineValue)} in pipeline`} />
        <KpiCard icon={Percent} label="Conversion Rate" value={`${kpis.conversionRate}%`} sub={`${kpis.convertedLeads} leads converted`} />
        <KpiCard icon={DollarSign} label="Revenue (30d)" value={formatCurrency(kpis.revenue30d)} sub={`${kpis.wonDeals30dCount} deals won`} />
        <KpiCard icon={TrendingUp} label="Weighted Pipeline" value={formatCurrency(kpis.weightedPipeline)} sub="Probability-adjusted" />
        <KpiCard icon={Users} label="Companies" value={String(kpis.totalCompanies)} />
        <KpiCard icon={CalendarClock} label="Avg Deal Size" value={kpis.wonDeals30dCount > 0 ? formatCurrency(kpis.revenue30d / kpis.wonDeals30dCount) : "—"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Revenue trend</CardTitle>
            <CardDescription>Won deals per month (last 6 months)</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.trend}>
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

        <Card>
          <CardHeader>
            <CardTitle>Lead funnel</CardTitle>
            <CardDescription>Current leads by status</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.leadsByStatus} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" fontSize={12} stroke="var(--muted-foreground)" allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="status"
                  fontSize={11}
                  width={90}
                  stroke="var(--muted-foreground)"
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {data.leadsByStatus.map((entry) => (
                    <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#6366f1"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Latest events across your workspace</CardDescription>
          </CardHeader>
          <CardContent>
            {data.recentActivities.length === 0 ? (
              <EmptyState icon={CheckCircle2} title="No recent activity" description="Activity will appear here as your team works." />
            ) : (
              <ul className="space-y-1">
                {data.recentActivities.map((a) => {
                  const Icon = ACTIVITY_ICONS[a.type] ?? CheckCircle2;
                  return (
                    <li key={a.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50">
                      <div className="rounded-full bg-muted p-2">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{a.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.user.name} · {timeAgo(a.occurredAt)}
                        </p>
                      </div>
                      <Badge variant="outline">{a.type.replace("_", " ")}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Upcoming tasks
                <Link href="/tasks" className="text-xs font-normal text-primary hover:underline">
                  View all
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.upcomingTasks.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Nothing due. Enjoy the calm.</p>
              ) : (
                data.upcomingTasks.map((t) => {
                  const overdue = t.dueAt && new Date(t.dueAt) < new Date();
                  return (
                    <div key={t.id} className="flex items-start gap-2.5 rounded-md border border-border p-2.5">
                      <Avatar name={t.assignedUser?.name ?? "Unassigned"} color={t.assignedUser?.avatarColor} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{t.title}</p>
                        <p className={cn("text-xs", overdue ? "font-semibold text-destructive" : "text-muted-foreground")}>
                          {t.dueAt ? relativeDue(t.dueAt) : "No due date"}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top performers</CardTitle>
              <CardDescription>Won revenue (6 months)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.topPerformers.map((p, i) => (
                <div key={p.id} className="flex items-center gap-3">
                  <span className="w-4 text-sm font-bold text-muted-foreground">{i + 1}</span>
                  <Avatar name={p.name} color={p.avatarColor} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.wonCount} deals won</p>
                  </div>
                  <span className="text-sm font-semibold">{formatCompactCurrency(p.wonValue)}</span>
                </div>
              ))}
              {data.topPerformers.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">No closed deals yet</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
