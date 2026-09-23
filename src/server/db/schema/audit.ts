import { bigserial, index, inet, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Append-only, hash-chained audit trail of every change and every read of confidential data.
 * `id`, `prev_hash` and `hash` are assigned by the `audit_log_chain` trigger; UPDATE/DELETE are rejected.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid("actor_user_id"),
    actorRoles: text("actor_roles"),
    sessionId: text("session_id"),
    requestId: text("request_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    bdlId: uuid("bdl_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    prevHash: text("prev_hash"),
    hash: text("hash"),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
    index("audit_log_bdl_idx").on(t.bdlId, t.occurredAt),
    index("audit_log_actor_idx").on(t.actorUserId, t.occurredAt),
  ],
);
