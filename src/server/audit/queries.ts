import { and, desc, eq } from "drizzle-orm";
import type { Executor } from "@/server/db/client";
import { auditLog, users } from "@/server/db/schema";

/** Audit history of one entity (newest first). Callers must have authorised access to the entity. */
export function auditTrailFor(exec: Executor, entityType: string, entityId: string) {
  return exec
    .select({ log: auditLog, actorName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
    .orderBy(desc(auditLog.id));
}
