import { pgEnum } from "drizzle-orm/pg-core";

export const roleCode = pgEnum("role_code", [
  "TL",
  "PIC_GLIB",
  "KATIM",
  "KADIV",
  "DIREKTUR_GROUP",
  "ADK",
  "ADMIN",
  "AUDITOR",
]);

export const scopeType = pgEnum("scope_type", ["GLOBAL", "DIVISION", "BDL"]);
export const authProvider = pgEnum("auth_provider", ["local", "oidc", "ldap"]);

export const bankClass = pgEnum("bank_class", ["BU", "BPR", "BPRS"]);
export const bankType = pgEnum("bank_type", ["KONVENSIONAL", "SYARIAH"]);
export const bdlGrade = pgEnum("bdl_grade", ["A", "B", "C"]);
export const lifecycleStage = pgEnum("lifecycle_stage", [
  "PERSIAPAN",
  "PENGAMANAN_ASET",
  "PENUNJUKAN_TL",
  "OPERASIONAL",
  "NERACA_PENUTUPAN",
  "PENGAKHIRAN",
  "SELESAI",
]);

export const tlPosition = pgEnum("tl_position", ["KETUA", "ANGGOTA"]);
export const tlEndReason = pgEnum("tl_end_reason", [
  "MENINGGAL",
  "ROTASI",
  "PEMBERHENTIAN_LAIN",
  "BERAKHIR_MASA_TUGAS",
]);

export const regulationType = pgEnum("regulation_type", ["UU", "PLPS", "PADK", "PDK", "KADK"]);

export const documentStatus = pgEnum("document_status", [
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "LOCKED",
  "SUPERSEDED",
]);
export const confidentiality = pgEnum("confidentiality", ["INTERNAL", "RAHASIA", "SANGAT_RAHASIA"]);

export const approvalStepScope = pgEnum("approval_step_scope", ["SAME_DIVISION", "GLOBAL"]);
export const thresholdBasis = pgEnum("threshold_basis", ["INSURED_DEPOSITS", "DOCUMENT_AMOUNT"]);
export const approvalRequestStatus = pgEnum("approval_request_status", [
  "PENDING",
  "APPROVED",
  "RETURNED",
  "CANCELLED",
]);
export const approvalStepStatus = pgEnum("approval_step_status", [
  "WAITING",
  "PENDING",
  "APPROVED",
  "RETURNED",
  "SKIPPED",
]);

export const accountClass = pgEnum("account_class", ["ASSET", "CONTRA_ASSET", "LIABILITY"]);
export const lapanSection = pgEnum("lapan_section", ["PENAMBAHAN", "PENGURANGAN", "KOREKSI"]);

export const periodStatus = pgEnum("period_status", ["OPEN", "LOCKED", "APPROVED"]);
export const entryStatus = pgEnum("entry_status", ["DRAFT", "SUBMITTED", "VERIFIED", "REJECTED"]);
export const entryKind = pgEnum("entry_kind", ["NORMAL", "CORRECTION", "REVERSAL"]);
export const counterpartyType = pgEnum("counterparty_type", [
  "DEBITUR",
  "KREDITUR",
  "KREDITUR_SEPARATIS",
  "PEMBELI",
  "TIM_LIKUIDASI",
  "LAINNYA",
]);
export const correctionStatus = pgEnum("correction_status", ["DRAFT", "IN_REVIEW", "APPROVED", "RETURNED", "USED"]);

export const statementKind = pgEnum("statement_kind", ["LANAP", "LANIR"]);
export const statementStatus = pgEnum("statement_status", ["DRAFT", "IN_REVIEW", "LOCKED"]);
