import { apiHandler, ok } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { verifySchedulerSecret } from "@/server/scheduler-auth";
import { runInboundScan } from "@/server/inbound-mail";

/**
 * POST /api/inbound/run — trigger an inbound mail scan. Intended for a cron
 * job / uptime monitor / external scheduler hitting it on an interval (e.g.
 * every few minutes), mirroring POST /api/reminders/run.
 *
 * Auth: either a manager session (inbound:run permission) OR the scheduler
 * service token — `Authorization: Bearer $SCHEDULER_SECRET`. When the IMAP
 * env vars are unset the scan reports configured: false and does not throw.
 */
export const POST = apiHandler(
  async (_req, _ctx, _user) => {
    const isScheduler = await verifySchedulerSecret();
    if (!isScheduler) {
      await requireApiUserWith("inbound:run");
    }
    const result = await runInboundScan();
    return ok(result);
  },
  { auth: "optional" }
);
