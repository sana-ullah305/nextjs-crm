"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import type { SessionUser } from "@/server/auth";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Bell, LogOut, Mail, Moon, Settings, Sun, Menu, X, BarChart3 } from "lucide-react";
import { cn } from "@/lib/cn";
import { timeAgo } from "@/lib/format";
import { api } from "@/lib/api-client";
import { CommandPalette } from "@/components/command-palette";

type Notification = {
  id: string;
  title: string;
  body: string;
  type: string;
  link: string;
  isRead: boolean;
  createdAt: string;
};

type InboundReply = {
  id: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  status: string;
  receivedAt: string;
  contact: { id: string; firstName: string; lastName: string } | null;
  lead: { id: string; firstName: string; lastName: string } | null;
};

const MOBILE_NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/contacts", label: "Contacts" },
  { href: "/companies", label: "Companies" },
  { href: "/leads", label: "Leads" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/tasks", label: "Tasks" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" },
];

export function Topbar({ user }: { user: SessionUser }) {
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [replies, setReplies] = useState<InboundReply[]>([]);
  const [unreadReplies, setUnreadReplies] = useState(0);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    async function fetchNotifications() {
      try {
        const data = await api.get<{ notifications: Notification[]; unreadCount: number }>(
          "/api/notifications"
        );
        if (!cancelled) {
          setNotifications(data.notifications);
          setUnread(data.unreadCount);
        }
      } catch {
        // Unauthorized (expired session) — do nothing; middleware redirects.
      }
    }
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    async function fetchReplies() {
      try {
        const data = await api.get<{ emails: InboundReply[]; total: number }>(
          "/api/inbound?status=UNREAD&pageSize=10"
        );
        if (!cancelled) {
          setReplies(data.emails);
          setUnreadReplies(data.total);
        }
      } catch {
        // Unauthorized (expired session) — do nothing; middleware redirects.
      }
    }
    fetchReplies();
    const interval = setInterval(fetchReplies, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pathname]);

  async function markReplyRead(id: string) {
    try {
      await api.post("/api/inbound", { ids: [id] });
      setReplies((r) => r.filter((x) => x.id !== id));
      setUnreadReplies((n) => Math.max(0, n - 1));
    } catch {
      /* noop */
    }
  }

  async function markAllRead() {
    try {
      await api.post("/api/notifications");
      setUnread(0);
      setNotifications((n) => n.map((x) => ({ ...x, isRead: true })));
    } catch {
      /* noop */
    }
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur md:px-6">
      <button
        className="rounded-md p-1.5 hover:bg-muted md:hidden"
        aria-label={mobileOpen ? "Close menu" : "Open menu"}
        onClick={() => setMobileOpen((v) => !v)}
      >
        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      <div className="flex items-center gap-1.5 md:hidden">
        <BarChart3 className="h-5 w-5 text-primary" />
        <span className="font-bold">Acme CRM</span>
      </div>

      <div className="flex flex-1 items-center justify-center px-2 md:px-6">
        <CommandPalette />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          {mounted && theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label="Inbox replies">
              <Mail className="h-4 w-4" />
              {unreadReplies > 0 && (
                <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                  {unreadReplies > 9 ? "9+" : unreadReplies}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>Replies</span>
              <Link href="/inbox" className="text-xs font-normal text-primary hover:underline">
                View all
              </Link>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {replies.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">No unread replies</p>
            ) : (
              <div className="max-h-72 overflow-y-auto scroll-thin">
                {replies.map((r) => (
                  <DropdownMenuItem key={r.id} asChild>
                    <div className="flex w-full flex-col items-start gap-0.5 bg-accent/50 py-2 pr-2">
                      <Link
                        href={
                          r.contact
                            ? `/contacts/${r.contact.id}`
                            : r.lead
                              ? `/leads?q=${encodeURIComponent(`${r.lead.firstName} ${r.lead.lastName}`)}`
                              : "/inbox"
                        }
                        className="min-w-0 flex-1"
                      >
                        <span className="block truncate font-medium">
                          {r.fromName || r.fromEmail}
                        </span>
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {r.subject || "(no subject)"}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {timeAgo(r.receivedAt)}
                        </span>
                      </Link>
                      <button
                        onClick={() => void markReplyRead(r.id)}
                        className="self-end text-xs font-normal text-primary hover:underline"
                        aria-label={`Mark reply from ${r.fromName || r.fromEmail} as read`}
                      >
                        Mark read
                      </button>
                    </div>
                  </DropdownMenuItem>
                ))}
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
              <Bell className="h-4 w-4" />
              {unread > 0 && (
                <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>Notifications</span>
              {unread > 0 && (
                <button onClick={markAllRead} className="text-xs font-normal text-primary hover:underline">
                  Mark all read
                </button>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notifications.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">No notifications</p>
            ) : (
              <div className="max-h-72 overflow-y-auto scroll-thin">
                {notifications.slice(0, 10).map((n) => (
                  <DropdownMenuItem key={n.id} asChild>
                    <Link
                      href={n.link || "/dashboard"}
                      className={cn(
                        "flex w-full flex-col items-start gap-0.5 py-2",
                        !n.isRead && "bg-accent/50"
                      )}
                    >
                      <span className="font-medium">{n.title}</span>
                      {n.body && <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>}
                      <span className="text-[10px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                    </Link>
                  </DropdownMenuItem>
                ))}
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Account menu">
              <Avatar name={user.name} color={user.avatarColor} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="font-semibold text-foreground">{user.name}</div>
              <div className="text-xs font-normal text-muted-foreground">{user.email}</div>
              <div className="mt-1 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                {user.role.replace("_", " ")}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <Settings className="h-4 w-4" /> Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem destructive onClick={() => void logout()}>
              <LogOut className="h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Mobile nav drawer */}
      {mobileOpen && (
        <nav aria-label="Mobile navigation" className="absolute top-16 left-0 z-50 w-full border-b border-border bg-background p-3 shadow-lg md:hidden">
          <div className="grid gap-1">
            {MOBILE_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "rounded-md px-3 py-2 text-sm font-medium",
                  pathname.startsWith(item.href)
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground hover:bg-muted"
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
