import { getSessionUser } from "@/server/auth";
import { ROLES } from "@/server/rbac";
import { TrashView } from "@/components/trash-view";
import { Building2 } from "lucide-react";

export default async function CompaniesTrashPage() {
  const user = await getSessionUser();
  const isAdmin = user?.role === ROLES.ADMIN;
  return <TrashView type="company" icon={Building2} isAdmin={isAdmin} />;
}
