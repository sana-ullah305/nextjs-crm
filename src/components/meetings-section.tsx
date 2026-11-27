"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, Phone, Trash2, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

type Attendee = {
  id: string;
  status: string;
  user: { id: string; name: string } | null;
  contact: { id: string; firstName: string; lastName: string } | null;
};

type Meeting = {
  id: string;
  title: string;
  startTime: string;
  endTime: string | null;
  location: string;
  meetingUrl: string;
  status: string;
  outcome: string;
  recordingUrl: string;
  attendees: Attendee[];
};

type Props = {
  contactId?: string;
  leadId?: string;
  dealId?: string;
};

// MeetingsSection lists meetings for a record and lets the user schedule one.
// contactId links the meeting via an attendee row; lead/deal scoping is
// provided for future detail pages.
export function MeetingsSection({ contactId }: Props) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("");
  const [location, setLocation] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");

  const load = useCallback(async () => {
    if (!contactId) return;
    try {
      const res = await api.get<{ meetings: Meeting[] }>(
        `/api/meetings?contactId=${contactId}&pageSize=50`
      );
      setMeetings(res.meetings);
    } catch {
      // Non-fatal: section simply renders empty.
    }
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function schedule() {
    if (!title.trim() || !startTime) {
      setError("Title and start time are required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.post("/api/meetings", {
        title,
        startTime: new Date(startTime).toISOString(),
        location,
        meetingUrl,
        attendeeContactIds: contactId ? [contactId] : [],
      });
      setOpen(false);
      setTitle("");
      setStartTime("");
      setLocation("");
      setMeetingUrl("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to schedule meeting");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.delete(`/api/meetings/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to delete meeting");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Video className="h-4 w-4" /> Meetings
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          <CalendarPlus className="h-4 w-4" /> Schedule meeting
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {open && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Meeting title" />
            <Input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} aria-label="Start time" />
            <Input placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} aria-label="Location" />
            <Input placeholder="Meeting URL" value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} aria-label="Meeting URL" />
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void schedule()} disabled={saving}>
                {saving ? "Saving…" : "Schedule"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {meetings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No meetings.</p>
        ) : (
          meetings.map((m) => (
            <div key={m.id} className="rounded-md border border-border p-2.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{m.title}</span>
                <Badge variant={m.status === "COMPLETED" ? "success" : m.status === "CANCELLED" ? "destructive" : "default"}>
                  {m.status}
                </Badge>
                <Button size="icon" variant="ghost" aria-label="Delete meeting" onClick={() => void remove(m.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{formatDateTime(m.startTime)}{m.location ? ` · ${m.location}` : ""}</p>
              {m.meetingUrl && (
                <a href={m.meetingUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                  Join meeting
                </a>
              )}
              {m.recordingUrl && (
                <a href={m.recordingUrl} target="_blank" rel="noreferrer" className="ml-3 text-xs text-primary hover:underline">
                  Recording
                </a>
              )}
              {m.outcome && <p className="mt-1 text-xs text-muted-foreground">Outcome: {m.outcome}</p>}
              {m.attendees.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {m.attendees.length} attendee{m.attendees.length === 1 ? "" : "s"}
                </p>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// CallsSection lists logged calls for a record and lets the user log one.
export function CallsSection({ contactId, leadId, dealId }: Props) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [direction, setDirection] = useState("OUTBOUND");
  const [duration, setDuration] = useState("");
  const [outcome, setOutcome] = useState("");

  const scope = contactId
    ? `contactId=${contactId}`
    : leadId
      ? `leadId=${leadId}`
      : dealId
        ? `dealId=${dealId}`
        : "";

  const load = useCallback(async () => {
    if (!scope) return;
    try {
      const res = await api.get<{ calls: Call[] }>(`/api/calls?${scope}&pageSize=50`);
      setCalls(res.calls);
    } catch {
      // Non-fatal.
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  async function log() {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.post("/api/calls", {
        title,
        direction,
        duration: duration ? Number(duration) : 0,
        outcome,
        ...(contactId ? { contactId } : {}),
        ...(leadId ? { leadId } : {}),
        ...(dealId ? { dealId } : {}),
      });
      setOpen(false);
      setTitle("");
      setDuration("");
      setOutcome("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to log call");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.delete(`/api/calls/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to delete call");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Phone className="h-4 w-4" /> Calls
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          <Phone className="h-4 w-4" /> Log call
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {open && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Call title" />
            <div className="grid grid-cols-3 gap-2">
              <select
                className="h-9 rounded-md border border-input bg-card px-2 text-sm"
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                aria-label="Direction"
              >
                <option value="OUTBOUND">Outbound</option>
                <option value="INBOUND">Inbound</option>
              </select>
              <Input type="number" placeholder="Seconds" value={duration} onChange={(e) => setDuration(e.target.value)} aria-label="Duration in seconds" />
              <Input placeholder="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome" />
            </div>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void log()} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {calls.length === 0 ? (
          <p className="text-sm text-muted-foreground">No calls logged.</p>
        ) : (
          calls.map((c) => (
            <div key={c.id} className="rounded-md border border-border p-2.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{c.title}</span>
                <Badge variant="outline">{c.direction}</Badge>
                <Button size="icon" variant="ghost" aria-label="Delete call" onClick={() => void remove(c.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(c.calledAt)} · {c.duration}s{c.outcome ? ` · ${c.outcome}` : ""}
              </p>
              {c.recordingUrl && (
                <a href={c.recordingUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                  Recording
                </a>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

type Call = {
  id: string;
  title: string;
  direction: string;
  duration: number;
  outcome: string;
  recordingUrl: string;
  calledAt: string;
};
