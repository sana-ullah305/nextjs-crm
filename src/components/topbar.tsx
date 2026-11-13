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
import { Bell, LogOut, Moon, Settings, Sun, Menu, X, BarChart3 } from "lucide-react";
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
