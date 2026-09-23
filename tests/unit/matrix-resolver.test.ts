import { describe, expect, it } from "vitest";
import {
  MatrixResolutionError,
  resolveMatrixRule,
  type MatrixRule,
  type ResolutionFacts,
} from "@/server/modules/approval/matrix-resolver";

const base: Omit<MatrixRule, "id" | "code" | "chainTemplateCode"> = {
  version: 1,
  documentTypeCode: "LAPAN",
  bdlGrade: null,
  bankType: null,
  hasSeparatistCreditor: null,
  thresholdBasis: "INSURED_DEPOSITS",
  thresholdMin: null,
  thresholdMax: null,
  thresholdParamKey: null,
  thresholdParamSide: null,
  requiresKapAudit: false,
  priority: 0,
};
const rule = (code: string, chain: string, over: Partial<MatrixRule> = {}): MatrixRule => ({
  ...base,
  id: code,
  code,
  chainTemplateCode: chain,
  ...over,
});
const facts = (over: Partial<ResolutionFacts> = {}): ResolutionFacts => ({
  documentTypeCode: "LAPAN",
  grade: "B",
  bankType: "KONVENSIONAL",
  hasSeparatistCreditor: false,
  insuredDeposits: "85000000000.00",
  documentAmount: null,
  ...over,
});
const params = { KAP_AUDIT_THRESHOLD: { value: { amount: "200000000000.00" } } };

describe("resolveMatrixRule", () => {
  const rules = [rule("LAPAN_DEFAULT", "CHAIN_STANDAR"), rule("LAPAN_GRADE_C", "CHAIN_DIREKTUR", { bdlGrade: "C" })];

  it("falls back to the generic rule", () => {
    expect(resolveMatrixRule(rules, facts(), params).rule.code).toBe("LAPAN_DEFAULT");
  });

  it("prefers the more specific rule (grade C)", () => {
    const r = resolveMatrixRule(rules, facts({ grade: "C" }), params);
    expect(r.rule.chainTemplateCode).toBe("CHAIN_DIREKTUR");
    expect(r.specificity).toBe(1);
  });

  it("applies the Rp200 M KAP threshold from a parameter (≤ vs >)", () => {
    const kap = [
      rule("LANAP_BAWAH", "CHAIN_STANDAR", {
        documentTypeCode: "LANAP",
        thresholdParamKey: "KAP_AUDIT_THRESHOLD",
        thresholdParamSide: "AT_OR_BELOW",
      }),
      rule("LANAP_ATAS", "CHAIN_KAP", {
        documentTypeCode: "LANAP",
        thresholdParamKey: "KAP_AUDIT_THRESHOLD",
        thresholdParamSide: "ABOVE",
        requiresKapAudit: true,
      }),
    ];
    const f = (amount: string) => facts({ documentTypeCode: "LANAP", insuredDeposits: amount });
    expect(resolveMatrixRule(kap, f("200000000000.00"), params).rule.code).toBe("LANAP_BAWAH");
    expect(resolveMatrixRule(kap, f("200000000000.01"), params).rule.code).toBe("LANAP_ATAS");
    // a later regulation raising the threshold changes the outcome without code changes
    expect(
      resolveMatrixRule(kap, f("250000000000.00"), { KAP_AUDIT_THRESHOLD: { value: { amount: "300000000000" } } }).rule
        .code,
    ).toBe("LANAP_BAWAH");
  });

  it("supports literal ranges on the document amount", () => {
    const r = [
      rule("KECIL", "A", { thresholdBasis: "DOCUMENT_AMOUNT", thresholdMax: "1000.00" }),
      rule("BESAR", "B", { thresholdBasis: "DOCUMENT_AMOUNT", thresholdMin: "1000.00" }),
    ];
    expect(resolveMatrixRule(r, facts({ documentAmount: "999.99" }), params).rule.code).toBe("KECIL");
    expect(resolveMatrixRule(r, facts({ documentAmount: "1000.00" }), params).rule.code).toBe("BESAR");
  });

  it("honours priority over specificity", () => {
    const r = [...rules, rule("OVERRIDE", "CHAIN_KHUSUS", { priority: 10 })];
    expect(resolveMatrixRule(r, facts({ grade: "C" }), params).rule.code).toBe("OVERRIDE");
  });

  it("reports missing and ambiguous configuration instead of guessing", () => {
    expect(() => resolveMatrixRule(rules, facts({ documentTypeCode: "EVAP" }), params)).toThrow(MatrixResolutionError);
    const ambiguous = [rule("X", "CHAIN_1", { bdlGrade: "B" }), rule("Y", "CHAIN_2", { bankType: "KONVENSIONAL" })];
    expect(() => resolveMatrixRule(ambiguous, facts(), params)).toThrow(/ambigu/);
  });
});
