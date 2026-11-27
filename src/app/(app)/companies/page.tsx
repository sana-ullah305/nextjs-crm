"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Pencil, Plus, Search, Trash, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityForm, type FieldDef, type FieldErrors } from "@/components/entity-form";
import { api, ApiError, validationDetails } from "@/lib/api-client";
import { formatDate } from "@/lib/format";

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
  contactCount: number;
  dealCount: number;
  owner: { id: string; name: string; avatarColor: string } | null;
  createdAt: string;
};

type UserOption = { id: string; name: string };

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<UserOption[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (q) params.set("q", q);
      const data = await api.get<{ companies: Company[]; total: number }>(
        `/api/companies?${params.toString()}`
      );
      setCompanies(data.companies);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load companies");
    } finally {
      setLoading(false);
    }
  }, [page, q]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<{ users: UserOption[] }>("/api/settings/users")
      .then((d) => setUsers(d.users))
      .catch(() => undefined);
  }, []);

  function openCreate() {
    setEditing(null);
    setFormValues({});
    setFormErrors({});
    setFormOpen(true);
  }

  function openEdit(c: Company) {
    setEditing(c);
    setFormValues({
      name: c.name,
      domain: c.domain,
      industry: c.industry,
      size: c.size,
      phone: c.phone,
      website: c.website,
      city: c.city,
      state: c.state,
      country: c.country,
    });
    setFormErrors({});
    setFormOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormErrors({});
    try {
      if (editing) {
        await api.patch(`/api/companies/${editing.id}`, formValues);
      } else {
        await api.post("/api/companies", formValues);
      }
      setFormOpen(false);
      await load();
    } catch (e) {
      setFormErrors(validationDetails(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(c: Company) {
    if (!confirm(`Delete ${c.name}?`)) return;
    try {
      await api.delete(`/api/companies/${c.id}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Delete failed");
    }
  }

  const fields = useMemo<FieldDef[]>(
    () => [
      { name: "name", label: "Company name", required: true },
      { name: "domain", label: "Domain", placeholder: "acme.com" },
      { name: "industry", label: "Industry", placeholder: "Technology" },
      { name: "size", label: "Company size", placeholder: "200-500" },
      { name: "phone", label: "Phone" },
      { name: "website", label: "Website", placeholder: "https://…" },
      { name: "city", label: "City" },
      { name: "state", label: "State / Region" },
      { name: "country", label: "Country" },
      {
        name: "ownerId",
        label: "Account owner",
        type: "select",
        options: users.map((u) => ({ label: u.name, value: u.id })),
      },
    ],
    [users]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Companies</h1>
          <p className="text-sm text-muted-foreground">{total} companies</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/companies/trash">
            <Button variant="outline" size="sm">
              <Trash className="h-4 w-4" /> Trash
            </Button>
          </Link>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" /> New company
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="relative max-w-md">
        <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Search companies…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          aria-label="Search companies"
        />
      </div>

      <Card>
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : companies.length === 0 ? (
          <EmptyState
            className="m-4 border-0"
            icon={Building2}
            title={q ? "No companies match your search" : "No companies yet"}
            description="Companies group contacts and deals."
            action={
              !q ? (
                <Button size="sm" onClick={openCreate}>
                  <Plus className="h-4 w-4" /> New company
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead className="hidden md:table-cell">Industry</TableHead>
                <TableHead className="hidden lg:table-cell">Location</TableHead>
                <TableHead>Contacts</TableHead>
                <TableHead className="hidden md:table-cell">Owner</TableHead>
                <TableHead className="hidden xl:table-cell">Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/companies/${c.id}`} className="flex items-center gap-2.5 font-medium hover:underline">
                      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                        <Building2 className="h-4 w-4 text-primary" />
                      </span>
                      <span>
                        {c.name}
                        <span className="block text-xs font-normal text-muted-foreground">{c.domain}</span>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">{c.industry || "—"}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                    {[c.city, c.country].filter(Boolean).join(", ") || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      <Users className="mr-1 h-3 w-3" /> {c.contactCount}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {c.owner ? (
                      <span className="flex items-center gap-1.5 text-sm">
                        <Avatar name={c.owner.name} color={c.owner.avatarColor} size="sm" />
                        {c.owner.name}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">
                    {formatDate(c.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" aria-label={`Edit ${c.name}`} onClick={() => openEdit(c)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`Delete ${c.name}`} onClick={() => void onDelete(c)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
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
        title={editing ? "Edit company" : "New company"}
        fields={fields}
        values={formValues}
        errors={formErrors}
        submitting={submitting}
        onChange={(name, value) => setFormValues((v) => ({ ...v, [name]: value }))}
        onSubmit={onSubmit}
      />
    </div>
  );
}
