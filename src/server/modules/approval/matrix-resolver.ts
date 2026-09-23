import { toDecimal, type MoneyString } from "@/lib/money";

export type MatrixRule = {
  id: string;
  code: string;
  version: number;
  documentTypeCode: string;
  bdlGrade: "A" | "B" | "C" | null;
  bankType: "KONVENSIONAL" | "SYARIAH" | null;
  hasSeparatistCreditor: boolean | null;
  thresholdBasis: "INSURED_DEPOSITS" | "DOCUMENT_AMOUNT";
  thresholdMin: MoneyString | null;
  thresholdMax: MoneyString | null;
  thresholdParamKey: string | null;
  thresholdParamSide: string | null;
  requiresKapAudit: boolean;
  chainTemplateCode: string;
  priority: number;
};

export type ResolutionFacts = {
  documentTypeCode: string;
  grade: "A" | "B" | "C";
  bankType: "KONVENSIONAL" | "SYARIAH";
  hasSeparatistCreditor: boolean;
  insuredDeposits: MoneyString;
  documentAmount: MoneyString | null;
};

export type ResolvedRule = { rule: MatrixRule; specificity: number; thresholdValue: MoneyString | null };

export class MatrixResolutionError extends Error {}

function paramAmount(params: Record<string, { value: unknown }>, key: string): MoneyString {
  const p = params[key];
  if (!p) throw new MatrixResolutionError(`Parameter ${key} tidak berlaku pada tanggal acuan`);
  const v =
    typeof p.value === "object" && p.value !== null && "amount" in p.value
      ? (p.value as { amount: unknown }).amount
      : p.value;
  return toDecimal(String(v)).toFixed(2);
}

function matches(
  rule: MatrixRule,
  facts: ResolutionFacts,
  params: Record<string, { value: unknown }>,
): { ok: boolean; specificity: number; thresholdValue: MoneyString | null } {
  let specificity = 0;
  if (rule.documentTypeCode !== facts.documentTypeCode) return { ok: false, specificity, thresholdValue: null };
  if (rule.bdlGrade !== null) {
    if (rule.bdlGrade !== facts.grade) return { ok: false, specificity, thresholdValue: null };
    specificity++;
  }
  if (rule.bankType !== null) {
    if (rule.bankType !== facts.bankType) return { ok: false, specificity, thresholdValue: null };
    specificity++;
  }
  if (rule.hasSeparatistCreditor !== null) {
    if (rule.hasSeparatistCreditor !== facts.hasSeparatistCreditor)
      return { ok: false, specificity, thresholdValue: null };
    specificity++;
  }
  const hasThreshold = rule.thresholdMin !== null || rule.thresholdMax !== null || rule.thresholdParamKey !== null;
  if (!hasThreshold) return { ok: true, specificity, thresholdValue: null };

  const valueStr = rule.thresholdBasis === "INSURED_DEPOSITS" ? facts.insuredDeposits : facts.documentAmount;
  if (valueStr === null) return { ok: false, specificity, thresholdValue: null };
  const value = toDecimal(valueStr);
  if (rule.thresholdMin !== null && value.lt(toDecimal(rule.thresholdMin)))
    return { ok: false, specificity, thresholdValue: valueStr };
  if (rule.thresholdMax !== null && value.gte(toDecimal(rule.thresholdMax)))
    return { ok: false, specificity, thresholdValue: valueStr };
  if (rule.thresholdParamKey !== null) {
    const limit = toDecimal(paramAmount(params, rule.thresholdParamKey));
    const side = rule.thresholdParamSide ?? "AT_OR_BELOW";
    if (side === "AT_OR_BELOW" ? value.gt(limit) : value.lte(limit))
      return { ok: false, specificity, thresholdValue: valueStr };
  }
  return { ok: true, specificity: specificity + 1, thresholdValue: valueStr };
}

/**
 * Picks the approval-matrix rule for a document. `rules` must already be restricted to those
 * in force on the document's reference date. Highest priority wins, then the most specific
 * rule; an unresolvable tie is a configuration error and is reported rather than guessed.
 */
export function resolveMatrixRule(
  rules: MatrixRule[],
  facts: ResolutionFacts,
  params: Record<string, { value: unknown }>,
): ResolvedRule {
  const candidates = rules
    .map((rule) => ({ rule, ...matches(rule, facts, params) }))
    .filter((c) => c.ok)
    .sort((a, b) => b.rule.priority - a.rule.priority || b.specificity - a.specificity);
  if (candidates.length === 0) {
    throw new MatrixResolutionError(
      `Tidak ada aturan matriks persetujuan untuk ${facts.documentTypeCode} (grade ${facts.grade}, ${facts.bankType})`,
    );
  }
  const [best, second] = candidates;
  if (
    second &&
    second.rule.priority === best.rule.priority &&
    second.specificity === best.specificity &&
    second.rule.chainTemplateCode !== best.rule.chainTemplateCode
  ) {
    throw new MatrixResolutionError(
      `Konfigurasi matriks ambigu: aturan ${best.rule.code} dan ${second.rule.code} sama-sama berlaku`,
    );
  }
  return { rule: best.rule, specificity: best.specificity, thresholdValue: best.thresholdValue };
}
