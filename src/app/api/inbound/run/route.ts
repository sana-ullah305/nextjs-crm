import { apiHandler, ok } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { runInboundScan } from "@/server/inbound-mail";

/**
 * POST /api/inbound/run — trigger an inbound mail scan. Intended for a cron
 * job / uptime monitor / external scheduler hitting it on an interval (e.g.
 * every few minutes), mirroring POST /api/reminders/run. Requires the
 * inbound:run permission (admin/manager) so random clients can't hammer
 * the IMAP connection; authorized callers pass their session like any other
 * API request. When the IMAP env vars are unset the scan reports
 * configured: false and does not throw.
 */
export const POST = apiHandler(async () => {
  await requireApiUserWith("inbound:run");
  const result = await runInboundScan();
  return ok(result);
});
