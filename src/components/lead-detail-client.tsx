"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  Copy,
  Flame,
  Mail,
  MailOpen,
  Pencil,
  Phone,
  Plus,
  Repeat,
  Send,
  StickyNote,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityForm, type FieldDef, type FieldErrors } from "@/components/entity-form";
import { ComposeEmail } from "@/components/compose-email";
import { EnrollDialog } from "@/components/enroll-dialog";
import { MergeDialog } from "@/components/merge-dialog";
import { api, ApiError, validationDetails } from "@/lib/api-client";
import { formatCurrency, formatDate, formatDateTime, timeAgo } from "@/lib/format";

export type LeadDetailData = {
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
  summary: string;
  convertedAt: string | null;
  contactId: string | null;
  source: { id: string; name: string } | null;
  assignedUser: { id: string; name: string; avatarColor: string } | null;
  owner: { id: string; name: string; avatarColor: string } | null;
  company: { id: string; name: string } | null;
  contact: { id: string; firstName: string; lastName: string } | null;
  activities: {
    id: string;
    type: string;
    title: string;
    description: string;
    occurredAt: string;
    user: { id: string; name: string; avatarColor: string };
    task: { id: string; title: string } | null;
  }[];
  notes: {
    id: string;
    body: string;
    createdAt: string;
    user: { id: string; name: string; avatarColor: string };
  }[];
  sentEmails: {
    id: string;
    subject: string;
    recipientEmail: string;
    recipientName: string;
    status: string;
    sentAt: string | null;
    createdAt: string;
    template: { id: string; name: string } | null;
  }[];
  inboundEmails: {
    id: string;
    fromEmail: string;
    fromName: string;
    subject: string;
    body: string;
    status: string;
    receivedAt: string;
    sentEmailId: string | null;
  }[];
  tasks: {
    id: string;
    title: string;
    type: string;
    priority: string;
    status: string;
    dueAt: string | null;
    assignedUser: { id: string; name: string; avatarColor: string } | null;
  }[];
  deals: {
    id: string;
    name: string;
    value: number;
    status: string;
    stage: { id: string; name: string } | null;
  }[];
  duplicateCandidates: {
    id: string;
    type: "contact" | "lead";
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    status: string;
    score: number;
    matchReasons: string[];
  }[];
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

const ACTIVITY_TYPES = [
  { label: "Call", value: "CALL" },
  { label: "Meeting", value: "MEETING" },
  { label: "Email", value: "EMAIL" },
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

function activityIcon(type: string) {
  switch (type) {
    case "CALL":
      return <Phone className="h-3.5 w-3.5" />;
    case "EMAIL":
      return <Mail className="h-3.5 w-3.5" />;
    case "MEETING":
      return <Calendar className="h-3.5 w-3.5" />;
    case "NOTE":
      return <StickyNote className="h-3.5 w-3.5" />;
    case "CONVERTED":
      return <UserCheck className="h-3.5 w-3.5" />;
    default:
      return <CheckCircle2 className="h-3.5 w-3.5" />;
  }
}

function priorityBadge(p: string): "destructive" | "warning" | "secondary" | "default" {
  switch (p) {
    case "URGENT":
      return "destructive";
    case "HIGH":
      return "warning";
    case "LOW":
      return "secondary";
    default:
      return "default";
  }
}

export default function LeadDetailClient({ lead }: { lead: LeadDetailData }) {
  const router = useRouter();
  const [leadData, setLeadData] = useState(lead);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [users, setUsers] = useState<UserOption[]>([]);
  const [sources, setSources] = useState<SourceOption[]>([]);

  // Edit form
  const [editOpen, setEditOpen] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  // Convert dialog
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertWithDeal, setConvertWithDeal] = useState(true);
  const [convertValue, setConvertValue] = useState("");

  // Compose / enroll / merge
  const [composeOpen, setComposeOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);

  // Note
  const [noteBody, setNoteBody] = useState("");
  const [noteError, setNoteError] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  // Log activity
  const [logOpen, setLogOpen] = useState(false);
  const [activityType, setActivityType] = useState("CALL");
  const [activityTitle, setActivityTitle] = useState("");
  const [activityDesc, setActivityDesc] = useState("");
  const [activityDuration, setActivityDuration] = useState("");

  // Load options once
  useEffect(() => {
    api.get<{ users: UserOption[] }>("/api/settings/users").then((d) => setUsers(d.users)).catch(() => undefined);
    api.get<{ sources: SourceOption[] }>("/api/settings/lead-sources").then((d) => setSources(d.sources)).catch(() => undefined);
  }, []);

  const reload = useCallback(async () => {
    try {
      const fresh = await api.get<LeadDetailData>(`/api/leads/${lead.id}`);
      // The API returns a flat lead; merge with relations we already have.
      setLeadData((prev) => ({ ...prev, ...fresh }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to reload lead");
    }
  }, [lead.id]);

  const fields = useMemo<FieldDef[]>(
    () => [
      { name: "firstName", label: "First name", required: true },
      { name: "lastName", label: "Last name", required: true },
      { name: "email", label: "Email", required: true, type: "text" },
      { name: "phone", label: "Phone" },
      { name: "companyName", label: "Company name", placeholder: "Acme Inc" },
      { name: "estimatedValue", label: "Estimated value (USD)", type: "number", placeholder: "12000" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: STATUS_OPTIONS,
      },
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

  function openEdit() {
    setFormValues({
      firstName: leadData.firstName,
      lastName: leadData.lastName,
      email: leadData.email,
      phone: leadData.phone,
      companyName: leadData.companyName,
      estimatedValue: String(leadData.estimatedValue || ""),
      status: leadData.status,
      sourceId: leadData.source?.id ?? "",
      assignedUserId: leadData.assignedUser?.id ?? "",
      expectedCloseDate: leadData.expectedCloseDate?.slice(0, 10) ?? "",
      followUpAt: leadData.followUpAt?.slice(0, 10) ?? "",
      notes: leadData.summary,
    });
    setFormErrors({});
    setEditOpen(true);
  }

  async function onSubmitEdit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormErrors({});
    try {
      await api.patch(`/api/leads/${leadData.id}`, {
        ...formValues,
        estimatedValue: Number(formValues.estimatedValue || 0),
        sourceId: formValues.sourceId || null,
        assignedUserId: formValues.assignedUserId || null,
      });
      setEditOpen(false);
      setNotice("Lead updated");
      await reload();
      router.refresh();
    } catch (e) {
      setFormErrors(validationDetails(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function onConvert(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await api.post<{ contact: { id: string }; deal: { id: string } | null }>(
        `/api/leads/${leadData.id}`,
        {
          createDeal: convertWithDeal,
          dealValue: convertValue ? Number(convertValue) : undefined,
        }
      );
      setConvertOpen(false);
      setNotice(`Converted! Contact${result.deal ? " and new deal" : ""} created.`);
      await reload();
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Convert failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function addNote() {
    if (!noteBody.trim()) {
      setNoteError("Note cannot be empty");
      return;
    }
    setSavingNote(true);
    setNoteError("");
    try {
      await api.post("/api/activities/note", {
        body: noteBody,
        leadId: leadData.id,
      });
      setNoteBody("");
      setNotice("Note added");
      await reload();
      router.refresh();
    } catch (e) {
      setNoteError(e instanceof ApiError ? e.message : "Failed to save note");
    } finally {
      setSavingNote(false);
    }
  }

  async function logActivity(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/api/activities", {
        type: activityType,
        title: activityTitle || `${activityType} with ${leadData.firstName}`,
        description: activityDesc,
        leadId: leadData.id,
        durationMinutes: activityDuration ? Number(activityDuration) : undefined,
      });
      setLogOpen(false);
      setActivityTitle("");
      setActivityDesc("");
      setActivityDuration("");
      setNotice("Activity logged");
      await reload();
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to log activity");
    } finally {
      setSubmitting(false);
    }
  }

  const isConverted = leadData.status === "CONVERTED";
  const fullName = `${leadData.firstName} ${leadData.lastName}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/leads" aria-label="Back to leads">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-lg font-semibold text-primary">
          {leadData.firstName[0]}
          {leadData.lastName[0]}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold">{fullName}</h1>
          <p className="text-sm text-muted-foreground">
            {leadData.email}
            {leadData.companyName ? ` · ${leadData.companyName}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isConverted && (
            <Button size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          )}
          {!isConverted && (
            <Button
              size="sm"
              onClick={() => {
                setConvertValue(String(leadData.estimatedValue || ""));
                setConvertOpen(true);
              }}
            >
              <UserCheck className="h-4 w-4" /> Convert
            </Button>
          )}
          {isConverted && leadData.contactId && (
            <Link href={`/contacts/${leadData.contactId}`}>
              <Button variant="outline" size="sm">
                View contact
              </Button>
            </Link>
          )}
          {!isConverted && leadData.email && (
            <Button variant="outline" size="sm" onClick={() => setComposeOpen(true)}>
              <Send className="h-4 w-4" /> Email
            </Button>
          )}
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

      {leadData.duplicateCandidates.length > 0 && !isConverted && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/30 bg-warning/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-warning">
            <AlertTriangle className="h-4 w-4" />
            <span>
              {leadData.duplicateCandidates.length} potential duplicate
              {leadData.duplicateCandidates.length === 1 ? "" : "s"} found for this lead.
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={() => setMergeOpen(true)}>
            <Copy className="h-3.5 w-3.5" /> Review &amp; merge
          </Button>
        </div>
      )}

      {isConverted && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-success/30 bg-success/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" />
            <span>Converted {leadData.convertedAt ? formatDate(leadData.convertedAt) : ""}</span>
          </div>
          <div className="flex gap-2">
            {leadData.contactId && (
              <Link href={`/contacts/${leadData.contactId}`}>
                <Button variant="outline" size="sm">
                  View contact
                </Button>
              </Link>
            )}
            {leadData.deals[0] && (
              <Link href={`/pipeline?deal=${leadData.deals[0].id}`}>
                <Button variant="outline" size="sm">
                  <Briefcase className="h-3.5 w-3.5" /> View deal
                </Button>
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Lead info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <Badge variant={statusBadge(leadData.status)}>{leadData.status}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Score</span>
              {scoreBadge(leadData.score)}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Source</span>
              {leadData.source ? <Badge variant="outline">{leadData.source.name}</Badge> : <span>—</span>}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Est. value</span>
              <span>{leadData.estimatedValue > 0 ? formatCurrency(leadData.estimatedValue) : "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Expected close</span>
              <span>{leadData.expectedCloseDate ? formatDate(leadData.expectedCloseDate) : "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Follow-up</span>
              <span>{leadData.followUpAt ? formatDate(leadData.followUpAt) : "—"}</span>
            </div>
            {leadData.assignedUser ? (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Assigned to</span>
                <span className="flex items-center gap-1.5">
                  <Avatar name={leadData.assignedUser.name} color={leadData.assignedUser.avatarColor} size="sm" />
                  {leadData.assignedUser.name}
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Assigned to</span>
                <span>Unassigned</span>
              </div>
            )}
            {leadData.owner && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Owner</span>
                <span className="flex items-center gap-1.5">
                  <Avatar name={leadData.owner.name} color={leadData.owner.avatarColor} size="sm" />
                  {leadData.owner.name}
                </span>
              </div>
            )}
            {leadData.phone && (
              <p className="flex items-center gap-2 pt-1">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <a href={`tel:${leadData.phone}`} className="hover:underline">{leadData.phone}</a>
              </p>
            )}
            {leadData.company && (
              <p className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <Link href={`/companies/${leadData.company.id}`} className="hover:underline">
                  {leadData.company.name}
                </Link>
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {leadData.summary ? (
              <p className="whitespace-pre-wrap text-muted-foreground">{leadData.summary}</p>
            ) : (
              <p className="text-muted-foreground">No summary yet. Edit the lead to add notes.</p>
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              {!isConverted && leadData.email && (
                <Button variant="outline" size="sm" onClick={() => setEnrollOpen(true)}>
                  <Repeat className="h-3.5 w-3.5" /> Enroll in sequence
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setLogOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Log activity
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {leadData.deals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Deals ({leadData.deals.length})</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {leadData.deals.map((d) => (
              <Link
                key={d.id}
                href={`/pipeline?deal=${d.id}`}
                className="flex items-center justify-between rounded-md border border-border p-3 hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{d.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.stage?.name ?? "—"} · {formatCurrency(d.value)}
                  </p>
                </div>
                <Badge variant={d.status === "WON" ? "success" : d.status === "LOST" ? "destructive" : "default"}>
                  {d.status}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Tasks ({leadData.tasks.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {leadData.tasks.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No open tasks for this lead.</p>
          ) : (
            <ul className="space-y-2">
              {leadData.tasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between rounded-md border border-border p-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.type}
                      {t.dueAt ? ` · ${formatDate(t.dueAt)}` : ""}
                      {t.assignedUser ? ` · ${t.assignedUser.name}` : ""}
                    </p>
                  </div>
                  <Badge variant={priorityBadge(t.priority)}>{t.priority}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Activity timeline</CardTitle>
          </CardHeader>
          <CardContent>
            {leadData.activities.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No activity recorded yet.</p>
            ) : (
              <ol className="relative space-y-4 border-l border-border pl-5">
                {leadData.activities.map((a) => (
                  <li key={a.id} className="relative">
                    <span className="absolute top-1.5 -left-[26px] flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary ring-4 ring-background">
                      {activityIcon(a.type)}
                    </span>
                    <p className="text-sm font-medium">{a.title}</p>
                    {a.description && (
                      <p className="text-xs text-muted-foreground">{a.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {a.user.name} · {formatDateTime(a.occurredAt)} ({timeAgo(a.occurredAt)})
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notes ({leadData.notes.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Textarea
                placeholder="Add a note about this lead…"
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                aria-label="New note"
              />
              {noteError && (
                <p className="text-xs text-destructive" role="alert">{noteError}</p>
              )}
              <div className="flex justify-end">
                <Button size="sm" onClick={() => void addNote()} disabled={savingNote}>
                  {savingNote ? "Saving…" : "Add note"}
                </Button>
              </div>
            </div>
            {leadData.notes.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No notes yet.</p>
            ) : (
              <ul className="space-y-2">
                {leadData.notes.map((n) => (
                  <li key={n.id} className="rounded-md border border-border p-2.5">
                    <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {n.user.name} · {formatDateTime(n.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Emails sent ({leadData.sentEmails.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {leadData.sentEmails.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No emails sent to this lead.</p>
            ) : (
              <ul className="space-y-2">
                {leadData.sentEmails.map((e) => (
                  <li key={e.id} className="rounded-md border border-border p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">{e.subject}</p>
                      <Badge variant={e.status === "SENT" ? "success" : e.status === "FAILED" ? "destructive" : "secondary"}>
                        {e.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      To: {e.recipientName ? `${e.recipientName} <${e.recipientEmail}>` : e.recipientEmail}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {e.sentAt ? formatDateTime(e.sentAt) : `Queued ${formatDateTime(e.createdAt)}`}
                      {e.template ? ` · ${e.template.name}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Emails received ({leadData.inboundEmails.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {leadData.inboundEmails.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No inbound emails from this lead.</p>
            ) : (
              <ul className="space-y-2">
                {leadData.inboundEmails.map((e) => (
                  <li key={e.id} className="rounded-md border border-border p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">{e.subject || "(no subject)"}</p>
                      <Badge variant={e.status === "UNREAD" ? "warning" : "secondary"}>{e.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      From: {e.fromName ? `${e.fromName} <${e.fromEmail}>` : e.fromEmail}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(e.receivedAt)}</p>
                    {e.body && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{e.body}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {!isConverted && leadData.duplicateCandidates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Potential duplicates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {leadData.duplicateCandidates.map((c) => (
              <div key={`${c.type}:${c.id}`} className="flex items-center justify-between rounded-md border border-border p-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {c.firstName} {c.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.type} · {c.email}
                    {c.matchReasons.length > 0 ? ` · ${c.matchReasons.join(", ")}` : ""}
                  </p>
                </div>
                <Badge variant="warning">{c.score}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <EntityForm
        open={editOpen}
        onOpenChange={setEditOpen}
        title={`Edit ${fullName}`}
        description="Update lead details. The score recalculates automatically."
        fields={fields}
        values={formValues}
        errors={formErrors}
        submitting={submitting}
        submitLabel="Save changes"
        onChange={(name, value) => {
          setFormValues((v) => ({ ...v, [name]: value }));
        }}
        onSubmit={onSubmitEdit}
      />

      {convertOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true">
          <Card className="w-full max-w-md p-6">
            <h2 className="text-lg font-semibold">Convert {fullName}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Creates a contact record{convertWithDeal ? " and an open deal" : ""}. The lead will be marked converted.
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

      {logOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true">
          <Card className="w-full max-w-md p-6">
            <h2 className="text-lg font-semibold">Log activity</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Record a call, meeting, or email with {leadData.firstName}.
            </p>
            <form onSubmit={logActivity} className="mt-4 space-y-3">
              <div>
                <label htmlFor="activity-type" className="text-sm font-medium">Type</label>
                <select
                  id="activity-type"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                  value={activityType}
                  onChange={(e) => setActivityType(e.target.value)}
                >
                  {ACTIVITY_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="activity-title" className="text-sm font-medium">Title</label>
                <Input
                  id="activity-title"
                  value={activityTitle}
                  onChange={(e) => setActivityTitle(e.target.value)}
                  placeholder={`${activityType} with ${leadData.firstName}`}
                  className="mt-1"
                />
              </div>
              <div>
                <label htmlFor="activity-desc" className="text-sm font-medium">Description</label>
                <Textarea
                  id="activity-desc"
                  value={activityDesc}
                  onChange={(e) => setActivityDesc(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <label htmlFor="activity-duration" className="text-sm font-medium">Duration (minutes)</label>
                <Input
                  id="activity-duration"
                  type="number"
                  value={activityDuration}
                  onChange={(e) => setActivityDuration(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setLogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Logging…" : "Log activity"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      <ComposeEmail
        open={composeOpen}
        onOpenChange={setComposeOpen}
        defaultTo={{ email: leadData.email, name: fullName }}
        leadId={leadData.id}
        templateVars={{
          firstName: leadData.firstName,
          lastName: leadData.lastName,
          email: leadData.email,
          company: leadData.companyName ?? "",
        }}
        onSent={() => {
          setNotice("Email sent");
          void reload();
          router.refresh();
        }}
      />

      <EnrollDialog
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
        recordType="lead"
        recordId={leadData.id}
        recordName={fullName}
        onEnrolled={() => setNotice(`${leadData.firstName} enrolled in the sequence.`)}
      />

      <MergeDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        sourceType="lead"
        sourceId={leadData.id}
      />

      {!isConverted && leadData.email && leadData.duplicateCandidates.length === 0 && (
        <EmptyState
          className="border-0"
          icon={MailOpen}
          title="No duplicates found"
          description="This lead looks unique. You can still review related records."
        />
      )}
    </div>
  );
}
