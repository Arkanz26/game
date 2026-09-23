import { describe, expect, it } from "vitest";
import {
  buildPostingLines,
  reverseLines,
  validateInputs,
  type AccountClass,
  type TransactionTypeDef,
} from "@/server/modules/ledger/posting-engine";
import { sum } from "@/lib/money";

const classes = new Map<string, AccountClass>([
  ["KAS", "ASSET"],
  ["KREDIT", "ASSET"],
  ["PPAP_KREDIT", "CONTRA_ASSET"],
  ["AYDA", "ASSET"],
  ["KEWAJIBAN_SEPARATIS", "LIABILITY"],
  ["KEWAJIBAN_LPS", "LIABILITY"],
]);

const penagihan: TransactionTypeDef = {
  code: "PENAGIHAN_PIUTANG",
  primaryAmountField: "cash_received",
  inputSchema: [
    { key: "cash_received", label: "Kas diterima", kind: "money", required: true },
    { key: "gross_reduction", label: "Pengurangan baki debet", kind: "money", required: true },
    { key: "ppap_release", label: "Pelepasan PPAP", kind: "money", required: false },
  ],
  postingRules: [
    { account: "KAS", lapanLine: "PENERIMAAN_PENAGIHAN", amountFrom: "cash_received", sign: 1 },
    { account: "KREDIT", lapanLine: "PELEPASAN_NILAI_BUKU", amountFrom: "gross_reduction", sign: -1 },
    { account: "PPAP_KREDIT", lapanLine: "PELEPASAN_NILAI_BUKU", amountFrom: "ppap_release", sign: -1 },
  ],
};

const separatis: TransactionTypeDef = {
  code: "PENYERAHAN_ASET_SEPARATIS",
  primaryAmountField: "book_value",
  inputSchema: [
    { key: "asset_account", label: "Aset", kind: "account", required: true, accountCodes: ["AYDA"] },
    { key: "book_value", label: "Nilai buku", kind: "money", required: true },
    { key: "claim_settled", label: "Tagihan diselesaikan", kind: "money", required: true },
  ],
  postingRules: [
    {
      account: { fromInput: "asset_account" },
      lapanLine: "PENYERAHAN_ASET_SEPARATIS",
      amountFrom: "book_value",
      sign: -1,
    },
    {
      account: "KEWAJIBAN_SEPARATIS",
      lapanLine: "PENYELESAIAN_KEWAJIBAN_SEPARATIS",
      amountFrom: "claim_settled",
      sign: -1,
    },
  ],
};

describe("validateInputs", () => {
  it("normalises amounts and defaults optional money to zero", () => {
    const r = validateInputs(penagihan, { cash_received: "425.000.000", gross_reduction: "500000000" });
    expect(r).toEqual({
      ok: true,
      amount: "425000000.00",
      inputs: { cash_received: "425000000.00", gross_reduction: "500000000.00", ppap_release: "0.00" },
    });
  });

  it("reports required, malformed, negative and disallowed values", () => {
    const r = validateInputs(penagihan, { cash_received: "abc", gross_reduction: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["cash_received", "gross_reduction"]);
    expect(validateInputs(penagihan, { cash_received: "-5", gross_reduction: "1" }).ok).toBe(false);
    expect(validateInputs(separatis, { asset_account: "KAS", book_value: "1", claim_settled: "1" }).ok).toBe(false);
  });

  it("rejects a zero headline amount", () => {
    expect(validateInputs(penagihan, { cash_received: "0", gross_reduction: "10" }).ok).toBe(false);
  });
});

describe("buildPostingLines", () => {
  it("collection: net-asset effect equals the realisation gain/loss", () => {
    const v = validateInputs(penagihan, {
      cash_received: "425000000",
      gross_reduction: "500000000",
      ppap_release: "120000000",
    });
    if (!v.ok) throw new Error("invalid");
    const lines = buildPostingLines(penagihan, v.inputs, classes);
    expect(lines).toEqual([
      {
        accountCode: "KAS",
        lapanLineCode: "PENERIMAAN_PENAGIHAN",
        amount: "425000000.00",
        netAssetEffect: "425000000.00",
      },
      {
        accountCode: "KREDIT",
        lapanLineCode: "PELEPASAN_NILAI_BUKU",
        amount: "-500000000.00",
        netAssetEffect: "-500000000.00",
      },
      // releasing PPAP (a contra-asset) increases net assets
      {
        accountCode: "PPAP_KREDIT",
        lapanLineCode: "PELEPASAN_NILAI_BUKU",
        amount: "-120000000.00",
        netAssetEffect: "120000000.00",
      },
    ]);
    // cash 425 − net book value (500 − 120 = 380) = +45 gain
    expect(sum(lines.map((l) => l.netAssetEffect)).toFixed(2)).toBe("45000000.00");
  });

  it("drops zero lines and resolves account from input", () => {
    const lines = buildPostingLines(
      separatis,
      { asset_account: "AYDA", book_value: "900.00", claim_settled: "950.00" },
      classes,
    );
    expect(lines.map((l) => [l.accountCode, l.netAssetEffect])).toEqual([
      ["AYDA", "-900.00"],
      ["KEWAJIBAN_SEPARATIS", "950.00"],
    ]);
    const noPpap = buildPostingLines(
      penagihan,
      { cash_received: "1.00", gross_reduction: "1.00", ppap_release: "0.00" },
      classes,
    );
    expect(noPpap).toHaveLength(2);
  });

  it("applies the prior-period LAPAN override and reverses exactly", () => {
    const lines = buildPostingLines(
      separatis,
      { asset_account: "AYDA", book_value: "900.00", claim_settled: "950.00" },
      classes,
      { lapanOverride: "KOREKSI_PERIODE_LALU" },
    );
    expect(new Set(lines.map((l) => l.lapanLineCode))).toEqual(new Set(["KOREKSI_PERIODE_LALU"]));
    const rev = reverseLines(lines);
    expect(sum([...lines, ...rev].map((l) => l.netAssetEffect)).isZero()).toBe(true);
  });

  it("fails loudly on configuration errors", () => {
    expect(() =>
      buildPostingLines(separatis, { asset_account: "UNKNOWN", book_value: "1", claim_settled: "1" }, classes),
    ).toThrow(/tidak dikenal/);
  });
});
