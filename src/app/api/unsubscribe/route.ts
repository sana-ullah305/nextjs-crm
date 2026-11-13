import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";

// Public one-click unsubscribe. Deliberately NOT wrapped in apiHandler (no
// session — the token IS the credential) and registered as a public prefix in
// src/proxy.ts. Errors use the same { error: { code, message } } envelope.

const UNSUBSCRIBED_PAGE =
  "<html><body><h1>You're unsubscribed</h1><p>No more emails from this sender.</p></body></html>";

function fail(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * GET /api/unsubscribe?token=<unsubToken> — marks every enrollment carrying
 * that token (one by design; tokens are per-enrollment) UNSUBSCRIBED so the
 * person is suppressed from this sequence and (via the enrollment guard)
 * from re-enrollment in the org.
 */
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token")?.trim() ?? "";
  if (!token) {
    return fail(400, "VALIDATION_ERROR", "Missing token");
  }

  const existing = await db.sequenceEnrollment.findFirst({
    where: { unsubToken: token },
    select: { id: true },
  });
  if (!existing) {
    return fail(404, "NOT_FOUND", "Unknown unsubscribe token");
  }

  await db.sequenceEnrollment.updateMany({
    where: { unsubToken: token },
    data: { status: "UNSUBSCRIBED", stoppedReason: "unsubscribed", nextSendAt: null },
  });

  return new NextResponse(UNSUBSCRIBED_PAGE, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}
