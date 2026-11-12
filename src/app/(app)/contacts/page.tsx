"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Users, Plus, Search, Download, Upload, Pencil, Trash2, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityForm, type FieldDef, type FieldErrors } from "@/components/entity-form";
import { api, ApiError, validationDetails } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";

type ContactRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  title: string;
  status: string;
  city: string;
  createdAt: string;
  avatarColor: string;
  ownerId: string | null;
  company: { id: string; name: string } | null;
  owner: { id: string; name: string; avatarColor: string } | null;
  tags: { id: string; name: string; color: string }[];
};

type UserOption = { id: string; name: string };
type CompanyOption = { id: string; name: string };

const STATUS_BADGES: Record<string, "default" | "success" | "warning" | "secondary" | "destructive"> = {
  LEAD: "default",
  ACTIVE: "success",
  CUSTOMER: "success",
  INACTIVE: "secondary",
  CHURNED: "destructive",
};

export default function ContactsPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (q) params.set("q", q);
      if (status) params.set("status", status);
      const data = await api.get<{ contacts: ContactRow[]; total: number }>(
        `/api/contacts?${params.toString()}`
      );
      setContacts(data.contacts);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }, [page, q, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<{ users: UserOption[] }>("/api/settings/users")
      .then((d) => setUsers(d.users))
      .catch(() => undefined);
    api
      .get<{ companies: CompanyOption[] }>("/api/companies?pageSize=100")
      .then((d) => setCompanies(d.companies.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => undefined);
  }, []);

  function openCreate() {
    setEditing(null);
    setFormValues({ status: "ACTIVE", tags: "" });
    setFormErrors({});
    setFormOpen(true);
  }

  function openEdit(c: ContactRow) {
    setEditing(c);
    setFormValues({
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      phone: c.phone,
      title: c.title,
      status: c.status,
      companyId: c.company?.id ?? "",
      ownerId: c.ownerId ?? "",
      city: c.city,
      tags: c.tags.map((t) => t.name).join(", "),
    });
    setFormErrors({});
    setFormOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormErrors({});
    const payload = {
      ...formValues,
      tags: (formValues.tags ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    };
    try {
      if (editing) {
        await api.patch(`/api/contacts/${editing.id}`, payload);
        setNotice("Contact updated");
      } else {
        await api.post("/api/contacts", payload);
        setNotice("Contact created");
      }
      setFormOpen(false);
      await load();
      router.refresh();
    } catch (e) {
      setFormErrors(validationDetails(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(c: ContactRow) {
    if (!confirm(`Delete ${c.firstName} ${c.lastName}? This keeps history but removes them from views.`)) {
      return;
    }
    try {
      await api.delete(`/api/contacts/${c.id}`);
      setNotice("Contact deleted");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Delete failed");
    }
  }

  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    const header = lines[0]?.split(",").map((h) => h.trim().toLowerCase());
    if (!header || !lines[1]) {
      setError("CSV must have a header row and at least one data row");
      return;
    }
    const idx = (name: string) => header.indexOf(name);
    const contacts = lines.slice(1).map((line) => {
      const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      return {
        firstName: cols[idx("first name")] ?? cols[idx("firstname")] ?? "",
        lastName: cols[idx("last name")] ?? cols[idx("lastname")] ?? "",
        email: cols[idx("email")] ?? "",
        phone: cols[idx("phone")] ?? "",
        title: cols[idx("title")] ?? "",
        company: cols[idx("company")] ?? "",
      };
    });
    try {
      const result = await api.post<{ imported: number; skipped: number }>(
        "/api/contacts/import",
        { contacts }
      );
      setNotice(`Imported ${result.imported}, skipped ${result.skipped} (duplicates/invalid)`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Import failed");
    } finally {
      e.target.value = "";
    }
  }

  const fields = useMemo<FieldDef[]>(
    () => [
      { name: "firstName", label: "First name", required: true, placeholder: "Ada" },
      { name: "lastName", label: "Last name", required: true, placeholder: "Byron" },
      { name: "email", label: "Email", type: "text", placeholder: "ada@example.com" },
      { name: "phone", label: "Phone", placeholder: "+1 (555) 010-1234" },
      { name: "title", label: "Job title", placeholder: "CTO" },
      { name: "city", label: "City", placeholder: "San Francisco" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { label: "Lead", value: "LEAD" },
          { label: "Active", value: "ACTIVE" },
          { label: "Customer", value: "CUSTOMER" },
          { label: "Inactive", value: "INACTIVE" },
          { label: "Churned", value: "CHURNED" },
        ],
      },
      {
        name: "companyId",
        label: "Company",
        type: "select",
        options: [{ label: "— None —", value: "" }, ...companies.map((c) => ({ label: c.name, value: c.id }))],
      },
      {
        name: "ownerId",
        label: "Owner",
        type: "select",
        options: users.map((u) => ({ label: u.name, value: u.id })),
      },
      { name: "tags", label: "Tags (comma separated)", colSpan: 2, placeholder: "VIP, Decision Maker" },
    ],
    [companies, users]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Contacts</h1>
          <p className="text-sm text-muted-foreground">{total} contacts</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex">
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={onImport}
              id="csv-import"
            />
            <Button variant="outline" size="sm" onClick={() => document.getElementById("csv-import")?.click()}>
              <Upload className="h-4 w-4" /> Import CSV
            </Button>
          </label>
          <a
            href="/api/contacts/export"
            download
            className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted"
          >
            <Download className="h-4 w-4" /> Export CSV
          </a>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" /> New contact
          </Button>
        </div>
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
            placeholder="Search name, email, phone…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            aria-label="Search contacts"
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
          <option value="LEAD">Lead</option>
          <option value="ACTIVE">Active</option>
          <option value="CUSTOMER">Customer</option>
          <option value="INACTIVE">Inactive</option>
          <option value="CHURNED">Churned</option>
        </select>
      </div>

      <Card>
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : contacts.length === 0 ? (
          <EmptyState
            className="m-4 border-0"
            icon={Users}
            title={q || status ? "No contacts match your filters" : "No contacts yet"}
            description={q || status ? "Try a different search or clear filters." : "Create your first contact to get started."}
            action={
              !q && !status ? (
                <Button size="sm" onClick={openCreate}>
                  <Plus className="h-4 w-4" /> New contact
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Email</TableHead>
                <TableHead className="hidden lg:table-cell">Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Owner</TableHead>
                <TableHead className="hidden xl:table-cell">Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/contacts/${c.id}`} className="flex items-center gap-2.5 hover:underline">
                      <Avatar name={`${c.firstName} ${c.lastName}`} color={c.avatarColor} size="sm" />
                      <div>
                        <p className="font-medium">
                          {c.firstName} {c.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground">{c.title || "—"}</p>
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    {c.email || "—"}
                    <p className="text-xs">{c.phone}</p>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {c.company ? (
                      <span className="inline-flex items-center gap-1 text-sm">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                        {c.company.name}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGES[c.status] ?? "outline"}>{c.status}</Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
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
                      <Button variant="ghost" size="icon" aria-label={`Edit ${c.firstName} ${c.lastName}`} onClick={() => openEdit(c)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`Delete ${c.firstName} ${c.lastName}`} onClick={() => void onDelete(c)}>
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
        title={editing ? "Edit contact" : "New contact"}
        description={editing ? `Editing ${editing.firstName} ${editing.lastName}` : "Add a person to your workspace"}
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
