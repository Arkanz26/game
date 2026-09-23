import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  accountClass,
  correctionStatus,
  counterpartyType,
  entryKind,
  entryStatus,
  lapanSection,
  periodStatus,
  statementKind,
  statementStatus,
} from "./enums";
import { money, versionedConfigColumns } from "./columns";
import { bdl } from "./bdl";
import { documents } from "./documents";
import { users } from "./identity";

// ---------------------------------------------------------------------------
// Configuration (effective-dated, immutable rows)
// ---------------------------------------------------------------------------

/** Chart of net-asset accounts used by LANAP / LAPAN / LANIR. */
export const accounts = pgTable("accounts", {
  ...versionedConfigColumns(),
  name: text("name").notNull(),
  /** Per-profile label overrides, e.g. {"SYARIAH": "Pembiayaan"}. */
  labelOverrides: jsonb("label_overrides").$type<Record<string, string>>().notNull().default({}),
  accountClass: accountClass("account_class").notNull(),
  /** For CONTRA_ASSET (PPAP) accounts: the gross asset account they offset. */
  ppapOfCode: text("ppap_of_code"),
  sortOrder: integer("sort_order").notNull().default(0),
});

/** Line items of the "perubahan aset neto" section of the LAPAN. */
export const lapanLineItems = pgTable("lapan_line_items", {
  ...versionedConfigColumns(),
  name: text("name").notNull(),
  section: lapanSection("section").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export type TransactionInputField = {
  key: string;
  label: string;
  kind: "money" | "account" | "text";
  required: boolean;
  /** For kind = "account": selectable account codes. */
  accountCodes?: string[];
  help?: string;
};

export type PostingRule = {
  /** Literal account code, or the key of an "account" input field. */
  account: string | { fromInput: string };
  lapanLine: string;
  /** Key of a "money" input field. */
  amountFrom: string;
  /** +1 increases the account's natural balance, -1 decreases it. */
  sign: 1 | -1;
};

/** Controlled transaction types. Input form + posting to accounts/LAPAN lines are data, not code. */
export const transactionTypes = pgTable("transaction_types", {
  ...versionedConfigColumns(),
  name: text("name").notNull(),
  description: text("description"),
  inputSchema: jsonb("input_schema").$type<TransactionInputField[]>().notNull(),
  postingRules: jsonb("posting_rules").$type<PostingRule[]>().notNull(),
  /** Input field whose value is shown as the entry's headline amount. */
  primaryAmountField: text("primary_amount_field").notNull(),
  requiresSeparatistCreditor: boolean("requires_separatist_creditor").notNull().default(false),
  requiresCounterparty: boolean("requires_counterparty").notNull().default(false),
  defaultCounterpartyType: counterpartyType("default_counterparty_type"),
  sortOrder: integer("sort_order").notNull().default(0),
});

// ---------------------------------------------------------------------------
// Periods, statements, entries
// ---------------------------------------------------------------------------

export const ledgerPeriods = pgTable(
  "ledger_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bdlId: uuid("bdl_id")
      .notNull()
      .references(() => bdl.id),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: periodStatus("status").notNull().default("OPEN"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: uuid("locked_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    lapanDocumentId: uuid("lapan_document_id").references(() => documents.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ledger_periods_bdl_start_uq").on(t.bdlId, t.periodStart),
    check("ledger_periods_range", sql`${t.periodEnd} >= ${t.periodStart}`),
  ],
);

/** LANAP (baseline) and LANIR (closing) net-asset statements. A LANIR, once locked, seeds the next LANAP. */
export const netAssetStatements = pgTable(
  "net_asset_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bdlId: uuid("bdl_id")
      .notNull()
      .references(() => bdl.id),
    kind: statementKind("kind").notNull(),
    asOfDate: date("as_of_date").notNull(),
    status: statementStatus("status").notNull().default("DRAFT"),
    documentId: uuid("document_id").references(() => documents.id),
    derivedFromStatementId: uuid("derived_from_statement_id"),
    sourcePeriodId: uuid("source_period_id").references(() => ledgerPeriods.id),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("nas_bdl_idx").on(t.bdlId, t.kind, t.asOfDate)],
);

export const netAssetStatementLines = pgTable(
  "net_asset_statement_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    statementId: uuid("statement_id")
      .notNull()
      .references(() => netAssetStatements.id),
    accountCode: text("account_code").notNull(),
    /** Natural balance (assets, PPAP allowance and liabilities are all positive). */
    amount: money("amount").notNull(),
  },
  (t) => [unique("nasl_statement_account_uq").on(t.statementId, t.accountCode)],
);

