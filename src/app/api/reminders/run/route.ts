import { apiHandler, ok } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { runReminderScan } from "@/server/reminders";

/**
 * POST /api/reminders/run — trigger a reminder scan. Intended for a cron
 * job / uptime monitor / external scheduler hitting it on an interval
 * (e.g. every 15 minutes). Requires the reminders:run permission
 * (admin/manager) so random clients can't hammer the scan; authorized
 * callers pass their session like any other API request.
 */
export const POST = apiHandler(async () => {
  await requireApiUserWith("reminders:run");
  const result = await runReminderScan();
  return ok(result);
});
