import { apiHandler, ok } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { runSequenceScan } from "@/server/sequences";

/**
 * POST /api/sequences/run — trigger a sequence scan. Intended for a cron
 * job / uptime monitor / external scheduler hitting it on an interval (e.g.
 * every 15 minutes), mirroring POST /api/reminders/run. Requires the
 * sequences:run permission (admin/manager) so random clients can't drive
 * outbound email; authorized callers pass their session like any other
 * API request. The scan itself is idempotent under concurrency: each due
 * enrollment is claimed by exactly one scan via an optimistic lock.
 */
export const POST = apiHandler(async () => {
  await requireApiUserWith("sequences:run");
  const result = await runSequenceScan();
  return ok(result);
});
