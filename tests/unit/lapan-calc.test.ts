import { describe, expect, it } from "vitest";
import { computeLapan, type AccountDef, type LapanLineDef } from "@/server/modules/reporting/lapan-calc";

const accounts: AccountDef[] = [
  { code: "KAS", name: "Kas", accountClass: "ASSET", ppapOfCode: null, sortOrder: 1 },
  { code: "KREDIT", name: "Kredit", accountClass: "ASSET", ppapOfCode: null, sortOrder: 2 },
  { code: "PPAP_KREDIT", name: "PPAP Kredit", accountClass: "CONTRA_ASSET", ppapOfCode: "KREDIT", sortOrder: 3 },
  { code: "KEWAJIBAN_LPS", name: "Kewajiban LPS", accountClass: "LIABILITY", ppapOfCode: null, sortOrder: 4 },
];
const lapanLines: LapanLineDef[] = [
  { code: "PENERIMAAN_PENAGIHAN", name: "Penerimaan penagihan", section: "PENAMBAHAN", sortOrder: 1 },
  { code: "PELEPASAN_NILAI_BUKU", name: "Pelepasan nilai buku", section: "PENGURANGAN", sortOrder: 2 },
  { code: "BIAYA_LIKUIDASI", name: "Biaya", section: "PENGURANGAN", sortOrder: 3 },
  { code: "KOREKSI_PERIODE_LALU", name: "Koreksi", section: "KOREKSI", sortOrder: 4 },
];
const opening = new Map([
  ["KAS", "1000.00"],
  ["KREDIT", "5000.00"],
  ["PPAP_KREDIT", "2000.00"],
  ["KEWAJIBAN_LPS", "6000.00"],
]);

describe("computeLapan", () => {
  it("rolls opening + verified postings forward to closing", () => {
    const r = computeLapan({
      accounts,
      lapanLines,
      opening,
      postings: [
        { accountCode: "KAS", lapanLineCode: "PENERIMAAN_PENAGIHAN", amount: "425.00", netAssetEffect: "425.00" },
        { accountCode: "KREDIT", lapanLineCode: "PELEPASAN_NILAI_BUKU", amount: "-500.00", netAssetEffect: "-500.00" },
        {
          accountCode: "PPAP_KREDIT",
          lapanLineCode: "PELEPASAN_NILAI_BUKU",
          amount: "-120.00",
          netAssetEffect: "120.00",
        },
        { accountCode: "KAS", lapanLineCode: "BIAYA_LIKUIDASI", amount: "-30.00", netAssetEffect: "-30.00" },
      ],
    });
    // opening net = 1000 + 5000 − 2000 − 6000 = −2000
    expect(r.totals.openingNetAssets).toBe("-2000.00");
    expect(r.totals.totalChanges).toBe("15.00");
    expect(r.totals.closingNetAssets).toBe("-1985.00");
    expect(r.checks.every((c) => c.ok)).toBe(true);
    expect(r.accounts.find((a) => a.code === "KAS")).toMatchObject({
      opening: "1000.00",
      movement: "395.00",
      closing: "1395.00",
    });
    expect(r.changes.find((c) => c.code === "PELEPASAN_NILAI_BUKU")?.amount).toBe("-380.00");
    expect(r.grossNet.find((g) => g.assetCode === "KREDIT")).toEqual({
      assetCode: "KREDIT",
      name: "Kredit",
      gross: "4500.00",
      ppap: "1880.00",
      net: "2620.00",
    });
  });

  it("flags postings to unknown accounts / LAPAN lines and negative balances", () => {
    const r = computeLapan({
      accounts,
      lapanLines,
      opening,
      postings: [
        { accountCode: "GHOST", lapanLineCode: "BIAYA_LIKUIDASI", amount: "-1.00", netAssetEffect: "-1.00" },
        { accountCode: "KAS", lapanLineCode: "NOT_A_LINE", amount: "-2000.00", netAssetEffect: "-2000.00" },
      ],
    });
    const failed = r.checks.filter((c) => !c.ok).map((c) => c.code);
    expect(failed).toEqual(
      expect.arrayContaining(["KNOWN_ACCOUNTS", "KNOWN_LAPAN_LINES", "NON_NEGATIVE_BALANCES", "ROLL_FORWARD"]),
    );
  });

  it("is a pure function (same input → same output)", () => {
    const input = { accounts, lapanLines, opening, postings: [] };
    expect(JSON.stringify(computeLapan(input))).toBe(JSON.stringify(computeLapan(input)));
  });
});
