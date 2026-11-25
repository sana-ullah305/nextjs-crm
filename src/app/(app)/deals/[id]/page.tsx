"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  api,
  dealApi,
  lostReasonApi,
  type ActivityItem,
  ApiError,
  type Deal,
  type EmailItem,
  type TaskItem,
} from "@/lib/api-client";
import { DealForm } from "@/components/deal-form";
import { DealDetail } from "@/components/deal-detail";

export default function DealDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [deal, setDeal] = useState<Deal | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [lostReasons, setLostReasons] = useState<Array<{ id: string; name: string }>>([]);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");

  const [editOpen, setEditOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [lostReasonId, setLostReasonId] = useState("");
  const [lostNote, setLostNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await dealApi.get(id);
      setDeal(d);
      const [acts, ems, tks, reasons] = await Promise.all([
        api.get<{ activities: ActivityItem[] }>(`/api/activities?dealId=${id}&pageSize=50`),
        api.get<{ emails: EmailItem[] }>(`/api/emails?dealId=${id}`),
        api.get<{ tasks: TaskItem[] }>(`/api/tasks?relatedType=deal&relatedId=${id}&pageSize=50`),
        lostReasonApi.list(),
      ]);
      setActivities(acts.activities);
      setEmails(ems.emails);
      setTasks(tks.tasks);
      setLostReasons(reasons.lostReasons.map((r) => ({ id: r.id, name: r.name })));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setError(e instanceof ApiError ? e.message : "Failed to load deal");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const reload = useCallback(async () => {
    await load();
    await router.refresh();
  }, [load, router]);

  async function handleMarkWon() {
    const wonStage = deal?.pipeline.stages.find((s) => s.type === "WON");
    if (!deal || !wonStage) return;
    if (!window.confirm(`Mark "${deal.name}" as won?`)) return;
    setSubmitting(true);
    try {
      await dealApi.move(deal.id, { stageId: wonStage.id });
      setSubmitting(false);
      await reload();
    } catch (e) {
      setSubmitting(false);
      setError(e instanceof ApiError ? e.message : "Failed to mark deal as won");
    }
  }

  async function handleMarkLost() {
    if (!deal) return;
    const lostStage = deal.pipeline.stages.find((s) => s.type === "LOST");
    if (!lostStage) {
      setError("No lost stage configured in this pipeline");
      return;
    }
    if (!lostReasonId || !lostNote.trim()) return;
    setSubmitting(true);
    try {
      await dealApi.move(deal.id, { stageId: lostStage.id, lostReasonId });
      await dealApi.update(deal.id, { lostReason: lostNote.trim() });
      setSubmitting(false);
      setLostOpen(false);
      setLostReasonId("");
      setLostNote("");
      await reload();
    } catch (e) {
      setSubmitting(false);
      setError(e instanceof ApiError ? e.message : "Failed to mark deal as lost");
    }
  }

  async function saveEdit(values: {
    name: string;
    value: string;
    currency: string;
    probability: string;
    stageId: string;
    expectedCloseDate: string;
    nextStep: string;
    ownerId: string;
    contactId: string;
    companyId: string;
    tags: string;
  }) {
    if (!deal) return;
    setSubmitting(true);
    setError("");
    try {
      await dealApi.update(deal.id, {
        name: values.name,
        ...(values.value ? { value: Number(values.value) } : {}),
        ...(values.currency ? { currency: values.currency } : {}),
        ...(values.probability ? { probability: Number(values.probability) } : {}),
        ...(values.stageId ? { stageId: values.stageId } : {}),
        ...(values.contactId ? { contactId: values.contactId } : {}),
        ...(values.companyId ? { companyId: values.companyId } : {}),
        ...(values.ownerId ? { ownerId: values.ownerId } : {}),
        ...(values.expectedCloseDate ? { expectedCloseDate: values.expectedCloseDate } : {}),
        ...(values.nextStep ? { nextStep: values.nextStep } : {}),
      });
      setEditOpen(false);
      await reload();
    } catch (e) {
      setSubmitting(false);
      if (e instanceof ApiError && Array.isArray(e.details)) {
        const details = e.details as Array<{ path: (string | number)[]; message: string }>;
        setError(details[0] ? details[0].message : e.message);
      } else {
        setError(e instanceof ApiError ? e.message : "Failed to save deal");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deal || !window.confirm(`Delete "${deal.name}"?`)) return;
    setSubmitting(true);
    try {
      await dealApi.remove(deal.id);
      setDeleteOpen(false);
      await reload();
      void router.push("/pipeline");
    } catch (e) {
      setSubmitting(false);
      setError(e instanceof ApiError ? e.message : "Failed to delete deal");
    }
  }

  if (notFound) {
    return (
      <EmptyState
        icon={ArrowLeft}
        title="Deal not found"
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
  if (!deal) return <div className="h-96 animate-pulse rounded-lg bg-muted" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/pipeline">
          <Button variant="ghost" size="icon" aria-label="Back to pipeline">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Deal {deal.id.slice(-6)}</h1>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <DealDetail
        deal={deal}
        activities={activities}
        emails={emails}
        tasks={tasks}
        onMarkWon={handleMarkWon}
        onMarkLost={() => setLostOpen(true)}
        onEdit={() => setEditOpen(true)}
        onDelete={() => setDeleteOpen(true)}
        onAddNote={async (body) => {
          await api.post("/api/activities", {
            type: "NOTE",
            title: "Note added",
            description: body,
            dealId: deal.id,
          });
          await reload();
        }}
      />

      <DealForm
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        deal={deal}
        stages={deal.pipeline.stages.filter((s) => s.type === "OPEN")}
        onSave={saveEdit}
      />

      <Dialog open={lostOpen} onOpenChange={setLostOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark lost</DialogTitle>
            <DialogDescription>
              Select a lost reason and add a note explaining why the deal was lost.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); void handleMarkLost(); }} className="grid gap-3 pt-6">
            <div className="flex flex-col gap-1.5">
              <Label>Lost reason <span className="text-destructive ml-0.5">*</span></Label>
              <Select value={lostReasonId} onValueChange={setLostReasonId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a reason…" />
                </SelectTrigger>
                <SelectContent>
                  {lostReasons.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Note <span className="text-destructive ml-0.5">*</span></Label>
              <Textarea
                id="deal-lost-note"
                value={lostNote}
                onChange={(e) => setLostNote(e.target.value)}
                placeholder="e.g. Chose a competitor's solution"
                className="resize-none h-24"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLostOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting || !lostReasonId || !lostNote.trim()}
              >
                {submitting ? "Saving…" : "Mark lost"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete deal</DialogTitle>
            <DialogDescription>This soft-deletes the deal.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleDelete} disabled={submitting}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
