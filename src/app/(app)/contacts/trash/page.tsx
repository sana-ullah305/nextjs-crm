import { getSessionUser } from "@/server/auth";
import { ROLES } from "@/server/rbac";
import { TrashView } from "@/components/trash-view";
import { Users } from "lucide-react";

export default async function ContactsTrashPage() {
  const user = await getSessionUser();
  const isAdmin = user?.role === ROLES.ADMIN;
  return <TrashView type="contact" icon={Users} isAdmin={isAdmin} />;
}
