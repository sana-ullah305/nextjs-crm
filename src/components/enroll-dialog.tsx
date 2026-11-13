"use client";

import { useEffect, useState } from "react";
import { Repeat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, ApiError, validationDetails } from "@/lib/api-client";

export type SequenceOption = {
  id: string;
  name: string;
  isActive: boolean;
  steps: { id: string; position: number; delayHours: number; subjectTemplate: string }[];
};

export function loadActiveSequences(): Promise<SequenceOption[]> {
  return api
    .get<{ sequences: SequenceOption[] }>("/api/sequences")
    .then((d) => d.sequences.filter((s) => s.isActive))
    .catch(() => []);
}

export function EnrollDialog({
  open,
  onOpenChange,
  recordType,
  recordId,
  recordName,
  onEnrolled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recordType: "contact" | "lead";
  recordId: string;
  recordName: string;
  onEnrolled?: () => void;
}) {
  const [sequences, setSequences] = useState<SequenceOption[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSelected("");
    setNotice("");
    setError("");
    setFieldErrors({});
    loadActiveSequences()
      .then(setSequences)
      .finally(() => setLoading(false));
  }, [open]);

  async function enroll() {
    if (!selected) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      await api.post(`/api/sequences/${selected}/enroll`, {
        [recordType === "contact" ? "contactId" : "leadId"]: recordId,
      });
      setNotice(`${recordName} was enrolled. Follow-ups start automatically.`);
      onEnrolled?.();
      setTimeout(() => onOpenChange(false), 1200);
    } catch (e) {
      if (e instanceof ApiError && e.code === "ALREADY_ENROLLED") {
        setError(`${recordName} is already enrolled in that sequence.`);
      } else if (e instanceof ApiError && e.status === 400) {
        setFieldErrors(validationDetails(e));
        setError(e.message);
      } else {
        setError(e instanceof ApiError ? e.message : "Enrollment failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="h-4 w-4" /> Enroll {recordName} in a sequence
          </DialogTitle>
          <DialogDescription>
            Follow-up emails are sent automatically on the schedule of each step. Sending
            stops the moment a reply arrives.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="h-20 animate-pulse rounded-md bg-muted" />
        ) : sequences.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active sequences yet. An administrator or manager can create them in
            Settings → Sequences.
          </p>
        ) : (
          <div className="grid gap-2">
            {sequences.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-3 text-sm has-[:checked]:border-primary"
              >
                <input
                  type="radio"
                  name="sequence-choice"
                  className="h-4 w-4"
                  value={s.id}
                  checked={selected === s.id}
                  onChange={() => setSelected(s.id)}
                  aria-label={`Enroll in ${s.name}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{s.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {s.steps.length} step{s.steps.length === 1 ? "" : "s"} · first
                    email after {s.steps[0]?.delayHours ?? 0}h
                  </span>
                </span>
                <Badge variant="outline">{s.steps.length} steps</Badge>
              </label>
            ))}
          </div>
        )}

        {notice && (
          <p
            className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success"
            role="status"
          >
            {notice}
          </p>
        )}
        {error && (
          <p
            className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
            role="alert"
          >
            {error}
          </p>
        )}
        {Object.keys(fieldErrors).length > 0 && (
          <p className="text-xs text-destructive" role="alert">
            {Object.values(fieldErrors)[0]}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void enroll()} disabled={!selected || submitting}>
            {submitting ? "Enrolling…" : "Enroll"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