export const periodCorrectionRequests = pgTable(
  "period_correction_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bdlId: uuid("bdl_id")
      .notNull()
      .references(() => bdl.id),
    targetPeriodId: uuid("target_period_id")
      .notNull()
      .references(() => ledgerPeriods.id),
    reason: text("reason").notNull(),
    status: correctionStatus("status").notNull().default("DRAFT"),
    documentId: uuid("document_id").references(() => documents.id),
    /** Correction entries may be posted until this moment once APPROVED. */
    windowUntil: timestamp("window_until", { withTimezone: true }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pcr_bdl_idx").on(t.bdlId)],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bdlId: uuid("bdl_id")
      .notNull()
      .references(() => bdl.id),
    /** Period the entry is reported in (always an OPEN period at posting time). */
    periodId: uuid("period_id")
      .notNull()
      .references(() => ledgerPeriods.id),
    entryNo: integer("entry_no").notNull(),
    transactionTypeId: uuid("transaction_type_id")
      .notNull()
      .references(() => transactionTypes.id),
    transactionTypeCode: text("transaction_type_code").notNull(),
    /** Actual economic date of the transaction (not the input date). */
    transactionDate: date("transaction_date").notNull(),
    description: text("description").notNull(),
    amount: money("amount").notNull(),
    inputs: jsonb("inputs").$type<Record<string, string>>().notNull(),
    counterpartyType: counterpartyType("counterparty_type"),
    counterpartyName: text("counterparty_name"),
    assetRef: text("asset_ref"),
    evidenceRef: text("evidence_ref"),
    evidenceDocumentId: uuid("evidence_document_id").references(() => documents.id),
    status: entryStatus("status").notNull().default("DRAFT"),
    entryKind: entryKind("entry_kind").notNull().default("NORMAL"),
    correctsEntryId: uuid("corrects_entry_id"),
    correctionRequestId: uuid("correction_request_id").references(() => periodCorrectionRequests.id),
    /** For corrections of locked periods: the period the transaction economically belongs to. */
    originPeriodId: uuid("origin_period_id").references(() => ledgerPeriods.id),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    verifiedBy: uuid("verified_by").references(() => users.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
  },
  (t) => [
    unique("ledger_entries_bdl_no_uq").on(t.bdlId, t.entryNo),
    index("ledger_entries_period_idx").on(t.periodId, t.status),
    index("ledger_entries_bdl_date_idx").on(t.bdlId, t.transactionDate),
    check("ledger_entries_maker_checker", sql`${t.verifiedBy} IS NULL OR ${t.verifiedBy} <> ${t.createdBy}`),
    check("ledger_entries_rejection_reason", sql`${t.status} <> 'REJECTED' OR ${t.rejectionReason} IS NOT NULL`),
    check("ledger_entries_reversal_ref", sql`${t.entryKind} <> 'REVERSAL' OR ${t.correctsEntryId} IS NOT NULL`),
  ],
);

/** Account-level postings generated from a VERIFIED entry by the posting engine (immutable). */
export const ledgerPostingLines = pgTable(
  "ledger_posting_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => ledgerEntries.id),
    periodId: uuid("period_id")
      .notNull()
      .references(() => ledgerPeriods.id),
    accountCode: text("account_code").notNull(),
    lapanLineCode: text("lapan_line_code").notNull(),
    /** Change of the account's natural balance. */
    amount: money("amount").notNull(),
    /** Effect on net assets (amount × +1 for assets, −1 for PPAP and liabilities). */
    netAssetEffect: money("net_asset_effect").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lpl_period_idx").on(t.periodId), index("lpl_entry_idx").on(t.entryId)],
);
