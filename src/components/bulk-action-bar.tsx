"use client";

import { useState } from "react";
import { Trash2, UserPlus, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api-client";

export type BulkEntityType = "contacts" | "leads" | "deals";

type Props = {
  entityType: BulkEntityType;
  selectedIds: string[];
  users: { id: string; name: string }[];
  onClear: () => void;
  onChanged: () => void | Promise<void>;
  supportsTag?: boolean;
};

export function BulkActionBar({ entityType, selectedIds, users, onClear, onChanged, supportsTag }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [showTag, setShowTag] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [assigneeId, setAssigneeId] = useState("");

  if (selectedIds.length === 0) return null;

  async function run(action: "delete" | "assign" | "addTag", params?: Record<string, unknown>) {
    if (action === "delete") {
      if (!confirm(`Delete ${selectedIds.length} selected ${entityType}? This keeps history but removes them from views.`)) {
        return;
      }
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api.post<{ affected: number }>("/api/bulk", {
        entityType,
        ids: selectedIds,
        action,
        params,
      });
      setNotice(`${result.affected} ${entityType} ${action === "delete" ? "deleted" : action === "assign" ? "assigned" : "tagged"}`);
      setShowAssign(false);
      setShowTag(false);
      setAssigneeId("");
      setTagInput("");
      onClear();
      await onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Bulk action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {selectedIds.length} selected
        </span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void run("delete")}>
          <Trash2 className="h-4 w-4 text-destructive" /> Delete Selected
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setShowAssign((v) => !v)}>
          <UserPlus className="h-4 w-4" /> Assign to User
        </Button>
        {supportsTag && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setShowTag((v) => !v)}>
            <Tag className="h-4 w-4" /> Add Tag
          </Button>
        )}
        <Button variant="ghost" size="icon" aria-label="Clear selection" onClick={onClear}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      {showAssign && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-9 rounded-md border border-input bg-card px-2 text-sm"
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            aria-label="Assign to user"
          >
            <option value="">Select user…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={busy || !assigneeId}
            onClick={() => void run("assign", { assigneeId })}
          >
            Assign
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowAssign(false)}>
            Cancel
          </Button>
        </div>
      )}
      {showTag && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="h-9 max-w-xs"
            placeholder="Tag names (comma separated)"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
          />
          <Button
            size="sm"
            disabled={busy || !tagInput.trim()}
            onClick={() =>
              void run("addTag", {
                tagNames: tagInput
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              })
            }
          >
            Add Tag
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowTag(false)}>
            Cancel
          </Button>
        </div>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-xs text-success" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
