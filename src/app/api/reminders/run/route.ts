import { apiHandler, ok } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { verifySchedulerSecret } from "@/server/scheduler-auth";
import { runReminderScan } from "@/server/reminders";

/**
 * POST /api/reminders/run — trigger a reminder scan. Intended for a cron
 * job / uptime monitor / external scheduler hitting it on an interval
 * (e.g. every 15 minutes).
 *
 * Auth: either a manager session (reminders:run permission) OR the
 * scheduler service token — `Authorization: Bearer $SCHEDULER_SECRET`.
 * The scan is idempotent under concurrency (dedupe keys) and safe to run
 * repeatedly.
 */
export const POST = apiHandler(
  async (_req, _ctx, _user) => {
    const isScheduler = await verifySchedulerSecret();
    if (!isScheduler) {
      await requireApiUserWith("reminders:run");
    }
    const result = await runReminderScan();
    return ok(result);
  },
  { auth: "optional" }
);
