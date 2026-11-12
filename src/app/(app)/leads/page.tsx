"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Flame, Plus, Search, Sparkles, Trash2, TrendingUp, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityForm, type FieldDef, type FieldErrors } from "@/components/entity-form";
import { api, ApiError, validationDetails } from "@/lib/api-client";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";

type Lead = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  companyName: string;
  status: string;
  score: number;
  estimatedValue: number;
  expectedCloseDate: string | null;
  followUpAt: string | null;
  convertedAt: string | null;
  contactId: string | null;
  source: { id: string; name: string } | null;
  assignedUser: { id: string; name: string; avatarColor: string } | null;
};

type UserOption = { id: string; name: string };
type SourceOption = { id: string; name: string };

const STATUS_OPTIONS = [
  { label: "New", value: "NEW" },
  { label: "Contacted", value: "CONTACTED" },
  { label: "Qualified", value: "QUALIFIED" },
  { label: "Unqualified", value: "UNQUALIFIED" },
  { label: "Converted", value: "CONVERTED" },
];

function statusBadge(s: string): "default" | "success" | "warning" | "destructive" | "secondary" {
  switch (s) {
    case "CONVERTED":
      return "success";
    case "QUALIFIED":
      return "warning";
    case "UNQUALIFIED":
      return "destructive";
    default:
      return "default";
  }
}

