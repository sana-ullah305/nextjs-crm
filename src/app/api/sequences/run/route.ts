import { apiHandler, ok } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { verifySchedulerSecret } from "@/server/scheduler-auth";
import { runSequenceScan } from "@/server/sequences";

/**
 * POST /api/sequences/run — trigger a sequence scan. Intended for a cron
 * job / uptime monitor / external scheduler hitting it on an interval (e.g.
 * every 15 minutes), mirroring POST /api/reminders/run.
 *
 * Auth: either a manager session (sequences:run permission) OR the
 * scheduler service token — `Authorization: Bearer $SCHEDULER_SECRET`.
 * The scan itself is idempotent under concurrency: each due enrollment is
 * claimed by exactly one scan via an optimistic lock, and send failures are
 * retried with exponential backoff before the step is dead-lettered.
 */
export const POST = apiHandler(
  async (_req, _ctx, _user) => {
    const isScheduler = await verifySchedulerSecret();
    if (!isScheduler) {
      await requireApiUserWith("sequences:run");
    }
    const result = await runSequenceScan();
    return ok(result);
  },
  { auth: "optional" }
);
