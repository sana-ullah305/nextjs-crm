import { NextRequest, NextResponse } from "next/server";

// Middleware performs a cheap cookie-presence redirect only. Real
// authentication (DB-backed session validation) is enforced in:
//  - every API route handler (apiHandler → requireApiUser), and
//  - the (app) server layout.
// This keeps the Edge bundle free of native modules (better-sqlite3).

const SESSION_COOKIE = "crm_session";

const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
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
