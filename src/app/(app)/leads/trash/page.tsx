import { getSessionUser } from "@/server/auth";
import { ROLES } from "@/server/rbac";
import { TrashView } from "@/components/trash-view";
import { Sparkles } from "lucide-react";

export default async function LeadsTrashPage() {
  const user = await getSessionUser();
  const isAdmin = user?.role === ROLES.ADMIN;
  return <TrashView type="lead" icon={Sparkles} isAdmin={isAdmin} />;
}
