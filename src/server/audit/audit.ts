import { sql } from "drizzle-orm";
import type { Executor } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";
import { roles, type AuthContext } from "@/server/rbac/authorize";

export type AuditEvent = {
  action: string;
  entityType: string;
  entityId?: string | null;
  bdlId?: string | null;
  before?: unknown;
  after?: unknown;
};

/** Appends to the hash-chained audit log (hashing happens in the database trigger). */
export async function audit(exec: Executor, ctx: AuthContext | null, event: AuditEvent): Promise<void> {
  await exec.insert(auditLog).values({
    actorUserId: ctx?.user.id ?? null,
    actorRoles: ctx ? roles(ctx).join(",") : null,
    sessionId: ctx?.sessionId ?? null,
    requestId: ctx?.requestId ?? null,
    ip: ctx?.ip ?? null,
    userAgent: ctx?.userAgent ?? null,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    bdlId: event.bdlId ?? null,
    before: event.before ?? null,
    after: event.after ?? null,
  });
}

/** Makes the acting user visible to database triggers (config audit) for this transaction. */
export async function setActor(exec: Executor, ctx: AuthContext): Promise<void> {
  await exec.execute(sql`select set_config('silika.actor_id', ${ctx.user.id}, true)`);
}
