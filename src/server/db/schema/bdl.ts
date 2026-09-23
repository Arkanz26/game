import { sql } from "drizzle-orm";
import { boolean, date, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { bankClass, bankType, bdlGrade, lifecycleStage, tlEndReason, tlPosition } from "./enums";
import { divisions, users } from "./identity";
import { regulationArticles } from "./regulation";
import { money } from "./columns";

/** Bank Dalam Likuidasi — master case file. Profile columns drive runtime configuration. */
export const bdl = pgTable(
  "bdl",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    bankClass: bankClass("bank_class").notNull(),
    bankType: bankType("bank_type").notNull(),
    grade: bdlGrade("grade").notNull(),
    hasSeparatistCreditor: boolean("has_separatist_creditor").notNull().default(false),
    insuredDepositsAmount: money("insured_deposits_amount").notNull().default("0"),
    lifecycleStage: lifecycleStage("lifecycle_stage").notNull().default("PERSIAPAN"),
    divisionId: uuid("division_id")
      .notNull()
      .references(() => divisions.id),
    licenseRevokedDate: date("license_revoked_date"),
    liquidationStartDate: date("liquidation_start_date"),
    city: text("city"),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bdl_division_idx").on(t.divisionId)],
);

export const bdlStageHistory = pgTable(
  "bdl_stage_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bdlId: uuid("bdl_id")
      .notNull()
      .references(() => bdl.id),
    stage: lifecycleStage("stage").notNull(),
    enteredAt: date("entered_at").notNull(),
    note: text("note"),
    recordedBy: uuid("recorded_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bdl_stage_history_bdl_idx").on(t.bdlId, t.enteredAt)],
);

/** Timeline of notable case events (document approvals, TL changes, period locks …). */
export const bdlEvents = pgTable(
  "bdl_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bdlId: uuid("bdl_id")
      .notNull()
      .references(() => bdl.id),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    title: text("title").notNull(),
    refEntityType: text("ref_entity_type"),
    refEntityId: text("ref_entity_id"),
    actorId: uuid("actor_id").references(() => users.id),
  },
  (t) => [index("bdl_events_bdl_idx").on(t.bdlId, t.occurredAt)],
);

export const liquidationTeamMembers = pgTable(
  "liquidation_team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bdlId: uuid("bdl_id")
      .notNull()
      .references(() => bdl.id),
    userId: uuid("user_id").references(() => users.id),
    fullName: text("full_name").notNull(),
    position: tlPosition("position").notNull(),
    appointedAt: date("appointed_at").notNull(),
    decreeRef: text("decree_ref"),
    endedAt: date("ended_at"),
    endReason: tlEndReason("end_reason"),
    replacesMemberId: uuid("replaces_member_id"),
    legalBasisArticleId: uuid("legal_basis_article_id").references(() => regulationArticles.id),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ltm_bdl_idx").on(t.bdlId),
    index("ltm_active_idx")
      .on(t.bdlId)
      .where(sql`${t.endedAt} IS NULL`),
  ],
);
