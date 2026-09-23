import { date, integer, numeric, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Rupiah amounts: NUMERIC(20,2), surfaced to TypeScript as strings (never JS floats). */
export const money = (name: string) => numeric(name, { precision: 20, scale: 2 });

/**
 * Columns shared by every effective-dated configuration table. Rows are immutable:
 * a change is a new row (version + 1) and the previous row only gets `effective_to` set
 * (enforced by the `config_row_guard` trigger). Consumers store the row id they used.
 */
export const versionedConfigColumns = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull(),
  version: integer("version").notNull().default(1),
  effectiveFrom: date("effective_from").notNull(),
  /** Exclusive upper bound; NULL = still in force. */
  effectiveTo: date("effective_to"),
  changeReason: text("change_reason"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
