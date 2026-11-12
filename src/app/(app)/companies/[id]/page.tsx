"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Building2, Globe, MapPin, Phone } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { api, ApiError } from "@/lib/api-client";
import { formatDateTime, timeAgo } from "@/lib/format";

type Company = {
  id: string;
  name: string;
  domain: string;
  industry: string;
  size: string;
  phone: string;
  website: string;
  city: string;
  state: string;
  country: string;
  summary: string;
  owner: { id: string; name: string; avatarColor: string } | null;
  createdAt: string;
  contacts: { id: string; firstName: string; lastName: string; email: string; title: string; avatarColor: string }[];
};

type Activity = {
  id: string;
  type: string;
  title: string;
  occurredAt: string;
  user: { name: string; avatarColor: string };
};

export default function CompanyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [company, setCompany] = useState<Company | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const c = await api.get<Company>(`/api/companies/${id}`);
      setCompany(c);
      const acts = await api.get<{ activities: Activity[] }>(`/api/activities?companyId=${id}`);
      setActivities(acts.activities);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setError(e instanceof ApiError ? e.message : "Failed to load company");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (notFound) {
    return (
      <EmptyState
        icon={Building2}
        title="Company not found"
        action={
          <Link href="/companies">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          </Link>
        }
      />
    );
  }
  if (!company) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/companies">
          <Button variant="ghost" size="icon" aria-label="Back to companies">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
          <Building2 className="h-6 w-6 text-primary" />
        </span>
        <div>
          <h1 className="text-2xl font-bold">{company.name}</h1>
          <p className="text-sm text-muted-foreground">
            {company.industry}
            {company.size ? ` · ${company.size} employees` : ""}
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            {company.domain && (
              <p className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                {company.website ? (
                  <a href={company.website} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {company.domain}
                  </a>
                ) : (
                  company.domain
                )}
              </p>
            )}
            <p className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              {company.phone || "—"}
            </p>
            <p className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              {[company.city, company.state, company.country].filter(Boolean).join(", ") || "—"}
            </p>
            <p className="text-xs text-muted-foreground">Owner: {company.owner?.name ?? "Unassigned"}</p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Associated contacts ({company.contacts.length})</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {company.contacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No contacts linked to this company yet.</p>
            ) : (
              company.contacts.map((c) => (
                <Link
                  key={c.id}
                  href={`/contacts/${c.id}`}
                  className="flex items-center gap-2.5 rounded-md border border-border p-2.5 hover:bg-muted/50"
                >
                  <Avatar name={`${c.firstName} ${c.lastName}`} color={c.avatarColor} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {c.firstName} {c.lastName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{c.title || c.email}</p>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {activities.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No company activity recorded.</p>
          ) : (
            <ol className="relative space-y-4 border-l border-border pl-5">
              {activities.map((a) => (
                <li key={a.id} className="relative">
                  <span className="absolute top-1.5 -left-[26px] h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background" />
                  <p className="text-sm font-medium">{a.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.user.name} · {formatDateTime(a.occurredAt)} ({timeAgo(a.occurredAt)})
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
