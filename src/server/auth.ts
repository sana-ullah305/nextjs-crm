import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { db } from "@/server/db";
import { sessionCookieSecure } from "@/server/config";

export const SESSION_COOKIE = "crm_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const BCRYPT_ROUNDS = process.env.NODE_ENV === "test" ? 4 : 12;

export type SessionUser = {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  role: string;
  avatarColor: string;
  title: string;
};

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function createSession(
  userId: string,
  ip: string = "",
  userAgent: string = ""
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt, ip, userAgent },
  });
  const store = await cookies();
  // The Secure flag is decided centrally in src/server/config.ts (env var
  // SESSION_COOKIE_SECURE, else the APP_URL scheme) rather than inferred
  // per-request from X-Forwarded-Proto.
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: sessionCookieSecure(),
    expires: expiresAt,
    path: "/",
  });
  return token;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      expiresAt: true,
      user: {
        select: {
          id: true,
          organizationId: true,
          email: true,
          name: true,
          role: true,
          avatarColor: true,
          title: true,
          isActive: true,
        },
      },
    },
  });
  if (!session || session.expiresAt < new Date() || !session.user.isActive) {
    return null;
  }
  const { isActive: _isActive, ...user } = session.user;
  return user;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  store.delete(SESSION_COOKIE);
}

export async function login(
  email: string,
  password: string,
  ip: string = "",
  userAgent: string = ""
): Promise<
  { ok: true; user: SessionUser } | { ok: false; error: "INVALID_CREDENTIALS" | "INACTIVE" }
> {
  const user = await db.user.findFirst({
    where: { email: email.toLowerCase() },
    select: {
      id: true,
      organizationId: true,
      email: true,
      name: true,
      role: true,
      avatarColor: true,
      title: true,
      isActive: true,
      passwordHash: true,
    },
  });
  if (!user) {
    // Constant-ish time: still run a bcrypt compare to blunt timing enumeration.
    await bcrypt.compare(password, "$2a$12$C6UzMDM.H6dfI/f/IKcEeO7ZBpUvHzGR8Ex8ZmvX7wZmUy9hSACUu");
    return { ok: false, error: "INVALID_CREDENTIALS" };
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return { ok: false, error: "INVALID_CREDENTIALS" };
  if (!user.isActive) return { ok: false, error: "INACTIVE" };
  await createSession(user.id, ip, userAgent);
  await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  const { passwordHash: _ph, isActive: _ia, ...sessionUser } = user;
  return { ok: true, user: sessionUser };
}
