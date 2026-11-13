import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { leadCaptureSchema } from "@/lib/schemas";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { clientIp } from "@/server/api";
import { findApiKeyByKey } from "@/server/apikeys";
import { rateLimit } from "@/server/rate-limit";
import {
  captureScore,
  findDuplicateLeadByEmail,
  pickAssignee,
  resolveCaptureCompany,
  resolveCaptureSource,
} from "@/lib/lead-pipeline";

// Public, API-key-authenticated lead capture. Deliberately NOT wrapped in
// apiHandler: that helper requires a logged-in session user. Errors follow
// the same { error: { code, message } } envelope as the rest of the API.

const CAPTURE_RATE_LIMIT = 30;
const CAPTURE_RATE_WINDOW_MS = 5 * 60 * 1000;

function fail(status: number, code: string, message: string, headers?: HeadersInit): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

function extractApiKey(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (header) {
    const [scheme, token] = header.split(" ");
    if (scheme?.toLowerCase() === "bearer" && token) return token.trim();
  }
  const query = new URL(req.url).searchParams.get("apikey");
  if (query) return query.trim();
  return null;
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const presented = extractApiKey(req);
  if (!presented) {
    return fail(401, "UNAUTHORIZED", "Missing API key");
  }
  const apiKey = await findApiKeyByKey(presented);
  if (!apiKey) {
    return fail(401, "UNAUTHORIZED", "Invalid API key");
  }
  if (!apiKey.isActive) {
    return fail(403, "FORBIDDEN", "API key is revoked or inactive");
  }

  // Rate limit per key id (NOT per IP/email like the login limiter buckets).
  const rl = rateLimit(`apikey:${apiKey.id}`, CAPTURE_RATE_LIMIT, CAPTURE_RATE_WINDOW_MS);
  if (!rl.allowed) {
    return fail(429, "RATE_LIMITED", "Too many requests", {
      "Retry-After": String(rl.retryAfterSeconds),
    });
  }

  let body: z.infer<typeof leadCaptureSchema>;
  try {
    body = leadCaptureSchema.parse(await req.json());
  } catch (err) {
    const issues = err instanceof z.ZodError ? err.issues : undefined;
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid request", details: issues } },
      { status: 400 }
    );
  }

  // Org-scoped duplicate detection before anything is written.
  const duplicate = await findDuplicateLeadByEmail(apiKey.organizationId, body.email);
  if (duplicate) {
    return fail(409, "DUPLICATE_LEAD", "A lead with this email already exists");
  }

  const sourceId = body.source
    ? await resolveCaptureSource(apiKey.organizationId, body.source)
    : null;
  const companyId = await resolveCaptureCompany(apiKey.organizationId, body.companyName);
  const score = captureScore(body);
  const assignedUserId = await pickAssignee(apiKey.organizationId, apiKey.createdById);

  const lead = await db.lead.create({
    data: {
      organizationId: apiKey.organizationId,
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone,
      companyName: body.companyName,
      companyId,
      sourceId,
      status: "NEW",
      score,
      assignedUserId,
      ownerId: apiKey.createdById,
    },
    select: { id: true, score: true, status: true },
  });

  await db.activity.create({
    data: {
      organizationId: apiKey.organizationId,
      type: "CREATED",
      title: `Lead captured: ${body.firstName} ${body.lastName}`,
      leadId: lead.id,
      userId: apiKey.createdById,
    },
  });
  await writeAudit({
    organizationId: apiKey.organizationId,
    action: "LEAD_CAPTURE",
    entityType: "lead",
    entityId: lead.id,
    ipAddress: ip,
    metadata: { keyPrefix: apiKey.prefix, source: body.source ?? "" },
  });
  await db.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  });

  // Deliberately minimal: no org internals or user data leak to public callers.
  return NextResponse.json({ data: { id: lead.id, score: lead.score, status: lead.status } }, { status: 201 });
}
