"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Briefcase,
  Building2,
  CheckCircle2,
  Copy,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Repeat,
  Send,
  StickyNote,
  Trash2,
  Users,
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
import { findDuplicateCandidatesClient, type DuplicateCandidate } from "@/lib/duplicate-search";
import { api, ApiError, validationDetails } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatDateTime, timeAgo } from "@/lib/format";

type Contact = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  mobile: string;
  title: string;
  status: string;
  address: string;
  city: string;
  state: string;
  country: string;
  avatarColor: string;
  lastContactedAt: string | null;
  createdAt: string;
  company: { id: string; name: string; industry: string } | null;
  owner: { id: string; name: string; avatarColor: string } | null;
  tags: { id: string; name: string; color: string }[];
};

type Activity = {
  id: string;
  type: string;
  title: string;
  description: string;
  occurredAt: string;
  user: { id: string; name: string; avatarColor: string };
};

type Note = {
  id: string;
  body: string;
  createdAt: string;
  user: { id: string; name: string; avatarColor: string };
};

type TaskItem = {
  id: string;
  title: string;
  type: string;
  priority: string;
  status: string;
  dueAt: string | null;
  assignedUser: { id: string; name: string; avatarColor: string } | null;
};

type DealItem = { id: string; name: string; value: number; status: string; stage: { name: string } };

