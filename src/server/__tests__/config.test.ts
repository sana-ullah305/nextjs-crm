import { describe, expect, it } from "vitest";
import { sessionCookieSecure } from "@/server/config";

describe("sessionCookieSecure (config)", () => {
  it("follows the app URL scheme by default", () => {
    expect(sessionCookieSecure({ APP_URL: "https://crm.example.com", SESSION_COOKIE_SECURE: null })).toBe(true);
    expect(sessionCookieSecure({ APP_URL: "http://localhost:3000", SESSION_COOKIE_SECURE: null })).toBe(false);
  });

  it("forces Secure when SESSION_COOKIE_SECURE=true", () => {
    expect(sessionCookieSecure({ APP_URL: "http://localhost:3000", SESSION_COOKIE_SECURE: "true" })).toBe(true);
  });

  it("forces non-Secure when SESSION_COOKIE_SECURE=false", () => {
    expect(sessionCookieSecure({ APP_URL: "https://crm.example.com", SESSION_COOKIE_SECURE: "false" })).toBe(false);
  });

  it("defaults to false for missing/empty APP_URL", () => {
    expect(sessionCookieSecure({ APP_URL: null, SESSION_COOKIE_SECURE: null })).toBe(false);
  });
});
