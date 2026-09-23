import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { confidentiality, documentStatus, roleCode } from "./enums";
import { bdl } from "./bdl";
import { users } from "./identity";
import { regulationArticles } from "./regulation";

export const documentTypes = pgTable("document_types", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  requiresApproval: boolean("requires_approval").notNull().default(true),
  /** Locked (immutable) once the approval chain completes, e.g. LANAP/LAPAN. */
  locksOnApproval: boolean("locks_on_approval").notNull().default(false),
  /** System-generated from ledger data rather than uploaded. */
  isGenerated: boolean("is_generated").notNull().default(false),
});

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bdlId: uuid("bdl_id")
      .notNull()
      .references(() => bdl.id),
    documentTypeCode: text("document_type_code")
      .notNull()
      .references(() => documentTypes.code),
    title: text("title").notNull(),
    /** Ledger period the document reports on (LAPAN), if any. */
    periodId: uuid("period_id"),
    status: documentStatus("status").notNull().default("DRAFT"),
    currentVersionNo: integer("current_version_no").notNull().default(0),
    effectiveDate: date("effective_date"),
    confidentiality: confidentiality("confidentiality").notNull().default("RAHASIA"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("documents_bdl_idx").on(t.bdlId, t.documentTypeCode), index("documents_period_idx").on(t.periodId)],
);

/** Immutable document versions (UPDATE/DELETE rejected by trigger). */
export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    versionNo: integer("version_no").notNull(),
    /** Snapshot for generated documents (e.g. LAPAN figures). */
    contentJson: jsonb("content_json"),
    /** Object-storage key for uploaded files (MinIO/S3). */
    storageKey: text("storage_key"),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    sha256: text("sha256").notNull(),
    changeNote: text("change_note"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("document_versions_doc_version_uq").on(t.documentId, t.versionNo),
    check("document_versions_has_content", sql`${t.contentJson} IS NOT NULL OR ${t.storageKey} IS NOT NULL`),
  ],
);

export const documentRegulationRefs = pgTable(
  "document_regulation_refs",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    articleId: uuid("article_id")
      .notNull()
      .references(() => regulationArticles.id),
    note: text("note"),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.articleId] })],
);

/** Document-level access grants on top of BDL-scoped RBAC (granted to a user or a role). */
export const documentAccessGrants = pgTable(
  "document_access_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    granteeUserId: uuid("grantee_user_id").references(() => users.id),
    granteeRole: roleCode("grantee_role"),
    permission: text("permission").notNull(),
    grantedBy: uuid("granted_by")
      .notNull()
      .references(() => users.id),
    validTo: timestamp("valid_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("dag_one_grantee", sql`(${t.granteeUserId} IS NULL) <> (${t.granteeRole} IS NULL)`)],
);
