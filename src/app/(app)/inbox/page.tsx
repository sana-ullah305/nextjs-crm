"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Inbox, MailOpen, MailCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { api, ApiError } from "@/lib/api-client";
import { formatDateTime, timeAgo } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/toast";

type InboundRow = {
  id: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  body: string;
  status: string;
  receivedAt: string;
  contact: { id: string; firstName: string; lastName: string } | null;
  lead: { id: string; firstName: string; lastName: string } | null;
};

type Filter = "UNREAD" | "READ" | "ALL";

const FILTERS: { label: string; value: Filter }[] = [
  { label: "Unread", value: "UNREAD" },
  { label: "Read", value: "READ" },
  { label: "All", value: "ALL" },
];

export default function InboxPage() {
  const { error: toastError } = useToast();
  const [rows, setRows] = useState<InboundRow[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<Filter>("UNREAD");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = filter === "ALL" ? "" : "status=" + filter + "&";
      const data = await api.get<{ emails: InboundRow[]; total: number }>(
        "/api/inbound?" + query + "pageSize=50"
      );
      setRows(data.emails);
      setTotal(data.total);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Failed to load replies";
      setError(message);
      toastError({ description: message });
    } finally {
      setLoading(false);
    }
  }, [filter, toastError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(id: string) {
    try {
      await api.post("/api/inbound", { ids: [id] });
      await load();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Failed to mark as read";
      setError(message);
      toastError({ description: message });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Inbox</h1>
          <p className="text-sm text-muted-foreground">
            Email replies from your contacts and leads
          </p>
        </div>
        <div className="flex gap-1.5" role="tablist" aria-label="Reply filters">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              role="tab"
              aria-selected={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium",
                filter === f.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/70"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <Card>
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            className="m-4 border-0"
            icon={Inbox}
            title={filter === "UNREAD" ? "No unread replies" : "No replies here"}
            description="Replies to your follow-up emails are matched to their contact or lead automatically."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const linked = r.contact
                ? { href: "/contacts/" + r.contact.id, label: r.contact.firstName + " " + r.contact.lastName }
                : r.lead
                  ? {
                      href: "/leads?q=" + encodeURIComponent(r.lead.firstName + " " + r.lead.lastName),
                      label: r.lead.firstName + " " + r.lead.lastName,
                    }
                  : null;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 p-3">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={cn("truncate text-sm", r.status === "UNREAD" ? "font-semibold" : "font-medium")}>
                        {r.fromName || r.fromEmail}
                      </span>
                      {r.status === "UNREAD" && <Badge>Unread</Badge>}
                      {r.status !== "UNREAD" && <Badge variant="secondary">{r.status}</Badge>}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {r.subject || "(no subject)"}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground" title={formatDateTime(r.receivedAt)}>
                    {timeAgo(r.receivedAt)}
                  </span>
                  {r.status === "UNREAD" ? (
                    <Button variant="outline" size="sm" onClick={() => void markRead(r.id)}>
                      <MailOpen className="h-3.5 w-3.5" /> Mark read
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" disabled>
                      <MailCheck className="h-3.5 w-3.5" /> Read
                    </Button>
                  )}
                  {linked ? (
                    <Link href={linked.href}>
                      <Button variant="ghost" size="sm">
                        {r.contact ? "View contact" : "View lead"}
                      </Button>
                    </Link>
                  ) : (
                    <Button variant="ghost" size="sm" disabled>
                      Unmatched
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {total > rows.length && (
        <p className="text-xs text-muted-foreground">Showing {rows.length} of {total} replies.</p>
      )}
    </div>
  );
}
