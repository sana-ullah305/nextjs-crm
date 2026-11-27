"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, FlaskConical, KanbanSquare, KeyRound, Mail, Plus, Repeat, ScrollText, Tag, Trash2, UserPlus, Users, Copy, Check } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityForm, type FieldDef, type FieldErrors } from "@/components/entity-form";
import { api, ApiError, validationDetails } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/toast";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

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
type EmailSettingsRow = {
  id: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  fromAddress: string;
  notificationsEnabled: boolean;
} | null;
type StepRow = { key: string; delayHours: string; subjectTemplate: string; bodyTemplate: string };
type Sequence = {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  steps: { id: string; position: number; delayHours: number; subjectTemplate: string; bodyTemplate: string }[];
  _count?: { enrollments: number };
};
type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  isActive: boolean;
  revokedAt: string | null;
  createdAt: string;
};

let stepKeyCounter = 0;
function nextStepKey(): string {
  stepKeyCounter += 1;
  return `step-${stepKeyCounter}`;
}
function newStepRow(): StepRow {
  return { key: nextStepKey(), delayHours: "24", subjectTemplate: "", bodyTemplate: "" };
}

const TABS = ["organization", "email", "users", "pipelines", "tags", "sources", "templates", "fields", "sequences", "apikeys", "audit"] as const;
type Tab = (typeof TABS)[number];

