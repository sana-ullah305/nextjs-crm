import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { SidebarNav } from "@/components/sidebar-nav";
import { Topbar } from "@/components/topbar";
import { ToastProvider } from "@/components/ui/toast";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <ToastProvider>
      <ConfirmDialogProvider>
        <div className="flex min-h-screen w-full bg-background">
          <SidebarNav role={user.role} />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar user={user} />
            <main className="flex-1 overflow-x-hidden p-4 md:p-6">
              <div className="mx-auto w-full max-w-7xl">{children}</div>
            </main>
          </div>
        </div>
      </ConfirmDialogProvider>
    </ToastProvider>
  );
}
