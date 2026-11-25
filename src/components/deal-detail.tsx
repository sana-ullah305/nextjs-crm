"use client";

import { useCallback, useState } from "react";
import { ArrowRight, CheckCircle2, Mail, Phone, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api-client";
import { formatCompactCurrency, formatDate, formatDateTime, timeAgo } from "@/lib/format";
import type { ActivityItem, Deal, EmailItem, TaskItem } from "@/lib/api-client";

type DealDetailProps = {
  deal: Deal;
  activities: ActivityItem[];
  emails: EmailItem[];
  tasks: TaskItem[];
  onMarkWon: () => void;
  onMarkLost: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddNote: (body: string) => void;
};

const STAGE_VARIANT: Record<string, "default" | "success" | "destructive" | "outline" | "secondary"> = {
  WON: "success",
  LOST: "destructive",
} as const;

function stageVariant(type: string) {
  return STAGE_VARIANT[type] ?? "default";
}

export function DealDetail({
  deal,
  activities,
  emails,
  tasks,
  onMarkWon,
  onMarkLost,
  onEdit,
  onDelete,
  onAddNote,
}: DealDetailProps) {
  const isOpen = deal.status === "OPEN";
  const [noteBody, setNoteBody] = useState("");
  const [noteError, setNoteError] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  const notes = activities.filter((a) => a.type === "NOTE");
  const otherActivities = activities.filter((a) => a.type !== "NOTE");
  const history = [...deal.stageHistory].sort((a, b) => a.at.localeCompare(b.at));

  async function addNote() {
    if (!noteBody.trim()) {
      setNoteError("Note cannot be empty");
      return;
    }
    setAddingNote(true);
    setNoteError("");
    try {
      await onAddNote(noteBody.trim());
      setNoteBody("");
    } catch (e) {
      setNoteError(e instanceof ApiError ? e.message : "Failed to save note");
    } finally {
      setAddingNote(false);
    }
  }

  const wonStage = deal.pipeline.stages.find((s) => s.type === "WON");
  const lostStage = deal.pipeline.stages.find((s) => s.type === "LOST");

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b pb-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{deal.name}</h1>
            <Badge variant={stageVariant(deal.stage.type)}>
              {deal.stage.name} ({deal.stage.probability}%)
            </Badge>
            <Badge variant={deal.status === "WON" ? "success" : deal.status === "LOST" ? "destructive" : "default"}>
              {deal.status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Pipeline: {deal.pipeline.name}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <span className="text-3xl font-bold">
            {formatCompactCurrency(deal.value, deal.currency)}
          </span>
          {deal.expectedCloseDate && (
            <p className="text-sm text-muted-foreground">
              Expected close: {formatDate(deal.expectedCloseDate)}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Owner</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium">{deal.owner?.name ?? "Unassigned"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Contact</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium">{deal.contact ? `${deal.contact.firstName} ${deal.contact.lastName}` : "Unassigned"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Company</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium">{deal.company?.name ?? "Unassigned"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Probability</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium">{deal.probability}%</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm font-medium">{deal.status}</p>
            {deal.wonAt && <p className="text-xs text-muted-foreground">Won: {formatDateTime(deal.wonAt)}</p>}
            {deal.lostAt && <p className="text-xs text-muted-foreground">Lost: {formatDateTime(deal.lostAt)}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Next step</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{deal.nextStep || "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Lost reason</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{deal.lostReason || "—"}</p>
          </CardContent>
        </Card>
        <Card className="md:col-span-4">
          <CardHeader>
            <CardTitle className="text-sm">Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{deal.summary || "No summary recorded."}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        {isOpen && wonStage && (
          <Button onClick={onMarkWon} variant="success">
            Mark Won
          </Button>
        )}
        {isOpen && lostStage && (
          <Button onClick={onMarkLost} variant="destructive">
            Mark Lost
          </Button>
        )}
        <Button onClick={onEdit}>Edit</Button>
        <Button onClick={onDelete} variant="destructive" size="sm">
          Delete
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stage history</CardTitle>
          <CardDescription>{history.length} stage change{history.length !== 1 ? "s" : ""}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stage changes yet.</p>
          ) : (
            <>
              {history.map((h, i) => {
                const isFirst = i === 0;
                const won = h.toStage.type === "WON";
                const lost = h.toStage.type === "LOST";
                return (
                  <div key={h.id} className="flex gap-3">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-xs">
                      {h.user.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium leading-none">
                        {isFirst ? "Started in" : h.fromStage?.name ?? "Unknown stage"}{" "}
                        <span className="text-muted-foreground">→</span>{" "}
                        {h.toStage.name}
                      </p>
                      <p className="text-xs text-muted-foreground leading-none">
                        {h.user.name} · {formatDateTime(h.at)} ({timeAgo(h.at)})
                      </p>
                    </div>
                    {(won || lost) && (
                      <Badge variant={won ? "success" : "destructive"} className="shrink-0">
                        {won ? "Won" : "Lost"}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activities</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {otherActivities.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity recorded.</p>
          ) : (
            <ol className="space-y-4">
              {otherActivities.map((a) => (
                <li key={a.id} className="flex gap-3">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-xs">
                    {a.user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{a.title}</p>
                    {a.description && <p className="text-xs text-muted-foreground line-clamp-1">{a.description}</p>}
                    <p className="text-xs text-muted-foreground leading-none">
                      {a.user.name} · {formatDateTime(a.occurredAt)} ({timeAgo(a.occurredAt)})
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          ) : (
            <ol className="space-y-4">
              {notes.map((a) => (
                <li key={a.id} className="flex gap-3">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-xs">
                    {a.user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm">{a.description}</p>
                    <p className="text-xs text-muted-foreground leading-none">
                      {a.user.name} · {formatDateTime(a.occurredAt)} ({timeAgo(a.occurredAt)})
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Label htmlFor="deal-note">Add note</Label>
            <div className="flex flex-col gap-1">
              <Textarea
                id="deal-note"
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Write a note…"
                className="resize-none h-24"
              />
              {noteError && <p className="text-xs text-destructive" role="alert">{noteError}</p>}
            </div>
            <Button
              onClick={addNote}
              disabled={addingNote || !noteBody.trim()}
              className="md:col-span-2 lg:col-span-3 self-start"
            >
              {addingNote ? "Saving…" : "Save note"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Emails</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {emails.length === 0 ? (
            <p className="text-sm text-muted-foreground">No emails linked to this deal.</p>
          ) : (
            <ol className="space-y-3">
              {emails.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-xs shrink-0">
                    <Mail className="h-3 w-3" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{e.subject}</p>
                    <p className="text-xs text-muted-foreground leading-none">
                      {e.recipientName || e.recipientEmail} · {e.status} · {formatDateTime(e.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tasks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks linked to this deal.</p>
          ) : (
            <ol className="space-y-3">
              {tasks.map((t) => (
                <li key={t.id} className="flex gap-3">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-xs shrink-0">
                    <CheckCircle2 className="h-3 w-3" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{t.title}</p>
                    <p className="text-xs text-muted-foreground leading-none">
                      {t.type} · {t.status}{t.dueAt ? ` · ${formatDate(t.dueAt)}` : ""}{t.assignedUser ? ` · ${t.assignedUser.name}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
