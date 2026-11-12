import { db } from "@/server/db";

export async function writeAudit(params: {
  organizationId?: string | null;
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        organizationId: params.organizationId ?? null,
        userId: params.userId ?? null,
        action: params.action,
        entityType: params.entityType ?? "",
        entityId: params.entityId ?? "",
        ipAddress: params.ipAddress ?? "",
        metadata: JSON.stringify(params.metadata ?? {}),
      },
    });
  } catch (err) {
    // Audit failures must not break user flows; log to server console.
    console.error("Failed to write audit log", err);
  }
}