const TAB_META: Record<Tab, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  organization: { label: "Organization", icon: Building2 },
  email: { label: "Email (SMTP)", icon: Mail },
  users: { label: "Users", icon: Users },
  pipelines: { label: "Pipelines", icon: KanbanSquare },
  tags: { label: "Tags", icon: Tag },
  sources: { label: "Lead sources", icon: FlaskConical },
  templates: { label: "Email templates", icon: Mail },
  fields: { label: "Custom fields", icon: Tag },
  sequences: { label: "Sequences", icon: Repeat },
  apikeys: { label: "API keys", icon: KeyRound },
  audit: { label: "Audit log", icon: ScrollText },
};

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("organization");
  const { success: toastSuccess, error: toastError } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();
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
      toastSuccess({ description: "Organization updated" });
    } catch (e) {
      toastError({ description: e instanceof ApiError ? e.message : "Save failed" });
    } finally {
      setOrgSaving(false);
    }
  }

  // Email (SMTP) settings
  const [emailSettings, setEmailSettings] = useState<EmailSettingsRow>(null);
  const [emailSaving, setEmailSaving] = useState(false);

  const loadEmailSettings = useCallback(async () => {
    const d = await api.get<{ settings: EmailSettingsRow }>("/api/settings/email");
    setEmailSettings(d.settings);
  }, []);
  useEffect(() => {
    if (tab === "email") void loadEmailSettings().catch(() => undefined);
  }, [tab, loadEmailSettings]);

  async function saveEmailSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!emailSettings) return;
    setEmailSaving(true);
    try {
      await api.patch("/api/settings/email", {
        smtpHost: emailSettings.smtpHost,
        smtpPort: emailSettings.smtpPort,
        smtpUser: emailSettings.smtpUser,
        fromAddress: emailSettings.fromAddress,
      });
      toastSuccess({ description: "Email settings updated" });
    } catch (e) {
      toastError({ description: e instanceof ApiError ? e.message : "Save failed" });
    } finally {
      setEmailSaving(false);
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
      toastSuccess({ description: "User created" });
    } catch (e) {
      setUserErrors(validationDetails(e));
      toastError({ description: e instanceof ApiError ? e.message : "Update failed" });
    } finally {
      setUserSubmitting(false);
    }
  }

  async function toggleUser(u: UserRow) {
    if (u.isActive) {
      confirm({
        title: "Deactivate user",
        description: `Deactivate ${u.name}? They will lose access immediately.`,
        variant: "destructive",
        confirmText: "Deactivate",
        onConfirm: async () => {
          try {
            await api.delete(`/api/users/${u.id}`);
            toastSuccess({ description: `${u.name} deactivated` });
            await loadUsers();
          } catch (e) {
            toastError({ description: e instanceof ApiError ? e.message : "Update failed" });
          }
        },
      });
      return;
    }
    try {
      await api.patch(`/api/users/${u.id}`, { isActive: true });
      toastSuccess({ description: `${u.name} activated` });
      await loadUsers();
    } catch (e) {
      toastError({ description: e instanceof ApiError ? e.message : "Update failed" });
    }
  }

  async function changeRole(u: UserRow, role: string) {
    try {
      await api.patch(`/api/users/${u.id}`, { role });
      await loadUsers();
      toastSuccess({ description: `${u.name} is now ${role.replace("_", " ")}` });
    } catch (e) {
      toastError({ description: e instanceof ApiError ? e.message : "Role change failed" });
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
      toastSuccess({ description: "Tag added" });
    } catch (e) {
      toastError({ description: e instanceof ApiError ? e.message : "Failed to add tag" });
    }
  }

  async function deleteTag(id: string) {
    try {
      await api.delete(`/api/settings/tags/${id}`);
      toastSuccess({ description: "Tag deleted" });
      await loadTags();
    } catch (e) {
      toastError({ description: e instanceof ApiError ? e.message : "Delete failed" });
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
      toastSuccess({ description: "Source added" });
    } catch (e) {
      toastError({ description: e instanceof ApiError ? e.message : "Failed to add source" });
    }
  }

  async function deleteSource(id: string) {
    try {
      await api.delete(`/api/settings/lead-sources/${id}`);
      toastSuccess({ description: "Source deleted" });
      await loadSources();
    } catch (e) {
      toastError({ description: e instanceof ApiError ? e.message : "Cannot delete: source is in use" });
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
      toastSuccess({ description: "Pipeline created" });
    } catch (e) {
      toastError({ description: e instanceof ApiError ? e.message : "Failed to create pipeline" });
    }
  }

  async function setDefaultPipeline(id: string) {
    try {
      await api.patch(`/api/settings/pipelines/${id}`, { isDefault: true });
      await loadPipelines();
      toastSuccess({ description: "Default pipeline updated" });
    } catch (e) {
      toastError({ description: e instanceof ApiError ? e.message : "Update failed" });
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
    confirm({
      title: "Delete template",
      description: "Delete this template?",
      variant: "destructive",
      confirmText: "Delete",
      onConfirm: async () => {
        try {
          await api.delete(`/api/settings/email-templates/${id}`);
          toastSuccess({ description: "Template deleted" });
          await loadTemplates();
        } catch (e) {
          toastError({ description: e instanceof ApiError ? e.message : "Delete failed" });
        }
      },
    });
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
      toastSuccess({ description: "Field created" });
    } catch (e) {
      setFieldErrors(validationDetails(e));
      toastError({ description: e instanceof ApiError ? e.message : "Failed to create field" });
    }
  }

  async function deleteField(id: string) {
    try {
      await api.delete(`/api/settings/custom-fields/${id}`);
      toastSuccess({ description: "Field deleted" });
      await loadFields();
    } catch (e) {
      toastError({ description: e instanceof ApiError ? e.message : "Delete failed" });
    }
  }

  // Sequences
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [seqFormOpen, setSeqFormOpen] = useState(false);
  const [seqName, setSeqName] = useState("");
  const [seqSteps, setSeqSteps] = useState<StepRow[]>([
    newStepRow(),
  ]);
  const [seqErrors, setSeqErrors] = useState<FieldErrors>({});
  const [seqSubmitting, setSeqSubmitting] = useState(false);
  const [editingSteps, setEditingSteps] = useState<Sequence | null>(null);
  const [editSteps, setEditSteps] = useState<StepRow[]>([]);

  const loadSequences = useCallback(async () => {
    const d = await api.get<{ sequences: Sequence[] }>("/api/sequences");
    setSequences(d.sequences);
  }, []);
  useEffect(() => {
    if (tab === "sequences") void loadSequences().catch(() => undefined);
  }, [tab, loadSequences]);

  function stepsPayload(rows: StepRow[]) {
    return rows.map((s, i) => ({
      position: i,
      delayHours: Number(s.delayHours || 0),
      subjectTemplate: s.subjectTemplate,
      bodyTemplate: s.bodyTemplate,
    }));
  }

  async function createSequence(e: React.FormEvent) {
    e.preventDefault();
    setSeqSubmitting(true);
    setSeqErrors({});
    try {
      await api.post("/api/sequences", {
        name: seqName,
        steps: stepsPayload(seqSteps),
      });
      setSeqFormOpen(false);
      setSeqName("");
      setSeqSteps([newStepRow()]);
      await loadSequences();
      toastSuccess({ description: "Sequence created" });
    } catch (e) {
      setSeqErrors(validationDetails(e));
      toastError({ description: e instanceof ApiError ? e.message : "Failed to create sequence" });
    } finally {
      setSeqSubmitting(false);
    }
  }

  async function toggleSequence(s: Sequence) {
    try {
      await api.patch(`/api/sequences/${s.id}`, { isActive: !s.isActive });
      await loadSequences();
      toastSuccess({ description: `${s.name} ${!s.isActive ? "activated" : "deactivated"}` });
    } catch (e) {
      toastError({ description: e instanceof ApiError ? e.message : "Update failed" });
    }
  }

  async function deleteSequence(s: Sequence) {
    confirm({
      title: "Delete sequence",
      description: `Delete sequence "${s.name}"?`,
      variant: "destructive",
      confirmText: "Delete",
      onConfirm: async () => {
        try {
          const d = await api.delete<{ archived: boolean; deleted?: boolean }>(`/api/sequences/${s.id}`);
          await loadSequences();
          toastSuccess({
            description:
              d.archived
                ? `"${s.name}" has enrollments, so it was deactivated instead of deleted.`
                : "Sequence deleted",
          });
        } catch (e) {
          toastError({ description: e instanceof ApiError ? e.message : "Delete failed" });
        }
      },
    });
  }

  function openStepsEditor(s: Sequence) {
    setEditingSteps(s);
    setEditSteps(
      s.steps.map((st) => ({
        key: nextStepKey(),
        delayHours: String(st.delayHours),
        subjectTemplate: st.subjectTemplate,
        bodyTemplate: st.bodyTemplate,
      }))
    );
    setSeqErrors({});
  }

  async function saveSteps(e: React.FormEvent) {
    e.preventDefault();
    if (!editingSteps) return;
    setSeqSubmitting(true);
    setSeqErrors({});
    try {
      await api.patch(`/api/sequences/${editingSteps.id}/steps`, { steps: stepsPayload(editSteps) });
      setEditingSteps(null);
      await loadSequences();
      toastSuccess({ description: "Steps updated" });
    } catch (e) {
      setSeqErrors(validationDetails(e));
      toastError({ description: e instanceof ApiError ? e.message : "Failed to update steps" });
    } finally {
      setSeqSubmitting(false);
    }
  }

  // API keys
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [keyName, setKeyName] = useState("");
  const [newKey, setNewKey] = useState("");
  const [keyCopied, setKeyCopied] = useState(false);
  const [keySubmitting, setKeySubmitting] = useState(false);

  const loadApiKeys = useCallback(async () => {
    const d = await api.get<{ apiKeys: ApiKeyRow[] }>("/api/settings/api-keys");
    setApiKeys(d.apiKeys);
  }, []);
  useEffect(() => {
    if (tab === "apikeys") void loadApiKeys().catch(() => undefined);
  }, [tab, loadApiKeys]);

  async function createApiKey(e: React.FormEvent) {
    e.preventDefault();
    if (!keyName.trim()) return;
    setKeySubmitting(true);
    try {
      const d = await api.post<{ id: string; key: string }>("/api/settings/api-keys", {
        name: keyName.trim(),
      });
      setNewKey(d.key);
      setKeyName("");
      await loadApiKeys();
      toastSuccess({ description: "API key created" });
    } catch (e) {
      toastError({ description: e instanceof ApiError ? e.message : "Failed to create key" });
    } finally {
      setKeySubmitting(false);
    }
  }

  async function revokeApiKey(k: ApiKeyRow) {
    confirm({
      title: "Revoke API key",
      description: `Revoke key "${k.name}" (${k.prefix}…)? Leads submitted with it will be rejected.`,
      variant: "destructive",
      confirmText: "Revoke",
      onConfirm: async () => {
        try {
          await api.delete(`/api/settings/api-keys/${k.id}`);
          await loadApiKeys();
          toastSuccess({ description: "Key revoked" });
        } catch (e) {
          toastError({ description: e instanceof ApiError ? e.message : "Revoke failed" });
        }
      },
    });
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
      {ConfirmDialog}
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Workspace configuration</p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Settings sections">
        {TABS.filter((t) => t !== "audit" || isAdmin || me?.role === "MANAGER").map((t) => {
          const Icon = TAB_META[t].icon;
          return (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
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

      {tab === "email" && (
        <Card>
          <CardHeader>
            <CardTitle>Email delivery (SMTP)</CardTitle>
            <CardDescription>
              Outbound emails (follow-ups, outreach) are delivered through this
              SMTP account. Configure it once; every send is logged on the
              record&#39;s activity timeline.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {emailSettings === null ? (
              <div className="h-32 animate-pulse rounded-lg bg-muted" />
            ) : (
              <form onSubmit={saveEmailSettings} className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="smtp-host">SMTP host</Label>
                  <Input
                    id="smtp-host"
                    placeholder="smtp.example.com"
                    value={emailSettings?.smtpHost ?? ""}
                    onChange={(e) =>
                      setEmailSettings((s) => (s ? { ...s, smtpHost: e.target.value } : s))
                    }
                    disabled={!isAdmin}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="smtp-port">SMTP port</Label>
                  <Input
                    id="smtp-port"
                    type="number"
                    value={emailSettings?.smtpPort ?? 587}
                    onChange={(e) =>
                      setEmailSettings((s) =>
                        s ? { ...s, smtpPort: Number(e.target.value) } : s
                      )
                    }
                    disabled={!isAdmin}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="smtp-user">SMTP username</Label>
                  <Input
                    id="smtp-user"
                    placeholder="alerts@example.com"
                    value={emailSettings?.smtpUser ?? ""}
                    onChange={(e) =>
                      setEmailSettings((s) => (s ? { ...s, smtpUser: e.target.value } : s))
                    }
                    disabled={!isAdmin}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="smtp-from">From address</Label>
                  <Input
                    id="smtp-from"
                    type="email"
                    placeholder="sales@example.com"
                    value={emailSettings?.fromAddress ?? ""}
                    onChange={(e) =>
                      setEmailSettings((s) => (s ? { ...s, fromAddress: e.target.value } : s))
                    }
                    disabled={!isAdmin}
                  />
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  The SMTP password is supplied via the <code>SMTP_PASS</code>{" "}
                  environment variable on the server; it is never stored in the
                  database or displayed here.
                </p>
                {isAdmin && (
                  <div className="sm:col-span-2">
                    <Button type="submit" disabled={emailSaving}>
                      {emailSaving ? "Saving…" : "Save email settings"}
                    </Button>
                  </div>
                )}
              </form>
            )}
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

      {tab === "sequences" && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Follow-up sequences</CardTitle>
              <CardDescription>
                Automated email steps. Each step waits after the previous one; sending stops on a reply.
              </CardDescription>
            </div>
            {canManage && (
              <Button
                size="sm"
                onClick={() => {
                  setSeqName("");
                  setSeqSteps([newStepRow()]);
                  setSeqErrors({});
                  setSeqFormOpen(true);
                }}
              >
                <Plus className="h-4 w-4" /> New sequence
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {sequences.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No sequences yet. Create one to enroll contacts and leads into automated follow-ups.
              </p>
            )}
            {sequences.map((s) => (
              <div key={s.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Repeat className="h-4 w-4 text-muted-foreground" />
                  <p className="font-medium">{s.name}</p>
                  <Badge variant={s.isActive ? "success" : "secondary"}>
                    {s.isActive ? "Active" : "Inactive"}
                  </Badge>
                  {s._count && (
                    <Badge variant="outline">{s._count.enrollments} active</Badge>
                  )}
                  <span className="ml-auto flex gap-2">
                    {canManage && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => openStepsEditor(s)}>
                          Edit steps
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => void toggleSequence(s)}>
                          {s.isActive ? "Deactivate" : "Activate"}
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={`Delete ${s.name}`} onClick={() => void deleteSequence(s)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </>
                    )}
                  </span>
                </div>
                {s.steps.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {s.steps.map((st) => (
                      <div key={st.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs">
                        <Badge variant="outline">#{st.position + 1}</Badge>
                        <span className="text-muted-foreground">after {st.delayHours}h:</span>
                        <span className="min-w-0 flex-1 truncate font-medium">{st.subjectTemplate}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {tab === "apikeys" && (
        <Card>
          <CardHeader>
            <CardTitle>API keys</CardTitle>
            <CardDescription>
              Keys authenticate public lead-capture form submissions against{" "}
              <code>/api/leads/capture</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {canManage && !newKey && (
              <form onSubmit={createApiKey} className="flex max-w-md gap-2">
                <Input
                  placeholder="Key name (e.g. Website contact form)…"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  aria-label="New API key name"
                />
                <Button type="submit" size="sm" disabled={keySubmitting}>
                  <Plus className="h-4 w-4" /> Create
                </Button>
              </form>
            )}
            {newKey && (
              <div className="rounded-lg border border-success/40 bg-success/10 p-3" role="status">
                <p className="text-sm font-medium text-success">Key created — copy it now</p>
                <p className="mt-0.5 text-xs text-warning">
                  You will not see this value again. Store it somewhere safe.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-xs">
                    {newKey}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard?.writeText(newKey);
                      setKeyCopied(true);
                      setTimeout(() => setKeyCopied(false), 2000);
                    }}
                    aria-label="Copy new API key"
                  >
                    {keyCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {keyCopied ? "Copied" : "Copy"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setNewKey("")}>
                    Done
                  </Button>
                </div>
              </div>
            )}
            <div className="space-y-2">
              {apiKeys.map((k) => (
                <div key={k.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2.5 text-sm">
                  <span className="font-medium">{k.name}</span>
                  <code className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {k.prefix}…
                  </code>
                  <Badge variant={k.isActive ? "success" : "destructive"}>
                    {k.isActive ? "Active" : "Revoked"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {k.lastUsedAt ? `Last used ${formatDateTime(k.lastUsedAt)}` : "Never used"}
                  </span>
                  {canManage && k.isActive && (
                    <Button variant="ghost" size="icon" className="ml-auto" aria-label={`Revoke ${k.name}`} onClick={() => void revokeApiKey(k)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
              ))}
              {apiKeys.length === 0 && (
                <p className="text-sm text-muted-foreground">No API keys yet.</p>
              )}
            </div>
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
      {seqFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true">
          <Card className="max-h-[85vh] w-full max-w-2xl overflow-y-auto p-6">
            <h2 className="text-lg font-semibold">New sequence</h2>
            <form onSubmit={createSequence} className="mt-4 space-y-4">
              <div>
                <Label htmlFor="seq-name">Sequence name</Label>
                <Input
                  id="seq-name"
                  required
                  value={seqName}
                  onChange={(e) => setSeqName(e.target.value)}
                  className="mt-1"
                  placeholder="New lead nurture"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Steps (max 15)</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={seqSteps.length >= 15}
                    onClick={() =>
                      setSeqSteps((s) => [...s, newStepRow()])
                    }
                  >
                    <Plus className="h-3.5 w-3.5" /> Add step
                  </Button>
                </div>
                {seqSteps.map((s, i) => (
                  <div key={s.key} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[7rem_1fr_2rem]">
                    <div className="grid content-start gap-1">
                      <Label htmlFor={`step-delay-${i}`} className="text-xs">Step {i + 1} delay (h)</Label>
                      <Input
                        id={`step-delay-${i}`}
                        type="number"
                        min={0}
                        max={8760}
                        required
                        value={s.delayHours}
                        onChange={(e) =>
                          setSeqSteps((rows) => rows.map((r, j) => (j === i ? { ...r, delayHours: e.target.value } : r)))
                        }
                      />
                    </div>
                    <div className="grid gap-2">
                      <div className="grid gap-1">
                        <Label htmlFor={`step-subject-${i}`} className="text-xs">Subject</Label>
                        <Input
                          id={`step-subject-${i}`}
                          required
                          value={s.subjectTemplate}
                          onChange={(e) =>
                            setSeqSteps((rows) => rows.map((r, j) => (j === i ? { ...r, subjectTemplate: e.target.value } : r)))
                          }
                          placeholder="Hi {{firstName}}, quick follow-up"
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor={`step-body-${i}`} className="text-xs">Body</Label>
                        <Textarea
                          id={`step-body-${i}`}
                          required
                          rows={3}
                          value={s.bodyTemplate}
                          onChange={(e) =>
                            setSeqSteps((rows) => rows.map((r, j) => (j === i ? { ...r, bodyTemplate: e.target.value } : r)))
                          }
                          placeholder="Write your message. {{firstName}}, {{lastName}}, {{company}}, {{ownerName}} are replaced per recipient. An unsubscribe link is added automatically."
                        />
                      </div>
                    </div>
                    <div className="grid content-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove step ${i + 1}`}
                        disabled={seqSteps.length <= 1}
                        onClick={() => setSeqSteps((rows) => rows.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  The delay of a step is the wait after the previous step (the first waits from enrollment).
                  Templates support {"{{firstName}}"}, {"{{lastName}}"}, {"{{company}}"}, {"{{ownerName}}"}.
                </p>
                {seqErrors["steps"] && (
                  <p className="text-xs text-destructive" role="alert">{seqErrors["steps"]}</p>
                )}
                {seqErrors["name"] && (
                  <p className="text-xs text-destructive" role="alert">{seqErrors["name"]}</p>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setSeqFormOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={seqSubmitting}>{seqSubmitting ? "Creating…" : "Create sequence"}</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {editingSteps && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true">
          <Card className="max-h-[85vh] w-full max-w-2xl overflow-y-auto p-6">
            <h2 className="text-lg font-semibold">Edit steps — {editingSteps.name}</h2>
            <p className="mt-1 text-xs text-warning">
              Active enrollments keep their current step index; enrollments whose step no
              exists get stopped by the scheduler.
            </p>
            <form onSubmit={saveSteps} className="mt-4 space-y-3">
              {editSteps.map((s, i) => (
                <div key={s.key} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[7rem_1fr_2rem]">
                  <div className="grid content-start gap-1">
                    <Label htmlFor={`estep-delay-${i}`} className="text-xs">Step {i + 1} delay (h)</Label>
                    <Input
                      id={`estep-delay-${i}`}
                      type="number"
                      min={0}
                      max={8760}
                      required
                      value={s.delayHours}
                      onChange={(e) =>
                        setEditSteps((rows) => rows.map((r, j) => (j === i ? { ...r, delayHours: e.target.value } : r)))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <div className="grid gap-1">
                      <Label htmlFor={`estep-subject-${i}`} className="text-xs">Subject</Label>
                      <Input
                        id={`estep-subject-${i}`}
                        required
                        value={s.subjectTemplate}
                        onChange={(e) =>
                          setEditSteps((rows) => rows.map((r, j) => (j === i ? { ...r, subjectTemplate: e.target.value } : r)))
                        }
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`estep-body-${i}`} className="text-xs">Body</Label>
                      <Textarea
                        id={`estep-body-${i}`}
                        required
                        rows={3}
                        value={s.bodyTemplate}
                        onChange={(e) =>
                          setEditSteps((rows) => rows.map((r, j) => (j === i ? { ...r, bodyTemplate: e.target.value } : r)))
                        }
                      />
                    </div>
                  </div>
                  <div className="grid content-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove step ${i + 1}`}
                      disabled={editSteps.length <= 1}
                      onClick={() => setEditSteps((rows) => rows.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={editSteps.length >= 15}
                  onClick={() =>
                    setEditSteps((s) => [...s, newStepRow()])
                  }
                >
                  <Plus className="h-3.5 w-3.5" /> Add step
                </Button>
                {seqErrors["steps"] && (
                  <p className="text-xs text-destructive" role="alert">{seqErrors["steps"]}</p>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setEditingSteps(null)}>Cancel</Button>
                <Button type="submit" disabled={seqSubmitting}>{seqSubmitting ? "Saving…" : "Save steps"}</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}

