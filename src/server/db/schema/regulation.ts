import { date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { regulationType } from "./enums";

/** Regulatory corpus, versioned by effective date (UU LPS, PLPS, PADK, PDK, KADK). */
export const regulations = pgTable("regulations", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: regulationType("type").notNull(),
  number: text("number").notNull(),
  title: text("title").notNull(),
  issuedDate: date("issued_date"),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  supersededById: uuid("superseded_by_id"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const regulationArticles = pgTable(
  "regulation_articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    regulationId: uuid("regulation_id")
      .notNull()
      .references(() => regulations.id),
    /** e.g. "17(1)(e)" */
    articleRef: text("article_ref").notNull(),
    heading: text("heading"),
    body: text("body").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("regulation_articles_reg_idx").on(t.regulationId, t.articleRef)],
);
