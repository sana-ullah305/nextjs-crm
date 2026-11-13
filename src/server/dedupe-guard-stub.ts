import { db } from "@/server/db";
import {
  assertNotAlreadyEnrolled as assertFromDedupe,
  MergeGuardError as BaseMergeGuardError,
} from "@/server/dedupe";

// Enriched guard error keeping the sequences routes' contract of a stable
// `code` discriminator (ALREADY_ENROLLED | UNSUBSCRIBED) for 409 mapping.
// `instanceof` checks in the routes compare against this class because it
// is the one this module exports (and the routes import) as MergeGuardError.
export class MergeGuardError extends BaseMergeGuardError {
  constructor(
    public code: "ALREADY_ENROLLED" | "UNSUBSCRIBED",
    message: string,
    details?: ConstructorParameters<typeof BaseMergeGuardError>[0]
  ) {
    super(details ?? {});
    this.name = "MergeGuardError";
    this.message = message;
  }
}

/**
 * Enrollment guard: ACTIVE duplicates via the dedupe module's
 * implementation (record-id OR email-snapshot match), plus the sequences
 * UNSUBSCRIBED suppression rule (same email in this org).
 */
export async function assertNotAlreadyEnrolled(
  organizationId: string,
  email: string
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  try {
    await assertFromDedupe(organizationId, normalized);
  } catch (err) {
    if (err instanceof BaseMergeGuardError) {
      throw new MergeGuardError("ALREADY_ENROLLED", "ALREADY_ENROLLED");
    }
    throw err;
  }

  // Suppression: any UNSUBSCRIBED enrollment with this email in the org
  // blocks new enrollment (compliance: opt-out is forever).
  const unsubscribed = await db.sequenceEnrollment.findFirst({
    where: {
      organizationId,
      enrolledEmail: normalized,
      status: "UNSUBSCRIBED",
    },
    select: { id: true },
  });
  if (unsubscribed) {
    throw new MergeGuardError("UNSUBSCRIBED", "UNSUBSCRIBED");
  }
}
