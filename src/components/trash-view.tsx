"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Trash2, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { api, ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

type TrashType = "company" | "contact" | "lead";

type TrashRow = {
  id: string;
  title: string;
  subtitle: string;
  deletedAt: string | null;
  summary: string;
  owner: string | null;
};

const TYPE_NOUN: Record<TrashType, string> = {
  company: "company",
  contact: "contact",
  lead: "lead",
};

/**
 * Shared trash/restore view used by the companies, contacts, and leads trash
 * pages. Lists soft-deleted records of one type, with per-row Restore and
 * (admin-only) Hard Delete actions. Hard delete asks for confirmation and is
 * only rendered for admins; the server independently enforces
 * `record:hard_delete`.
 */
export function TrashView({
  type,
  icon: Icon,
  isAdmin,
}: {
  type: TrashType;
  icon: LucideIcon;
  isAdmin: boolean;
}) {
  const [rows, setRows] = useState<TrashRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get<TrashRow[]>(`/api/trash?type=${type}`);
      setRows(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load trash");
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRestore(row: TrashRow) {
    setBusyId(row.id);
    setError("");
    try {
      await api.post("/api/trash", { type, id: row.id, action: "restore" });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Restore failed");
    } finally {
      setBusyId(null);
    }
  }

  async function onHardDelete(row: TrashRow) {
    if (
      !confirm(
        `Permanently delete ${row.title}? This cannot be undone and removes all related records.`
      )
    )
      return;
    setBusyId(row.id);
    setError("");
    try {
      await api.post("/api/trash", { type, id: row.id, action: "hard_delete" });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Hard delete failed");
    } finally {
      setBusyId(null);
    }
  }

  const noun = TYPE_NOUN[type];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Trash — {noun}s</h1>
        <p className="text-sm text-muted-foreground">
          Soft-deleted {noun}s. Restore them or permanently delete.
        </p>
      </div>

      {error && (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      <Card>
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            className="m-4 border-0"
            icon={Icon}
            title={`No deleted ${noun}s`}
            description={`Deleted ${noun}s will appear here and can be restored.`}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{noun === "company" ? "Company" : "Name"}</TableHead>
                <TableHead className="hidden md:table-cell">Details</TableHead>
                <TableHead className="hidden lg:table-cell">Deleted</TableHead>
                <TableHead className="hidden xl:table-cell">Owner</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.title}
                    {r.summary && (
                      <span className="block max-w-xs truncate text-xs font-normal text-muted-foreground">
                        {r.summary}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    {r.subtitle || "—"}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                    {r.deletedAt ? formatDateTime(r.deletedAt) : "—"}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">
                    {r.owner || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === r.id}
                        onClick={() => void onRestore(r)}
                      >
                        {busyId === r.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                        Restore
                      </Button>
                      {isAdmin && (
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={busyId === r.id}
                          onClick={() => void onHardDelete(r)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Hard Delete
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