export default function ContactDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [contact, setContact] = useState<Contact | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [deals, setDeals] = useState<DealItem[]>([]);
  const { success: toastSuccess, error: toastError, warning: toastWarning } = useToast();
  const [notFound, setNotFound] = useState(false);

  const [noteBody, setNoteBody] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const [logOpen, setLogOpen] = useState(false);
  const [activityType, setActivityType] = useState("CALL");
  const [activityTitle, setActivityTitle] = useState("");
  const [activityDuration, setActivityDuration] = useState("");

  const [editOpen, setEditOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [dupes, setDupes] = useState<DuplicateCandidate[]>([]);

  useEffect(() => {
    if (!contact) return;
    let cancelled = false;
    findDuplicateCandidatesClient({
      id: contact.id,
      type: "contact",
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      companyName: contact.company?.name ?? "",
    })
      .then((found) => {
        if (!cancelled) {
          setDupes(found);
          if (found.length > 0) {
            toastWarning({
              title: "Potential duplicates found",
              description: found.length + " record" + (found.length === 1 ? "" : "s") + " may be the same person (best match: " + found[0].score + "%" + (found[0].email ? ", " + found[0].email : "") + ").",
            });
          }
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [contact, toastWarning]);

  const load = useCallback(async () => {
    try {
      const c = await api.get<Contact>(`/api/contacts/${id}`);
      setContact(c);
      const [acts, tks, dls] = await Promise.all([
        api.get<{ activities: Activity[] }>(`/api/activities?contactId=${id}&pageSize=15`),
        api.get<{ tasks: TaskItem[] }>(`/api/tasks?relatedType=contact&relatedId=${id}&status=PENDING&pageSize=10`),
        api.get<{ deals: DealItem[] }>(`/api/deals?contactId=${id}`),
      ]);
      setActivities(acts.activities);
      setTasks(tks.tasks);
      setDeals(
        (dls.deals as unknown as DealItem[]).map((d) => ({
          id: d.id,
          name: d.name,
          value: d.value,
          status: d.status,
          stage: { name: (d as unknown as { stage: { name: string } }).stage.name },
        }))
      );
      // Notes ride on the activity feed; also fetch explicit notes:
      const actsWithNotes = await api.get<{ activities: Activity[] }>(`/api/activities?contactId=${id}`);
      void actsWithNotes;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else toastError({ description: e instanceof ApiError ? e.message : "Failed to load contact" });
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addNote() {
    if (!noteBody.trim()) {
      toastError({ description: "Note cannot be empty" });
      return;
    }
    setSavingNote(true);
    try {
      const created = await api.post<Note>("/api/activities/note", {
        body: noteBody,
        contactId: id,
      });
      setNotes((n) => [created, ...n]);
      setNoteBody("");
      await load();
      toastSuccess({ description: "Note added" });
    } catch (e) {
      toastError({ description: e instanceof ApiError ? e.message : "Failed to save note" });
    } finally {
      setSavingNote(false);
    }
  }

  async function logActivity() {
    setSubmitting(true);
    try {
      await api.post("/api/activities", {
        type: activityType,
        title: activityTitle || `${activityType} with ${contact?.firstName ?? "contact"}`,
        contactId: id,
        durationMinutes: activityDuration ? Number(activityDuration) : undefined,
      });
      setLogOpen(false);
      setActivityTitle("");
      setActivityDuration("");
      await load();
      toastSuccess({ description: "Activity logged" });
    } catch (e) {
      toastError({ description: e instanceof ApiError ? e.message : "Failed to log activity" });
    } finally {
      setSubmitting(false);
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormErrors({});
    try {
      await api.patch(`/api/contacts/${id}`, {
        ...formValues,
        tags: (formValues.tags ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setEditOpen(false);
      await load();
      toastSuccess({ description: "Contact updated" });
    } catch (e) {
      setFormErrors(validationDetails(e));
      toastError({ description: e instanceof ApiError ? e.message : "Update failed" });
    } finally {
      setSubmitting(false);
    }
  }

  if (notFound) {
    return (
      <EmptyState
        icon={Users}
        title="Contact not found"
        description="It may have been deleted."
        action={
          <Link href="/contacts">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4" /> Back to contacts
            </Button>
          </Link>
        }
      />
    );
  }
  if (!contact) {
    return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  }

  const editFields: FieldDef[] = [
    { name: "firstName", label: "First name", required: true },
    { name: "lastName", label: "Last name", required: true },
    { name: "email", label: "Email" },
    { name: "phone", label: "Phone" },
    { name: "title", label: "Job title" },
    { name: "city", label: "City" },
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
    { name: "tags", label: "Tags (comma separated)", colSpan: 2 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/contacts">
          <Button variant="ghost" size="icon" aria-label="Back to contacts">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <Avatar name={`${contact.firstName} ${contact.lastName}`} color={contact.avatarColor} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">
            {contact.firstName} {contact.lastName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {contact.title}
            {contact.company ? ` at ${contact.company.name}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEnrollOpen(true)}
            disabled={!contact.email}
          >
            <Repeat className="h-4 w-4" /> Enroll
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setComposeOpen(true)}
            disabled={!contact.email}
          >
            <Send className="h-4 w-4" /> Email
          </Button>
          {dupes.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setMergeOpen(true)}
              className="border-warning/40 text-warning hover:bg-warning/10"
            >
              <Copy className="h-4 w-4 mr-1" /> Review duplicates ({dupes.length})
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setFormValues({
              firstName: contact.firstName,
              lastName: contact.lastName,
              email: contact.email,
              phone: contact.phone,
              title: contact.title,
              city: contact.city,
              status: contact.status,
              tags: contact.tags.map((t) => t.name).join(", "),
            });
            setEditOpen(true);
          }}
        >
            <Pencil className="h-4 w-4" /> Edit
          </Button>
        </div>
      </div>

      <ComposeEmail
        open={composeOpen}
        onOpenChange={setComposeOpen}
        defaultTo={{ email: contact.email, name: `${contact.firstName} ${contact.lastName}` }}
        contactId={contact.id}
        templateVars={{
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          company: contact.company?.name ?? "",
          ownerName: contact.owner?.name ?? "",
        }}
        onSent={() => void load()}
      />




      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant={contact.status === "CHURNED" ? "destructive" : "default"}>{contact.status}</Badge>
                <span className="text-xs text-muted-foreground">Owner: {contact.owner?.name ?? "Unassigned"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                <a href={contact.email ? `mailto:${contact.email}` : undefined} className="truncate hover:underline">
                  {contact.email || "—"}
                </a>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span>{contact.phone || contact.mobile || "—"}</span>
              </div>
              {contact.company && (
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <Link href={`/companies/${contact.company.id}`} className="hover:underline">
                    {contact.company.name}
                  </Link>
                </div>
              )}
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span>{[contact.city, contact.state, contact.country].filter(Boolean).join(", ") || "—"}</span>
              </div>
              <div className="pt-2 text-xs text-muted-foreground">
                <p>Created {formatDate(contact.createdAt)}</p>
                <p>Last contacted {contact.lastContactedAt ? timeAgo(contact.lastContactedAt) : "never"}</p>
              </div>
              {contact.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {contact.tags.map((t) => (
                    <Badge key={t.id} variant="secondary">
                      {t.name}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Open deals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {deals.length === 0 ? (
                <p className="text-sm text-muted-foreground">No deals.</p>
              ) : (
                deals.map((d) => (
                  <Link key={d.id} href="/pipeline" className="flex items-center justify-between rounded-md border border-border p-2.5 hover:bg-muted/50">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{d.name}</p>
                      <p className="text-xs text-muted-foreground">{d.stage?.name}</p>
                    </div>
                    <Badge variant={d.status === "WON" ? "success" : d.status === "LOST" ? "destructive" : "default"}>
                      {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(d.value)}
                    </Badge>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Open tasks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open tasks.</p>
              ) : (
                tasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 rounded-md border border-border p-2.5 text-sm">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <Badge variant="outline">{t.type}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Quick actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setLogOpen(true)}>
                <Phone className="h-4 w-4" /> Log call / meeting
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await api.post("/api/tasks", {
                      title: `Follow up with ${contact.firstName}`,
                      type: "FOLLOW_UP",
                      relatedType: "contact",
                      relatedId: id,
                    });
                    await load();
                    toastSuccess({ description: "Follow-up scheduled" });
                  } catch (e) {
                    toastError({ description: e instanceof ApiError ? e.message : "Failed to create task" });
                  }
                }}
              >
                <Plus className="h-4 w-4" /> Schedule follow-up
              </Button>
            </CardContent>
          </Card>

          {logOpen && (
            <Card>
              <CardHeader>
                <CardTitle>Log activity</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-4">
                <select
                  className="h-9 rounded-md border border-input bg-card px-2 text-sm"
                  value={activityType}
                  onChange={(e) => setActivityType(e.target.value)}
                  aria-label="Activity type"
                >
                  <option value="CALL">Call</option>
                  <option value="MEETING">Meeting</option>
                  <option value="EMAIL">Email</option>
                </select>
                <Input
                  placeholder="What happened?"
                  value={activityTitle}
                  onChange={(e) => setActivityTitle(e.target.value)}
                  aria-label="Activity title"
                />
                <Input
                  type="number"
                  placeholder="Minutes"
                  value={activityDuration}
                  onChange={(e) => setActivityDuration(e.target.value)}
                  aria-label="Duration in minutes"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void logActivity()} disabled={submitting}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setLogOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <StickyNote className="h-4 w-4" /> Add note
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Textarea
                placeholder="Internal note — visible to your team…"
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                aria-label="Note body"
              />
              <div className="flex justify-end">
                <Button size="sm" onClick={() => void addNote()} disabled={savingNote}>
                  {savingNote ? "Saving…" : "Add note"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {activities.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No activity yet. Log a call or add a note.
                </p>
              ) : (
                <ol className="relative space-y-4 border-l border-border pl-5">
                  {activities.map((a) => (
                    <li key={a.id} className="relative">
                      <span className="absolute top-1.5 -left-[26px] h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background" />
                      <div className="flex flex-wrap items-center gap-2">
                        <Avatar name={a.user.name} color={a.user.avatarColor} size="sm" />
                        <p className="text-sm font-medium">{a.title}</p>
                        <Badge variant="outline">{a.type.replace("_", " ")}</Badge>
                      </div>
                      {a.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{a.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {a.user.name} · {formatDateTime(a.occurredAt)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <EntityForm
        open={editOpen}
        onOpenChange={setEditOpen}
        title="Edit contact"
        fields={editFields}
        values={formValues}
        errors={formErrors}
        submitting={submitting}
        onChange={(name, value) => setFormValues((v) => ({ ...v, [name]: value }))}
        onSubmit={saveEdit}
      />

      <EnrollDialog
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
        recordType="contact"
        recordId={contact.id}
        recordName={`${contact.firstName} ${contact.lastName}`}
        onEnrolled={() => void load()}
      />

      <MergeDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        sourceType="contact"
        sourceId={contact.id}
      />
    </div>
  );
}

