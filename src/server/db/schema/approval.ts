import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import {
  approvalRequestStatus,
  approvalStepScope,
  approvalStepStatus,
  bankType,
  bdlGrade,
  roleCode,
  thresholdBasis,
} from "./enums";
import { money, versionedConfigColumns } from "./columns";
import { documentTypes, documents } from "./documents";
import { users } from "./identity";
import { regulationArticles } from "./regulation";

/** A reusable, versioned sequence of approval steps. */
export const approvalChainTemplates = pgTable("approval_chain_templates", {
  ...versionedConfigColumns(),
  name: text("name").notNull(),
  description: text("description"),
});

export const approvalChainSteps = pgTable(
  "approval_chain_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => approvalChainTemplates.id),
    stepOrder: integer("step_order").notNull(),
    label: text("label").notNull(),
    requiredRole: roleCode("required_role").notNull(),
    scope: approvalStepScope("scope").notNull().default("SAME_DIVISION"),
    /** Gate steps are checks (e.g. KAP audit attached) rather than a hierarchical sign-off. */
    isGate: boolean("is_gate").notNull().default(false),
    gateCode: text("gate_code"),
    slaDays: integer("sla_days").notNull().default(5),
  },
  (t) => [unique("approval_chain_steps_order_uq").on(t.templateId, t.stepOrder)],
);

/**
 * Approval matrix: document_type × BDL profile × threshold → chain template.
 * NULL criteria mean "any". The resolver picks the matching rule in force on the
 * document's reference date with the highest priority, then the highest specificity.
 */
export const approvalMatrixRules = pgTable(
  "approval_matrix_rules",
  {
    ...versionedConfigColumns(),
    documentTypeCode: text("document_type_code")
      .notNull()
      .references(() => documentTypes.code),
    bdlGrade: bdlGrade("bdl_grade"),
    bankType: bankType("bank_type"),
    hasSeparatistCreditor: boolean("has_separatist_creditor"),
    thresholdBasis: thresholdBasis("threshold_basis").notNull().default("INSURED_DEPOSITS"),
    /** Inclusive lower bound. */
    thresholdMin: money("threshold_min"),
    /** Exclusive upper bound. */
    thresholdMax: money("threshold_max"),
    /** Parameter key in system_parameters whose value is used as threshold (e.g. KAP_AUDIT_THRESHOLD). */
    thresholdParamKey: text("threshold_param_key"),
    /** 'AT_OR_BELOW' | 'ABOVE' relative to the parameter value (e.g. ≤ Rp200 M vs > Rp200 M). */
    thresholdParamSide: text("threshold_param_side"),
    requiresKapAudit: boolean("requires_kap_audit").notNull().default(false),
    chainTemplateCode: text("chain_template_code").notNull(),
    priority: integer("priority").notNull().default(0),
    regulationArticleId: uuid("regulation_article_id").references(() => regulationArticles.id),
    description: text("description"),
  },
  (t) => [
    index("amr_doc_type_idx").on(t.documentTypeCode),
    check(
      "amr_threshold_param_side",
      sql`${t.thresholdParamSide} IS NULL OR ${t.thresholdParamSide} IN ('AT_OR_BELOW','ABOVE')`,
    ),
  ],
);

/** Effective-dated system parameters (e.g. KAP_AUDIT_THRESHOLD = 200 miliar). */
export const systemParameters = pgTable("system_parameters", {
  ...versionedConfigColumns(),
  value: jsonb("value").notNull(),
  description: text("description"),
  regulationArticleId: uuid("regulation_article_id").references(() => regulationArticles.id),
});

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    documentVersionNo: integer("document_version_no").notNull(),
    /** Exact config rows used — lets auditors trace which rule applied. */
    matrixRuleId: uuid("matrix_rule_id")
      .notNull()
      .references(() => approvalMatrixRules.id),
    chainTemplateId: uuid("chain_template_id")
      .notNull()
      .references(() => approvalChainTemplates.id),
    /** Snapshot of the facts fed to the resolver (grade, bank type, amounts, as-of date, parameters). */
    resolutionContext: jsonb("resolution_context").notNull(),
    status: approvalRequestStatus("status").notNull().default("PENDING"),
    currentStepOrder: integer("current_step_order"),
    submittedBy: uuid("submitted_by")
      .notNull()
      .references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("approval_requests_doc_idx").on(t.documentId), index("approval_requests_status_idx").on(t.status)],
);

export const approvalRequestSteps = pgTable(
  "approval_request_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => approvalRequests.id),
    stepOrder: integer("step_order").notNull(),
    label: text("label").notNull(),
    requiredRole: roleCode("required_role").notNull(),
    scope: approvalStepScope("scope").notNull(),
    isGate: boolean("is_gate").notNull().default(false),
    gateCode: text("gate_code"),
    status: approvalStepStatus("status").notNull().default("WAITING"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    actedBy: uuid("acted_by").references(() => users.id),
    actedAt: timestamp("acted_at", { withTimezone: true }),
    comment: text("comment"),
  },
  (t) => [
    unique("approval_request_steps_order_uq").on(t.requestId, t.stepOrder),
    index("approval_request_steps_pending_idx").on(t.status, t.requiredRole),
  ],
);
