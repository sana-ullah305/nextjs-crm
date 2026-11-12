"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, SkipForward, Plus, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityForm, type FieldDef, type FieldErrors } from "@/components/entity-form";
import { api, ApiError, validationDetails } from "@/lib/api-client";
import { formatDateTime, relativeDue } from "@/lib/format";
import { cn } from "@/lib/cn";

type Task = {
  id: string;
  title: string;
  description: string;
  type: string;
  priority: string;
  status: string;
  dueAt: string | null;
  assignedUser: { id: string; name: string; avatarColor: string } | null;
};

type UserOption = { id: string; name: string };

const PRIORITY_BADGE: Record<string, "destructive" | "warning" | "default" | "secondary"> = {
  URGENT: "destructive",
  HIGH: "warning",
  MEDIUM: "default",
  LOW: "secondary",
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"open" | "overdue" | "completed">("open");
  const [users, setUsers] = useState<UserOption[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: "100" });
      if (filter === "completed") params.set("status", "COMPLETED");
      if (filter === "overdue") params.set("due", "overdue");
      const data = await api.get<{ tasks: Task[] }>(`/api/tasks?${params.toString()}`);
      setTasks(data.tasks);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api.get<{ users: UserOption[] }>("/api/settings/users").then((d) => setUsers(d.users)).catch(() => undefined);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormErrors({});
    try {
      await api.post("/api/tasks", {
        ...formValues,
        dueAt: formValues.dueAt || undefined,
        assignedUserId: formValues.assignedUserId || undefined,
      });
      setFormOpen(false);
      setFormValues({});
      await load();
    } catch (e) {
      setFormErrors(validationDetails(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function setStatus(id: string, status: string) {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status } : t)));
    try {
      await api.patch(`/api/tasks/${id}`, { status });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Update failed");
      await load();
    }
  }

  async function onDelete(t: Task) {
    if (!confirm(`Delete task "${t.title}"?`)) return;
    try {
      await api.delete(`/api/tasks/${t.id}`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Delete failed");
    }
  }

  const fields: FieldDef[] = [
    { name: "title", label: "Title", required: true, colSpan: 2, placeholder: "Follow up on renewal" },
    { name: "description", label: "Description", type: "textarea", colSpan: 2 },
    {
      name: "type",
      label: "Type",
      type: "select",
      options: [
        { label: "To-do", value: "TODO" },
        { label: "Call", value: "CALL" },
        { label: "Meeting", value: "MEETING" },
        { label: "Follow-up", value: "FOLLOW_UP" },
        { label: "Email", value: "EMAIL" },
      ],
    },
    {
      name: "priority",
      label: "Priority",
      type: "select",
      options: [
        { label: "Low", value: "LOW" },
        { label: "Medium", value: "MEDIUM" },
        { label: "High", value: "HIGH" },
        { label: "Urgent", value: "URGENT" },
      ],
    },
    { name: "dueAt", label: "Due date", type: "date" },
    {
      name: "assignedUserId",
      label: "Assign to",
      type: "select",
      options: users.map((u) => ({ label: u.name, value: u.id })),
    },
  ];

  const groups: { label: string; items: Task[] }[] = [
    { label: "Overdue", items: tasks.filter((t) => t.dueAt && new Date(t.dueAt) < new Date() && t.status !== "COMPLETED" && t.status !== "SKIPPED") },
    { label: "Upcoming", items: tasks.filter((t) => (!t.dueAt || (t.dueAt && new Date(t.dueAt) >= new Date())) && t.status !== "COMPLETED" && t.status !== "SKIPPED") },
    { label: "Completed / skipped", items: tasks.filter((t) => t.status === "COMPLETED" || t.status === "SKIPPED") },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Tasks</h1>
          <p className="text-sm text-muted-foreground">Calls, meetings, follow-ups, and to-dos</p>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-md border border-border" role="tablist" aria-label="Task filter">
            {(["open", "overdue", "completed"] as const).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium capitalize rounded-md",
                  filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                )}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            onClick={() => {
              setFormValues({ type: "TODO", priority: "MEDIUM" });
              setFormErrors({});
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New task
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <Card>
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        </Card>
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No tasks here"
          description={filter === "completed" ? "Nothing completed yet." : "Create a task to keep work on track."}
          action={
            <Button size="sm" onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4" /> New task
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {groups
            .filter((g) => g.items.length > 0)
            .map((group) => (
              <Card key={group.label}>
                <CardHeader>
                  <CardTitle>{group.label} ({group.items.length})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {group.items.map((t) => {
                    const overdue = t.dueAt && new Date(t.dueAt) < new Date() && t.status !== "COMPLETED";
                    return (
                      <div
                        key={t.id}
                        className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3"
                      >
                        {t.status === "COMPLETED" ? (
                          <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                        ) : (
                          <button
                            aria-label={`Complete ${t.title}`}
                            onClick={() => void setStatus(t.id, "COMPLETED")}
                            className="rounded-full border-2 border-muted-foreground/40 p-1 hover:border-success hover:text-success"
                          >
                            <span className="block h-2.5 w-2.5" />
                          </button>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className={cn("text-sm font-medium", t.status === "COMPLETED" && "text-muted-foreground line-through")}>
                            {t.title}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{t.description}</p>
                        </div>
                        <Badge variant="outline">{t.type}</Badge>
                        <Badge variant={PRIORITY_BADGE[t.priority] ?? "secondary"}>{t.priority}</Badge>
                        {t.dueAt && (
                          <span className={cn("flex items-center gap-1 text-xs", overdue ? "font-semibold text-destructive" : "text-muted-foreground")}>
                            <CalendarClock className="h-3.5 w-3.5" />
                            {relativeDue(t.dueAt)}
                          </span>
                        )}
                        {t.assignedUser && (
                          <Avatar name={t.assignedUser.name} color={t.assignedUser.avatarColor} size="sm" />
                        )}
                        {t.status !== "COMPLETED" && t.status !== "SKIPPED" && (
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" onClick={() => void setStatus(t.id, "SKIPPED")}>
                              <SkipForward className="h-3.5 w-3.5" /> Skip
                            </Button>
                            <Button variant="ghost" size="icon" aria-label={`Delete ${t.title}`} onClick={() => void onDelete(t)}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ))}
        </div>
      )}

      <EntityForm
        open={formOpen}
        onOpenChange={setFormOpen}
        title="New task"
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
