import { randomBytes } from "node:crypto";
import { db } from "@/server/db";
import { hashToken, safeEqual } from "@/server/auth";

// Public lead-capture API keys: format "lc_" + 32 hex chars (128 bits of
// entropy from a 16-byte CSPRNG value). The full key is shown to the admin
// exactly once at creation; only its SHA-256 hash is stored, mirroring the
// session-token pattern in src/server/auth.ts.

export type ApiKeyRecord = {
  id: string;
  organizationId: string;
  name: string;
  prefix: string;
  createdById: string;
  isActive: boolean;
};

/** Generates a new capture key and returns it together with its stored form. */
export function generateApiKey(): { key: string; keyHash: string; prefix: string } {
  const key = `lc_${randomBytes(16).toString("hex")}`;
  return { key, keyHash: hashToken(key), prefix: key.slice(0, 8) };
}

/**
 * Resolves a presented key to its ApiKey row.
 * Lookup filters by prefix first (index-backed), then constant-time compares
 * the SHA-256 hash so the full key is never used in a query predicate.
 * Returns null for unknown keys; callers decide 401 vs 403 for inactive rows.
 */
export async function findApiKeyByKey(key: string): Promise<ApiKeyRecord | null> {
  const prefix = key.slice(0, 8);
  const hash = hashToken(key);
  const candidates = await db.apiKey.findMany({
    where: { prefix },
    select: {
      id: true,
      organizationId: true,
      name: true,
      prefix: true,
      createdById: true,
      keyHash: true,
      isActive: true,
    },
  });
  const match = candidates.find((row) => safeEqual(row.keyHash, hash));
  if (!match) return null;
  return {
    id: match.id,
    organizationId: match.organizationId,
    name: match.name,
    prefix: match.prefix,
    createdById: match.createdById,
    isActive: match.isActive,
  };
}
