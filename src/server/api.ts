import { NextRequest, NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { ApiAuthError, ApiForbiddenError } from "@/server/rbac";
import type { SessionUser } from "@/server/auth";

export type ApiSuccess<T> = { data: T };
export type ApiFailure = {
  error: { code: string; message: string; details?: unknown };
};

export function ok<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ data }, init);
}

export function fail(
  status: number,
  code: string,
  message: string,
  details?: unknown
): NextResponse<ApiFailure> {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export class ApiValidationError extends Error {
  constructor(public details: unknown) {
    super("Validation failed");
  }
}

export class ApiNotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
  }
}

export function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  return req
    .json()
    .catch(() => {
      throw new ApiValidationError({ body: ["Expected JSON body"] });
    })
    .then((raw) => {
      const result = schema.safeParse(raw);
      if (!result.success) {
        throw new ApiValidationError(result.error.issues);
      }
      return result.data;
    });
}

export function parseQuery<T>(req: NextRequest, schema: ZodType<T>): T {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const result = schema.safeParse(params);
  if (!result.success) {
    throw new ApiValidationError(result.error.issues);
  }
  return result.data;
}

type Handler<C> = (req: NextRequest, ctx: C, user: SessionUser) => Promise<NextResponse>;

/**
 * Wraps a route handler with:
 *  - authentication (401 envelope),
 *  - consistent error mapping (Zod → 400, NotFound → 404, Forbidden → 403),
 *  - never leaks stack traces to clients.
 */
export function apiHandler<C>(
  handler: Handler<C>
): (req: NextRequest, ctx: C) => Promise<NextResponse> {
  return async (req: NextRequest, ctx: C) => {
    try {
      const { requireApiUser } = await import("@/server/rbac");
      const user = await requireApiUser();
      return await handler(req, ctx, user);
    } catch (err) {
      if (err instanceof ApiValidationError) {
        return fail(400, "VALIDATION_ERROR", "Invalid request", err.details);
      }
      if (err instanceof ApiAuthError) {
        return fail(401, "UNAUTHORIZED", "Authentication required");
      }
      if (err instanceof ApiForbiddenError) {
        return fail(403, "FORBIDDEN", err.message);
      }
      if (err instanceof ApiNotFoundError) {
        return fail(404, "NOT_FOUND", err.message);
      }
      if (err instanceof ZodError) {
        return fail(400, "VALIDATION_ERROR", "Invalid request", err.issues);
      }
      if ((err as { code?: string })?.code === "P2002") {
        return fail(409, "CONFLICT", "A record with this value already exists");
      }
      console.error("API error:", err);
      return fail(500, "INTERNAL", "An unexpected error occurred");
    }
  };
}
