import { headers } from "next/headers";
import { safeEqual } from "@/server/auth";

/**
 * Service-token authentication for unattended scheduler/cron calls to the
 * api star star run routes (reminders, sequences, inbound).
 *
 * Callers send `Authorization: Bearer <SCHEDULER_SECRET>` and the token is
 * compared with SCHEDULER_SECRET using a constant-time comparison, so the
 * header can't be enumerated through timing side channels.
 *
 * When SCHEDULER_SECRET is not configured, scheduler authentication is
 * unavailable and this always returns false — a missing secret never
 * silently opens these routes to anonymous callers.
 */
export async function verifySchedulerSecret(): Promise<boolean> {
 const secret = process.env.SCHEDULER_SECRET?.trim();
 if (!secret) return false;

 const authorization = (await headers()).get("authorization");
 if (!authorization) return false;

 const [scheme, token] = authorization.trim().split(/\s+/);
 if (!scheme || !token || scheme.toLowerCase() !== "bearer") return false;
 return safeEqual(token, secret);
}
