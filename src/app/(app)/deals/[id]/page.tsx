"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Briefcase,
  Building2,
  CheckCircle2,
  Paperclip,
  StickyNote,
  Trash2,
  Users,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { api, ApiError } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";

type Deal = {
  id: string;
  name: string;
  value: number;
  currency: string;
  status: string;
  probability: number;
  nextStep: string;
  summary: string;
  expectedCloseDate: string | null;
  actualCloseDate: string | null;
  wonAt: string | null;
  lostAt: string | null;
  lostReason: string;
  createdAt: string;
  updatedAt: string;
  stage: { id: string; name: string; type: string; probability: number; position: number };
  pipeline: { id: string; name: string };
  contact: { id: string; firstName: string; lastName: string; email: string } | null;
  company: { id: string; name: string } | null;
  owner: { id: string; name: string; avatarColor: string } | null;
  source: { id: string; name: string } | null;
};

type Activity = {
  id: string;
  type: string;
  title: string;
  description: string;
  occurredAt: string;
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

type AttachmentItem = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  uploadedBy: { id: string; name: string } | null;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${Math.round(mb / 1024)} GB`;
}


export default function DealDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [deal, setDeal] = useState<Deal | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");

  const [noteBody, setNoteBody] = useState("");
  const [noteError, setNoteError] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [noteFile, setNoteFile] = useState<File | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const d = await api.get<Deal>(`/api/deals/${id}`);
      setDeal(d);
      const [acts, tks, atts] = await Promise.all([
        api.get<{ activities: Activity[] }>(`/api/activities?dealId=${id}&pageSize=15`),
        api.get<{ tasks: TaskItem[] }>(`/api/tasks?relatedType=deal&relatedId=${id}&pageSize=10`),
        api.get<{ attachments: AttachmentItem[] }>(`/api/attachments?entityType=DEAL&entityId=${id}`),
      ]);
      setActivities(acts.activities);
      setTasks(tks.tasks);
      setAttachments(atts.attachments);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setError(e instanceof ApiError ? e.message : "Failed to load deal");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function uploadFileToEntity(file: File, entityType: string, entityId: string) {
    const formData = new FormData();
    formData.append("entityType", entityType);
    formData.append("entityId", entityId);
    formData.append("file", file);
    setUploadError("");
    const res = await fetch("/api/attachments", {
      method: "POST",
      credentials: "same-origin",
      body: formData,
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error((payload as { error?: { message?: string } })?.error?.message ?? "Upload failed");
    }
  }

  async function deleteAttachment(attachmentId: string) {
    setUploadError("");
    const res = await fetch(`/api/attachments/${attachmentId}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setUploadError((payload as { error?: { message?: string } })?.error?.message ?? "Delete failed");
      return;
    }
    await load();
  }

  async function handleUploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setUploadError("");
    try {
      for (let i = 0; i < files.length; i++) {
        await uploadFileToEntity(files[i], "DEAL", id);
      }
      await load();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
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
        dealId: id,
      });
      setNoteBody("");
      setNoteFile(null);
      await load();
    } catch (e) {
      setNoteError(e instanceof ApiError ? e.message : "Failed to save note");
    } finally {
      setSavingNote(false);
    }
  }

  if (notFound) {
    return (
      <EmptyState
        icon={Briefcase}
        title="Deal not found"
        description="It may have been deleted."
        action={
          <Link href="/pipeline">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4" /> Back to pipeline
            </Button>
          </Link>
        }
      />
    );
  }
  if (!deal) {
    return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  }

  const currency = deal.currency || "USD";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/pipeline">
          <Button variant="ghost" size="icon" aria-label="Back to pipeline">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <Avatar name={deal.name} color={deal.owner?.avatarColor ?? "#6366f1"} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">{deal.name}</h1>
          <p className="text-sm text-muted-foreground">
            {deal.stage?.name}
            {deal.contact ? ` \u00b7 ${deal.contact.firstName} ${deal.contact.lastName}` : ""}
            {deal.company ? ` \u00b7 ${deal.company.name}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={deal.status === "WON" ? "success" : deal.status === "LOST" ? "destructive" : "default"}>
            {deal.status}
          </Badge>
          <span className="text-sm font-medium">
            {new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(deal.value)}
          </span>
        </div>
      </div>

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{deal.status}</Badge>
                <span className="text-xs text-muted-foreground">Owner: {deal.owner?.name ?? "Unassigned"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Win probability</span>
                <span className="text-xs font-medium">{deal.probability}%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Next step</span>
                <span className="text-xs truncate">{deal.nextStep || "\u2014"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Expected close</span>
                <span className="text-xs">{deal.expectedCloseDate ? formatDate(deal.expectedCloseDate) : "\u2014"}</span>
              </div>
              {deal.company && (
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <Link href={`/companies/${deal.company.id}`} className="hover:underline truncate">
                    {deal.company.name}
                  </Link>
                </div>
              )}
              {deal.contact && (
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <Link href={`/contacts/${deal.contact.id}`} className="hover:underline truncate">
                    {deal.contact.firstName} {deal.contact.lastName}
                  </Link>
                </div>
              )}
              {deal.summary && (
                <div className="pt-2">
                  <p className="text-xs text-muted-foreground">Summary</p>
                  <p className="text-sm">{deal.summary}</p>
                </div>
              )}
              <div className="pt-2 text-xs text-muted-foreground">
                <p>Created {formatDate(deal.createdAt)}</p>
                <p>Updated {timeAgo(deal.updatedAt)}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Attachments</CardTitle>
              {uploadError && <span className="text-xs text-destructive" role="alert">{uploadError}</span>}
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="file"
                  multiple
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                  onChange={(e) => void handleUploadFiles(e.target.files)}
                  disabled={uploading}
                  className="sr-only"
                  id="deal-upload"
                />
                <label htmlFor="deal-upload" className="flex items-center gap-2 rounded-md border border-input bg-input px-3 py-2 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                  <Paperclip className="h-4 w-4" />
                  {uploading ? "Uploading\u2026" : "Upload files"}
                </label>
              </div>
              {attachments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No attachments yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {attachments.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                      <a
                        href={`/api/attachments/${a.id}`}
                        download
                        className="min-w-0 flex-1 truncate hover:underline"
                        title={a.originalName}
                      >
                        {a.originalName}
                      </a>
                      <span className="text-xs text-muted-foreground">{formatFileSize(a.size)} \u00b7 {a.mimeType}</span>
                      <span className="text-xs text-muted-foreground">
                        {a.uploadedBy?.name ?? "You"} \u00b7 {formatDateTime(a.createdAt)}
                      </span>
                      <button
                        onClick={() => void deleteAttachment(a.id)}
                        className="text-xs text-muted-foreground hover:text-destructive underline"
                        aria-label={`Delete ${a.originalName}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <StickyNote className="h-4 w-4" /> Add note
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <textarea
                placeholder="Internal note \u2014 visible to your team\u2026"
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                aria-label="Note body"
                className="block w-full rounded-md border border-input bg-input px-3 py-2 text-sm ring-offset-transparent placeholder:text-muted-foreground focus-visible:ring-ring focus-visible:ring-1 focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
              {noteError && (
                <p className="text-xs text-destructive" role="alert">{noteError}</p>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                  onChange={(e) => setNoteFile(e.target.files?.[0] ?? null)}
                  className="border border-input bg-input rounded-md px-2 py-1 text-xs cursor-pointer"
                />
                {noteFile && (
                  <span className="text-xs text-muted-foreground truncate max-w-[14rem]" title={noteFile.name}>
                    Attached: {noteFile.name} ({formatFileSize(noteFile.size)})
                    <button
                      onClick={(e) => { e.stopPropagation(); setNoteFile(null); }}
                      className="ml-1 text-xs text-destructive hover:underline"
                    >
                      Remove
                    </button>
                  </span>
                )}
              </div>
              <div className="flex justify-end">
                <Button size="sm" onClick={() => void addNote()} disabled={savingNote}>
                  {savingNote ? "Saving\u2026" : "Add note"}
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
                  No activity yet. Add a note.
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
                        {a.user.name} \u00b7 {formatDateTime(a.occurredAt)}
                      </p>
                    </li>
                  ))}
                </ol>
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
      </div>
    </div>
  );
}
