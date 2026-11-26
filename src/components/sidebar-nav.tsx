"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";
import {
  BarChart3,
  Building2,
  CheckSquare,
  ClipboardList,
  FileBarChart,
  KanbanSquare,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: BarChart3, roles: ["ADMIN", "MANAGER", "SALES_REP"] },
  { href: "/contacts", label: "Contacts", icon: Users, roles: ["ADMIN", "MANAGER", "SALES_REP"] },
  { href: "/companies", label: "Companies", icon: Building2, roles: ["ADMIN", "MANAGER", "SALES_REP"] },
  { href: "/leads", label: "Leads", icon: Sparkles, roles: ["ADMIN", "MANAGER", "SALES_REP"] },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare, roles: ["ADMIN", "MANAGER", "SALES_REP"] },
  { href: "/tasks", label: "Tasks", icon: CheckSquare, roles: ["ADMIN", "MANAGER", "SALES_REP"] },
  { href: "/reports", label: "Reports", icon: FileBarChart, roles: ["ADMIN", "MANAGER"] },
  { href: "/settings", label: "Settings", icon: Settings, roles: ["ADMIN", "MANAGER", "SALES_REP"] },
] as const;

export function SidebarNav({ role }: { role: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const items = NAV_ITEMS.filter((item) => (item.roles as readonly string[]).includes(role));

  // Check if settings tab is active for workspace link
  const settingsTab = searchParams.get("tab");
  const workspaceActive = pathname === "/settings" && settingsTab === "organization";

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-4">
        <div className="flex items-center gap-1.5 rounded-md bg-sidebar-primary px-2.5 py-1.5 text-sidebar-primary-foreground">
          <BarChart3 className="h-5 w-5" />
        </div>
        <span className="text-lg font-bold text-sidebar-accent-foreground">Acme CRM</span>
      </div>
      <nav aria-label="Main navigation" className="flex flex-1 flex-col gap-1 p-3 scroll-thin overflow-y-auto">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <Link
          href="/settings?tab=organization"
          aria-current={workspaceActive ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent/60",
            workspaceActive && "bg-sidebar-accent text-sidebar-accent-foreground"
          )}
        >
          <ClipboardList className="h-4 w-4" />
          Workspace
        </Link>
      </div>
    </aside>
  );
}
