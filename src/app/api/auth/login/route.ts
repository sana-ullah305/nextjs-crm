import { NextRequest, NextResponse } from "next/server";
import { loginSchema } from "@/lib/schemas";
import { login } from "@/server/auth";
import { writeAudit } from "@/server/audit";
import { rateLimit, resetRateLimiter } from "@/server/rate-limit";
import { fail, clientIp } from "@/server/api";

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const userAgent = req.headers.get("user-agent") ?? "";
  let parsed;
  try {
    parsed = loginSchema.parse(await req.json());
  } catch {
    return fail(400, "VALIDATION_ERROR", "Invalid email or password format");
  }

  const key = `${ip}:${parsed.email}`;
  const rl = rateLimit(key, 10, 5 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "Too many login attempts. Try again later.",
        },
      },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  const result = await login(parsed.email, parsed.password, ip, userAgent);
  if (!result.ok) {
    await writeAudit({
      action: "LOGIN_FAILED",
      ipAddress: ip,
      metadata: { email: parsed.email, reason: result.error },
    }).catch(() => undefined);
    return fail(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  await writeAudit({
    organizationId: result.user.organizationId,
    userId: result.user.id,
    action: "LOGIN",
    ipAddress: ip,
    metadata: { email: result.user.email },
  });
  return NextResponse.json({ data: result.user });
}

export const __testHooks = { resetRateLimiter };
