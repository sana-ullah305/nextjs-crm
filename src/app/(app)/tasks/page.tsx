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
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";

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
  const { success: toastSuccess, error: toastError } = useToast();
  const { confirm } = useConfirm();
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
      toastSuccess({ description: "Task created" });
      await load();
    } catch (e) {
      setFormErrors(validationDetails(e));
      toastError({ description: e instanceof ApiError ? e.message : "Save failed" });
    } finally {
      setSubmitting(false);
    }
  }

  async function setStatus(id: string, status: string) {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, status } : t)));
    try {
      await api.patch(`/api/tasks/${id}`, { status });
      toastSuccess({ description: `Task marked as ${status}` });
    } catch (e) {
      toastError({ description: e instanceof ApiError ? e.message : "Update failed" });
      await load();
    }
  }

  async function onDelete(t: Task) {
    confirm({
      title: "Delete task",
      description: `Delete task "${t.title}"?`,
      variant: "destructive",
      confirmText: "Delete",
      onConfirm: async () => {
        try {
          await api.delete(`/api/tasks/${t.id}`);
          toastSuccess({ description: "Task deleted" });
          await load();
        } catch (e) {
          toastError({ description: e instanceof ApiError ? e.message : "Delete failed" });
        }
      },
    });
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

      <div className="grid gap-4 md:grid-cols-3">
        {groups.map((group) => (
          <Card key={group.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center justify-between">
                {group.label}
                <Badge variant="outline">{group.items.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {group.items.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No tasks</p>
              ) : (
                <ul className="space-y-2 p-4">
                  {group.items.map((task) => (
                    <li
                      key={task.id}
                      className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-muted/50"
                    >
                      <div className="flex flex-col items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 p-0"
                          onClick={() => setStatus(task.id, task.status === "COMPLETED" ? "PENDING" : "COMPLETED")}
                          aria-label={task.status === "COMPLETED" ? "Mark pending" : "Mark complete"}
                        >
                          {task.status === "COMPLETED" ? (
                            <SkipForward className="h-4 w-4" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                        </Button>
                        {task.dueAt && (
                          <span className={cn("text-xs", new Date(task.dueAt) < new Date() && task.status !== "COMPLETED" ? "text-destructive" : "text-muted-foreground")}>
                            {relativeDue(task.dueAt)}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn("font-medium", task.status === "COMPLETED" && "line-through text-muted-foreground")}>
                          {task.title}
                        </p>
                        {task.description && (
                          <p className="text-sm text-muted-foreground line-clamp-1">{task.description}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs">
                          <Badge variant={PRIORITY_BADGE[task.priority] ?? "default"}>{task.priority}</Badge>
                          <Badge variant="outline">{task.type}</Badge>
                          {task.assignedUser && (
                            <span className="flex items-center gap-1 text-muted-foreground">
                              <Avatar name={task.assignedUser.name} color={task.assignedUser.avatarColor} size="sm" />
                              {task.assignedUser.name}
                            </span>
                          )}
                          {task.dueAt && (
                            <span className={cn("flex items-center gap-1", new Date(task.dueAt) < new Date() && task.status !== "COMPLETED" ? "text-destructive" : "text-muted-foreground")}>
                              <CalendarClock className="h-3 w-3" />
                              {formatDateTime(task.dueAt)}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => onDelete(task)}
                        aria-label={`Delete ${task.title}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <EntityForm
        open={formOpen}
        onOpenChange={setFormOpen}
        title="New task"
        description="Create a new task, call, or meeting"
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
