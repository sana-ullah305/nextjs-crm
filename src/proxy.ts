import { NextRequest, NextResponse } from "next/server";

// Middleware performs a cheap cookie-presence redirect only. Real
// authentication (DB-backed session validation) is enforced in:
//  - every API route handler (apiHandler → requireApiUser), and
//  - the (app) server layout.
// This keeps the Edge bundle free of native modules (pg / @prisma/adapter-pg).

const SESSION_COOKIE = "crm_session";

const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  // Public lead-capture endpoint: authenticated by an API key instead of a
  // session cookie, so it must skip the cookie-presence check.
  "/api/leads/capture",
  // Public one-click unsubscribe: the landing page and its token-
  // authenticated API endpoint. The per-enrollment token in the query
  // string IS the credential, so both must skip the cookie check.
  "/unsubscribe",
  "/api/unsubscribe",
];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic = PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p)
  );

  if (isPublic) return NextResponse.next();

  const hasCookie = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  if (hasCookie) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 }
    );
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico|.*\\.(?:ico|png|svg|jpg|jpeg|gif|webp|js|css|woff2?)).*)"],
};
