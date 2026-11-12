"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, FlaskConical, KanbanSquare, Mail, Plus, ScrollText, Tag, Trash2, UserPlus, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityForm, type FieldDef, type FieldErrors } from "@/components/entity-form";
import { api, ApiError, validationDetails } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";

type Org = { id: string; name: string; industry: string; website: string; phone: string; address: string; currency: string };
type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  title: string;
  isActive: boolean;
  lastLoginAt: string | null;
  avatarColor: string;
};
type TagRow = { id: string; name: string; color: string };
type SourceRow = { id: string; name: string; description: string };
type Pipeline = { id: string; name: string; isDefault: boolean; stages: { id: string; name: string; probability: number; type: string }[]; _count?: { deals: number } };
type Template = { id: string; name: string; subject: string; category: string; body: string };
type CustomField = { id: string; entityType: string; name: string; dataType: string; options: string };
type AuditRow = { id: string; action: string; entityType: string; entityId: string; ipAddress: string; createdAt: string; metadata: string };

const TABS = ["organization", "users", "pipelines", "tags", "sources", "templates", "fields", "audit"] as const;
type Tab = (typeof TABS)[number];

const TAB_META: Record<Tab, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  organization: { label: "Organization", icon: Building2 },
  users: { label: "Users", icon: Users },
  pipelines: { label: "Pipelines", icon: KanbanSquare },
  tags: { label: "Tags", icon: Tag },
  sources: { label: "Lead sources", icon: FlaskConical },
  templates: { label: "Email templates", icon: Mail },
  fields: { label: "Custom fields", icon: Tag },
  audit: { label: "Audit log", icon: ScrollText },
};

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("organization");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [me, setMe] = useState<{ role: string } | null>(null);

  useEffect(() => {
    api.get<{ role: string }>("/api/auth/me").then((d) => setMe(d)).catch(() => undefined);
  }, []);

  // Organization
  const [org, setOrg] = useState<Org | null>(null);
  const [orgSaving, setOrgSaving] = useState(false);

  const loadOrg = useCallback(async () => {
    const d = await api.get<{ organization: Org }>("/api/settings/organization");
    setOrg(d.organization);
  }, []);
  useEffect(() => {
    if (tab === "organization") void loadOrg().catch(() => undefined);
  }, [tab, loadOrg]);

  async function saveOrg(e: React.FormEvent) {
    e.preventDefault();
    if (!org) return;
    setOrgSaving(true);
    try {
      await api.patch("/api/settings/organization", {
        name: org.name,
        industry: org.industry,
        website: org.website,
        phone: org.phone,
        address: org.address,
      });
      setNotice("Organization updated");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setOrgSaving(false);
    }
  }

  // Users
  const [users, setUsers] = useState<UserRow[]>([]);
  const [userFormOpen, setUserFormOpen] = useState(false);
  const [userValues, setUserValues] = useState<Record<string, string>>({});
  const [userErrors, setUserErrors] = useState<FieldErrors>({});
  const [userSubmitting, setUserSubmitting] = useState(false);

  const loadUsers = useCallback(async () => {
    const d = await api.get<{ users: UserRow[] }>("/api/users");
    setUsers(d.users);
  }, []);
  useEffect(() => {
    if (tab === "users") void loadUsers().catch(() => undefined);
  }, [tab, loadUsers]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setUserSubmitting(true);
    setUserErrors({});
    try {
      await api.post("/api/users", userValues);
      setUserFormOpen(false);
      setUserValues({});
      await loadUsers();
      setNotice("User created");
    } catch (e) {
      setUserErrors(validationDetails(e));
    } finally {
      setUserSubmitting(false);
    }
  }

  async function toggleUser(u: UserRow) {
    try {
      if (u.isActive) {
        if (!confirm(`Deactivate ${u.name}? They will lose access immediately.`)) return;
        await api.delete(`/api/users/${u.id}`);
      } else {
        await api.patch(`/api/users/${u.id}`, { isActive: true });
      }
      await loadUsers();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Update failed");
    }
  }

  async function changeRole(u: UserRow, role: string) {
    try {
      await api.patch(`/api/users/${u.id}`, { role });
      await loadUsers();
      setNotice(`${u.name} is now ${role.replace("_", " ")}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Role change failed");
    }
  }

  // Tags
  const [tags, setTags] = useState<TagRow[]>([]);
  const [tagName, setTagName] = useState("");
  const loadTags = useCallback(async () => {
    const d = await api.get<{ tags: TagRow[] }>("/api/settings/tags");
    setTags(d.tags);
  }, []);
  useEffect(() => {
    if (tab === "tags") void loadTags().catch(() => undefined);
  }, [tab, loadTags]);

  async function addTag(e: React.FormEvent) {
    e.preventDefault();
    if (!tagName.trim()) return;
    try {
      await api.post("/api/settings/tags", { name: tagName.trim() });
      setTagName("");
      await loadTags();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to add tag");
    }
  }

  async function deleteTag(id: string) {
    try {
      await api.delete(`/api/settings/tags/${id}`);
      await loadTags();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Delete failed");
    }
  }

  // Sources
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [sourceName, setSourceName] = useState("");
  const loadSources = useCallback(async () => {
    const d = await api.get<{ sources: SourceRow[] }>("/api/settings/lead-sources");
    setSources(d.sources);
  }, []);
  useEffect(() => {
    if (tab === "sources") void loadSources().catch(() => undefined);
  }, [tab, loadSources]);

  async function addSource(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceName.trim()) return;
    try {
      await api.post("/api/settings/lead-sources", { name: sourceName.trim() });
      setSourceName("");
      await loadSources();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to add source");
    }
  }

  async function deleteSource(id: string) {
    try {
      await api.delete(`/api/settings/lead-sources/${id}`);
      await loadSources();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Cannot delete: source is in use");
    }
  }

  // Pipelines
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [pipeFormOpen, setPipeFormOpen] = useState(false);
  const [pipeValues, setPipeValues] = useState<Record<string, string>>({});
  const [pipeStages, setPipeStages] = useState("New,Qualified,Won");
  const [pipeErrors, setPipeErrors] = useState<FieldErrors>({});
  const loadPipelines = useCallback(async () => {
    const d = await api.get<{ pipelines: Pipeline[] }>("/api/settings/pipelines");
    setPipelines(d.pipelines);
  }, []);
  useEffect(() => {
    if (tab === "pipelines") void loadPipelines().catch(() => undefined);
  }, [tab, loadPipelines]);

  async function createPipeline(e: React.FormEvent) {
    e.preventDefault();
    setPipeErrors({});
    const stages = pipeStages
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name, i, arr) => ({
        name,
        probability: Math.round(((i + 1) / arr.length) * 100) - 10,
        type: i === arr.length - 1 && name.toLowerCase().includes("won") ? "WON" : "OPEN",
      }));
    try {
      await api.post("/api/settings/pipelines", { name: pipeValues.name, stages });
      setPipeFormOpen(false);
      setPipeValues({});
      await loadPipelines();
      setNotice("Pipeline created");
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    }
  }

  async function setDefaultPipeline(id: string) {
    try {
      await api.patch(`/api/settings/pipelines/${id}`, { isDefault: true });
      await loadPipelines();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Update failed");
    }
  }

  // Templates
  const [templates, setTemplates] = useState<Template[]>([]);
  const loadTemplates = useCallback(async () => {
    const d = await api.get<{ templates: Template[] }>("/api/settings/email-templates");
    setTemplates(d.templates);
  }, []);
  useEffect(() => {
    if (tab === "templates") void loadTemplates().catch(() => undefined);
  }, [tab, loadTemplates]);

  async function deleteTemplate(id: string) {
    if (!confirm("Delete this template?")) return;
    try {
      await api.delete(`/api/settings/email-templates/${id}`);
      await loadTemplates();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Delete failed");
    }
  }

  // Custom fields
  const [fields, setFields] = useState<CustomField[]>([]);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const loadFields = useCallback(async () => {
    const d = await api.get<{ fields: CustomField[] }>("/api/settings/custom-fields");
    setFields(d.fields);
  }, []);
  useEffect(() => {
    if (tab === "fields") void loadFields().catch(() => undefined);
  }, [tab, loadFields]);

  async function createField(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    try {
      await api.post("/api/settings/custom-fields", {
        entityType: fieldValues.entityType,
        name: fieldValues.name,
        dataType: fieldValues.dataType || "TEXT",
      });
      setFieldOpen(false);
      setFieldValues({});
      await loadFields();
    } catch (e) {
      setFieldErrors(validationDetails(e));
    }
  }

  async function deleteField(id: string) {
    try {
      await api.delete(`/api/settings/custom-fields/${id}`);
      await loadFields();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Delete failed");
    }
  }

  // Audit
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const loadAudit = useCallback(async () => {
    const d = await api.get<{ logs: AuditRow[] }>("/api/users/audit?pageSize=50");
    setAudit(d.logs);
  }, []);
  useEffect(() => {
    if (tab === "audit") void loadAudit().catch(() => undefined);
  }, [tab, loadAudit]);

  const isAdmin = me?.role === "ADMIN";
  const canManage = isAdmin || me?.role === "MANAGER";

  const userFields: FieldDef[] = [
    { name: "name", label: "Full name", required: true },
    { name: "email", label: "Email", required: true },
    { name: "password", label: "Initial password (min 8 chars)", required: true, colSpan: 2 },
    {
      name: "role",
      label: "Role",
      type: "select",
      options: [
        { label: "Sales Representative", value: "SALES_REP" },
        { label: "Manager", value: "MANAGER" },
        { label: "Administrator", value: "ADMIN" },
      ],
    },
    { name: "title", label: "Job title" },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Workspace configuration</p>
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

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Settings sections">
        {TABS.filter((t) => t !== "audit" || isAdmin || me?.role === "MANAGER").map((t) => {
          const Icon = TAB_META[t].icon;
          return (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => {
                setTab(t);
                setNotice("");
                setError("");
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
                tab === t ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/70"
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {TAB_META[t].label}
            </button>
          );
        })}
      </div>

      {tab === "organization" && org && (
        <Card>
          <CardHeader>
            <CardTitle>Organization profile</CardTitle>
            <CardDescription>Shown across the workspace</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveOrg} className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="org-name">Name</Label>
                <Input id="org-name" value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} disabled={!isAdmin} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="org-industry">Industry</Label>
                <Input id="org-industry" value={org.industry} onChange={(e) => setOrg({ ...org, industry: e.target.value })} disabled={!isAdmin} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="org-website">Website</Label>
                <Input id="org-website" value={org.website} onChange={(e) => setOrg({ ...org, website: e.target.value })} disabled={!isAdmin} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="org-phone">Phone</Label>
                <Input id="org-phone" value={org.phone} onChange={(e) => setOrg({ ...org, phone: e.target.value })} disabled={!isAdmin} />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="org-address">Address</Label>
                <Input id="org-address" value={org.address} onChange={(e) => setOrg({ ...org, address: e.target.value })} disabled={!isAdmin} />
              </div>
              {isAdmin && (
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={orgSaving}>
                    {orgSaving ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              )}
            </form>
          </CardContent>
        </Card>
      )}

      {tab === "users" && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Team</CardTitle>
              <CardDescription>Roles control what each person can do</CardDescription>
            </div>
            {isAdmin && (
              <Button
                size="sm"
                onClick={() => {
                  setUserValues({ role: "SALES_REP" });
                  setUserErrors({});
                  setUserFormOpen(true);
                }}
              >
                <UserPlus className="h-4 w-4" /> Add user
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {users.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
                <Avatar name={u.name} color={u.avatarColor} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{u.name}</p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                </div>
                {isAdmin ? (
                  <select
                    className="h-8 rounded-md border border-input bg-card px-2 text-xs"
                    value={u.role}
                    onChange={(e) => void changeRole(u, e.target.value)}
                    aria-label={`Role for ${u.name}`}
                  >
                    <option value="SALES_REP">Sales Rep</option>
                    <option value="MANAGER">Manager</option>
                    <option value="ADMIN">Administrator</option>
                  </select>
                ) : (
                  <Badge variant="outline">{u.role.replace("_", " ")}</Badge>
                )}
                <Badge variant={u.isActive ? "success" : "secondary"}>{u.isActive ? "Active" : "Inactive"}</Badge>
                <span className="hidden text-xs text-muted-foreground lg:inline">
                  {u.lastLoginAt ? `Last login ${formatDateTime(u.lastLoginAt)}` : "Never logged in"}
                </span>
                {isAdmin && (
                  <Button variant={u.isActive ? "outline" : "default"} size="sm" onClick={() => void toggleUser(u)}>
                    {u.isActive ? "Deactivate" : "Reactivate"}
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {tab === "pipelines" && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Pipelines</CardTitle>
              <CardDescription>Stages define your sales process</CardDescription>
            </div>
            {isAdmin && (
              <Button size="sm" onClick={() => setPipeFormOpen(true)}>
                <Plus className="h-4 w-4" /> New pipeline
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {pipelines.map((p) => (
              <div key={p.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{p.name}</p>
                  {p.isDefault && <Badge>Default</Badge>}
                  <span className="ml-auto flex gap-2">
                    {!p.isDefault && isAdmin && (
                      <Button variant="outline" size="sm" onClick={() => void setDefaultPipeline(p.id)}>
                        Set as default
                      </Button>
                    )}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.stages.map((s) => (
                    <Badge key={s.id} variant={s.type === "WON" ? "success" : s.type === "LOST" ? "destructive" : "outline"}>
                      {s.name} ({s.probability}%)
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {tab === "tags" && (
        <Card>
          <CardHeader>
            <CardTitle>Tags</CardTitle>
            <CardDescription>Reusable labels for contacts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {canManage && (
              <form onSubmit={addTag} className="flex gap-2">
                <Input
                  placeholder="New tag name…"
                  value={tagName}
                  onChange={(e) => setTagName(e.target.value)}
                  aria-label="New tag name"
                />
                <Button type="submit" size="sm">
                  <Plus className="h-4 w-4" /> Add
                </Button>
              </form>
            )}
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => (
                <span key={t.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                  {t.name}
                  {canManage && (
                    <button aria-label={`Delete ${t.name}`} onClick={() => void deleteTag(t.id)} className="text-muted-foreground hover:text-destructive">
                      ×
                    </button>
                  )}
                </span>
              ))}
              {tags.length === 0 && <p className="text-sm text-muted-foreground">No tags yet.</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "sources" && (
        <Card>
          <CardHeader>
            <CardTitle>Lead sources</CardTitle>
            <CardDescription>Where leads originate (used in scoring)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {canManage && (
              <form onSubmit={addSource} className="flex gap-2">
                <Input
                  placeholder="New source name…"
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                  aria-label="New source name"
                />
                <Button type="submit" size="sm">
                  <Plus className="h-4 w-4" /> Add
                </Button>
              </form>
            )}
            <div className="space-y-2">
              {sources.map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded-md border border-border p-2.5 text-sm">
                  <span className="flex-1">{s.name}</span>
                  {canManage && (
                    <Button variant="ghost" size="icon" aria-label={`Delete ${s.name}`} onClick={() => void deleteSource(s.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "templates" && (
        <Card>
          <CardHeader>
            <CardTitle>Email templates</CardTitle>
            <CardDescription>
              Reusable outreach copy. Delivery requires SMTP credentials (see docs/security.md for the integration point).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {templates.map((t) => (
              <div key={t.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{t.name}</p>
                  <Badge variant="outline">{t.category}</Badge>
                  {canManage && (
                    <Button variant="ghost" size="icon" className="ml-auto" aria-label={`Delete ${t.name}`} onClick={() => void deleteTemplate(t.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
                <p className="mt-1 text-sm font-medium text-muted-foreground">{t.subject}</p>
                <p className="mt-1 line-clamp-3 text-xs text-muted-foreground whitespace-pre-wrap">{t.body}</p>
              </div>
            ))}
            {templates.length === 0 && <p className="text-sm text-muted-foreground">No templates.</p>}
          </CardContent>
        </Card>
      )}

      {tab === "fields" && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Custom fields</CardTitle>
              <CardDescription>Extend contacts, companies, leads, and deals</CardDescription>
            </div>
            {canManage && (
              <Button size="sm" onClick={() => setFieldOpen(true)}>
                <Plus className="h-4 w-4" /> New field
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {fields.map((f) => (
              <div key={f.id} className="flex items-center gap-2 rounded-md border border-border p-2.5 text-sm">
                <Badge variant="outline">{f.entityType}</Badge>
                <span className="flex-1">{f.name}</span>
                <Badge variant="secondary">{f.dataType}</Badge>
                {canManage && (
                  <Button variant="ghost" size="icon" aria-label={`Delete ${f.name}`} onClick={() => void deleteField(f.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                )}
              </div>
            ))}
            {fields.length === 0 && <p className="text-sm text-muted-foreground">No custom fields defined.</p>}
          </CardContent>
        </Card>
      )}

      {tab === "audit" && (
        <Card>
          <CardHeader>
            <CardTitle>Audit log</CardTitle>
            <CardDescription>Who did what, when</CardDescription>
          </CardHeader>
          <CardContent>
            {audit.length === 0 ? (
              <EmptyState icon={ScrollText} title="No audit entries" className="border-0" />
            ) : (
              <div className="space-y-1.5">
                {audit.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <Badge variant="outline">{a.action}</Badge>
                    {a.entityType && <span className="text-xs text-muted-foreground">{a.entityType}</span>}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatDateTime(a.createdAt)} · {a.ipAddress || "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <EntityForm
        open={userFormOpen}
        onOpenChange={setUserFormOpen}
        title="Add team member"
        fields={userFields}
        values={userValues}
        errors={userErrors}
        submitting={userSubmitting}
        onChange={(name, value) => setUserValues((v) => ({ ...v, [name]: value }))}
        onSubmit={createUser}
      />

      {pipeFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true">
          <Card className="w-full max-w-md p-6">
            <h2 className="text-lg font-semibold">New pipeline</h2>
            <form onSubmit={createPipeline} className="mt-4 space-y-3">
              <div>
                <Label htmlFor="pipe-name">Pipeline name</Label>
                <Input
                  id="pipe-name"
                  required
                  value={pipeValues.name ?? ""}
                  onChange={(e) => setPipeValues((v) => ({ ...v, name: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="pipe-stages">Stages (comma separated)</Label>
                <Input
                  id="pipe-stages"
                  required
                  value={pipeStages}
                  onChange={(e) => setPipeStages(e.target.value)}
                  className="mt-1"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Probabilities are distributed evenly. Rename the last stage to include {'"Won"'} to mark it a win stage.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setPipeFormOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Create pipeline</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {fieldOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true">
          <Card className="w-full max-w-md p-6">
            <h2 className="text-lg font-semibold">New custom field</h2>
            <form onSubmit={createField} className="mt-4 space-y-3">
              <div>
                <Label htmlFor="cf-entity">Applies to</Label>
                <select
                  id="cf-entity"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                  value={fieldValues.entityType ?? "contact"}
                  onChange={(e) => setFieldValues((v) => ({ ...v, entityType: e.target.value }))}
                >
                  <option value="contact">Contact</option>
                  <option value="company">Company</option>
                  <option value="lead">Lead</option>
                  <option value="deal">Deal</option>
                </select>
              </div>
              <div>
                <Label htmlFor="cf-name">Field name</Label>
                <Input
                  id="cf-name"
                  required
                  value={fieldValues.name ?? ""}
                  onChange={(e) => setFieldValues((v) => ({ ...v, name: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="cf-type">Data type</Label>
                <select
                  id="cf-type"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                  value={fieldValues.dataType ?? "TEXT"}
                  onChange={(e) => setFieldValues((v) => ({ ...v, dataType: e.target.value }))}
                >
                  <option value="TEXT">Text</option>
                  <option value="NUMBER">Number</option>
                  <option value="DATE">Date</option>
                  <option value="BOOLEAN">Yes / No</option>
                  <option value="SELECT">Dropdown</option>
                </select>
              </div>
              {Object.keys(fieldErrors).length > 0 && (
                <p className="text-xs text-destructive" role="alert">
                  {Object.values(fieldErrors)[0]}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setFieldOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Create field</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
