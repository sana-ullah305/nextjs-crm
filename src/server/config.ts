/**
 * Central configuration for security-sensitive runtime flags.
 *
 * Values come from environment variables so deployment environments can opt
 * in or out without code changes. Sensible defaults keep local development
 * usable (over plain HTTP the Secure flag would make browsers drop the
 * session cookie and break login).
 */

export interface SecurityConfigEnv {
  APP_URL?: string | null;
  SESSION_COOKIE_SECURE?: string | null;
}

/**
 * Whether the session cookie should set the `Secure` attribute.
 *
 * - `SESSION_COOKIE_SECURE=true` forces it on regardless of scheme.
 * - Otherwise it follows the app URL scheme (HTTPS → Secure, HTTP → off).
 */
export function sessionCookieSecure(
  env: SecurityConfigEnv = process.env as unknown as SecurityConfigEnv
): boolean {
  if (env.SESSION_COOKIE_SECURE !== undefined && env.SESSION_COOKIE_SECURE !== null) {
    return env.SESSION_COOKIE_SECURE === "true";
  }
  return /^https:/i.test(env.APP_URL ?? "");
}

export const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