function scoreBadge(s: number) {
  if (s >= 70) return <Badge variant="destructive"><Flame className="mr-1 h-3 w-3" /> Hot {s}</Badge>;
  if (s >= 40) return <Badge variant="warning"><TrendingUp className="mr-1 h-3 w-3" /> Warm {s}</Badge>;
  return <Badge variant="secondary">Cold {s}</Badge>;
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [notice, setNotice] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [dupWarning, setDupWarning] = useState("");

  const [convertTarget, setConvertTarget] = useState<Lead | null>(null);
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertWithDeal, setConvertWithDeal] = useState(true);
  const [convertValue, setConvertValue] = useState("");

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sort,
      });
      if (q) params.set("q", q);
      if (status) params.set("status", status);
      const data = await api.get<{ leads: Lead[]; total: number }>(`/api/leads?${params.toString()}`);
      setLeads(data.leads);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, [page, q, status, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api.get<{ users: UserOption[] }>("/api/settings/users").then((d) => setUsers(d.users)).catch(() => undefined);
    api.get<{ sources: SourceOption[] }>("/api/settings/lead-sources").then((d) => setSources(d.sources)).catch(() => undefined);
  }, []);

  async function checkDuplicate(email: string) {
    if (!email) {
      setDupWarning("");
      return;
    }
    try {
      const data = await api.get<{ isDuplicate: boolean; lead: { id: string } | null; contact: { id: string } | null }>(
        `/api/leads/check-duplicate?email=${encodeURIComponent(email)}`
      );
      setDupWarning(
        data.isDuplicate
          ? "A record with this email already exists — creating this lead may result in a duplicate."
          : ""
      );
    } catch {
      setDupWarning("");
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormErrors({});
    try {
      await api.post("/api/leads", {
        ...formValues,
        estimatedValue: Number(formValues.estimatedValue || 0),
      });
      setFormOpen(false);
      setFormValues({});
      setDupWarning("");
      setNotice("Lead captured and scored");
      await load();
    } catch (e) {
      setFormErrors(validationDetails(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(l: Lead) {
    if (!confirm(`Delete lead ${l.firstName} ${l.lastName}?`)) return;
    try {
      await api.delete(`/api/leads/${l.id}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Delete failed");
    }
  }

  async function onConvert(e: React.FormEvent) {
    e.preventDefault();
    if (!convertTarget) return;
    setSubmitting(true);
    try {
      const result = await api.post<{ contact: { id: string }; deal: { id: string } | null }>(
        `/api/leads/${convertTarget.id}`,
        {
          createDeal: convertWithDeal,
          dealValue: convertValue ? Number(convertValue) : undefined,
        }
      );
      setConvertOpen(false);
      setConvertTarget(null);
      setNotice(
        `Converted! Contact and${result.deal ? " new deal" : ""} ${result.deal ? "" : " "}created.`
      );
      await load();
    } catch (e) {
      setFormErrors(validationDetails(e));
    } finally {
      setSubmitting(false);
    }
  }

  const fields = useMemo<FieldDef[]>(
    () => [
      { name: "firstName", label: "First name", required: true },
      { name: "lastName", label: "Last name", required: true },
      { name: "email", label: "Email", required: true, type: "text" },
      { name: "phone", label: "Phone" },
      { name: "companyName", label: "Company name", placeholder: "Acme Inc" },
      { name: "estimatedValue", label: "Estimated value (USD)", type: "number", placeholder: "12000" },
      {
        name: "sourceId",
        label: "Lead source",
        type: "select",
        options: sources.map((s) => ({ label: s.name, value: s.id })),
      },
      {
        name: "assignedUserId",
        label: "Assign to",
        type: "select",
        options: users.map((u) => ({ label: u.name, value: u.id })),
      },
      { name: "expectedCloseDate", label: "Expected close date", type: "date" },
      { name: "followUpAt", label: "Follow-up date", type: "date" },
      { name: "notes", label: "Notes", type: "textarea", colSpan: 2 },
    ],
    [sources, users]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="text-sm text-muted-foreground">{total} leads</p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setFormValues({ status: "NEW" });
            setFormErrors({});
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> Capture lead
        </Button>
      </div>

      {notice && (
        <p className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1 max-w-md">
          <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search leads…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            aria-label="Search leads"
          />
        </div>
        <select
          className="h-9 rounded-md border border-input bg-card px-2 text-sm"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border border-input bg-card px-2 text-sm"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Sort"
        >
          <option value="recent">Newest first</option>
          <option value="score">Highest score</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>

      <Card>
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : leads.length === 0 ? (
          <EmptyState
            className="m-4 border-0"
            icon={Sparkles}
            title={q || status ? "No leads match your filters" : "No leads yet"}
            description="Capture inbound interest and track it through qualification."
            action={
              !q && !status ? (
                <Button size="sm" onClick={() => setFormOpen(true)}>
                  <Plus className="h-4 w-4" /> Capture lead
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead className="hidden md:table-cell">Company</TableHead>
                <TableHead className="hidden lg:table-cell">Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Score</TableHead>
                <TableHead className="hidden xl:table-cell">Est. value</TableHead>
                <TableHead className="hidden xl:table-cell">Follow-up</TableHead>
                <TableHead className="hidden md:table-cell">Owner</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">
                        {l.firstName} {l.lastName}
                      </p>
                      <p className="text-xs text-muted-foreground">{l.email}</p>
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{l.companyName || "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <Badge variant="outline">{l.source?.name ?? "—"}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadge(l.status)}>{l.status}</Badge>
                  </TableCell>
                  <TableCell>{scoreBadge(l.score)}</TableCell>
                  <TableCell className="hidden text-sm xl:table-cell">
                    {l.estimatedValue > 0 ? formatCurrency(l.estimatedValue) : "—"}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">
                    {l.followUpAt ? formatDate(l.followUpAt) : "—"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {l.assignedUser ? (
                      <span className="flex items-center gap-1.5 text-sm">
                        <Avatar name={l.assignedUser.name} color={l.assignedUser.avatarColor} size="sm" />
                        {l.assignedUser.name}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {l.status !== "CONVERTED" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setConvertTarget(l);
                            setConvertValue(String(l.estimatedValue || ""));
                            setConvertOpen(true);
                          }}
                        >
                          <UserCheck className="h-3.5 w-3.5" /> Convert
                        </Button>
                      ) : l.contactId ? (
                        <Link href={`/contacts/${l.contactId}`}>
                          <Button variant="ghost" size="sm">
                            View contact
                          </Button>
                        </Link>
                      ) : null}
                      {l.status !== "CONVERTED" && (
                        <Button variant="ghost" size="icon" aria-label="Delete lead" onClick={() => void onDelete(l)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      <EntityForm
        open={formOpen}
        onOpenChange={setFormOpen}
        title="Capture lead"
        description="Leads are scored automatically based on reachability, value, and source."
        fields={fields}
        values={formValues}
        errors={formErrors}
        submitting={submitting}
        onChange={(name, value) => {
          setFormValues((v) => ({ ...v, [name]: value }));
          if (name === "email") void checkDuplicate(value);
        }}
        onSubmit={onSubmit}
      />
      {dupWarning && formOpen && (
        <p className="text-xs text-warning" role="alert">
          {dupWarning}
        </p>
      )}

      {convertOpen && convertTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true">
          <Card className="w-full max-w-md p-6">
            <h2 className="text-lg font-semibold">
              Convert {convertTarget.firstName} {convertTarget.lastName}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Creates a contact record{convertWithDeal ? " and an open deal" : ""}. The lead will be marked
              converted.
            </p>
            <form onSubmit={onConvert} className="mt-4 space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={convertWithDeal}
                  onChange={(e) => setConvertWithDeal(e.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                Create a deal in the default pipeline
              </label>
              {convertWithDeal && (
                <div>
                  <label htmlFor="deal-value" className="text-sm font-medium">
                    Deal value (USD)
                  </label>
                  <Input
                    id="deal-value"
                    type="number"
                    value={convertValue}
                    onChange={(e) => setConvertValue(e.target.value)}
                    className="mt-1"
                  />
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setConvertOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Converting…" : "Convert lead"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
