import { Decimal, sum, toDecimal, toMoneyString, type MoneyString } from "@/lib/money";
import { netEffectFactor, type AccountClass } from "../ledger/posting-engine";

export type AccountDef = {
  code: string;
  name: string;
  accountClass: AccountClass;
  ppapOfCode: string | null;
  sortOrder: number;
};

export type LapanLineDef = {
  code: string;
  name: string;
  section: "PENAMBAHAN" | "PENGURANGAN" | "KOREKSI";
  sortOrder: number;
};

export type PostingInput = {
  accountCode: string;
  lapanLineCode: string;
  amount: MoneyString;
  netAssetEffect: MoneyString;
};

export type AccountRow = {
  code: string;
  name: string;
  accountClass: AccountClass;
  opening: MoneyString;
  movement: MoneyString;
  closing: MoneyString;
};

/** Gross vs nett presentation of an asset and its PPAP allowance. */
export type GrossNetRow = { assetCode: string; name: string; gross: MoneyString; ppap: MoneyString; net: MoneyString };

export type ChangeRow = { code: string; name: string; section: LapanLineDef["section"]; amount: MoneyString };

export type LapanResult = {
  accounts: AccountRow[];
  grossNet: GrossNetRow[];
  changes: ChangeRow[];
  totals: {
    openingAssets: MoneyString;
    openingLiabilities: MoneyString;
    openingNetAssets: MoneyString;
    totalChanges: MoneyString;
    closingAssets: MoneyString;
    closingLiabilities: MoneyString;
    closingNetAssets: MoneyString;
  };
  checks: { code: string; description: string; ok: boolean; detail?: string }[];
};

export function netAssets(balances: Map<string, Decimal>, accounts: AccountDef[]): Decimal {
  return sum(accounts.map((a) => (balances.get(a.code) ?? new Decimal(0)).times(netEffectFactor(a.accountClass))));
}

/**
 * LAPAN = opening position (LANAP / previous closing) + verified postings of the period.
 * Pure function: the same inputs always give the same statement, which is what gets snapshotted.
 */
export function computeLapan(input: {
  accounts: AccountDef[];
  lapanLines: LapanLineDef[];
  opening: Map<string, MoneyString>;
  postings: PostingInput[];
}): LapanResult {
  const { accounts, lapanLines, postings } = input;
  const known = new Set(accounts.map((a) => a.code));
  const opening = new Map<string, Decimal>();
  const movement = new Map<string, Decimal>();
  for (const a of accounts) {
    opening.set(a.code, toDecimal(input.opening.get(a.code)));
    movement.set(a.code, new Decimal(0));
  }
  const unknownAccounts = new Set<string>();
  const changeByLine = new Map<string, Decimal>();
  for (const p of postings) {
    if (!known.has(p.accountCode)) unknownAccounts.add(p.accountCode);
    else movement.set(p.accountCode, movement.get(p.accountCode)!.plus(toDecimal(p.amount)));
    changeByLine.set(
      p.lapanLineCode,
      (changeByLine.get(p.lapanLineCode) ?? new Decimal(0)).plus(toDecimal(p.netAssetEffect)),
    );
  }
  const closing = new Map<string, Decimal>();
  for (const a of accounts) closing.set(a.code, opening.get(a.code)!.plus(movement.get(a.code)!));

  const byClass = (m: Map<string, Decimal>, classes: AccountClass[]) =>
    sum(accounts.filter((a) => classes.includes(a.accountClass)).map((a) => m.get(a.code)!));

  const openingAssets = byClass(opening, ["ASSET"]).minus(byClass(opening, ["CONTRA_ASSET"]));
  const closingAssets = byClass(closing, ["ASSET"]).minus(byClass(closing, ["CONTRA_ASSET"]));
  const openingLiabilities = byClass(opening, ["LIABILITY"]);
  const closingLiabilities = byClass(closing, ["LIABILITY"]);
  const openingNet = openingAssets.minus(openingLiabilities);
  const closingNet = closingAssets.minus(closingLiabilities);

  const knownLines = new Set(lapanLines.map((l) => l.code));
  const changes: ChangeRow[] = lapanLines.map((l) => ({
    code: l.code,
    name: l.name,
    section: l.section,
    amount: toMoneyString(changeByLine.get(l.code) ?? 0),
  }));
  const unknownLines = [...changeByLine.keys()].filter((c) => !knownLines.has(c));
  const totalChanges = sum(changeByLine.values());

  const grossNet: GrossNetRow[] = accounts
    .filter((a) => a.accountClass === "ASSET")
    .map((a) => {
      const ppapAccounts = accounts.filter((c) => c.accountClass === "CONTRA_ASSET" && c.ppapOfCode === a.code);
      const gross = closing.get(a.code)!;
      const ppap = sum(ppapAccounts.map((c) => closing.get(c.code)!));
      return {
        assetCode: a.code,
        name: a.name,
        gross: toMoneyString(gross),
        ppap: toMoneyString(ppap),
        net: toMoneyString(gross.minus(ppap)),
      };
    });

  const negativeBalances = accounts.filter((a) => closing.get(a.code)!.isNeg());

  return {
    accounts: accounts.map((a) => ({
      code: a.code,
      name: a.name,
      accountClass: a.accountClass,
      opening: toMoneyString(opening.get(a.code)!),
      movement: toMoneyString(movement.get(a.code)!),
      closing: toMoneyString(closing.get(a.code)!),
    })),
    grossNet,
    changes,
    totals: {
      openingAssets: toMoneyString(openingAssets),
      openingLiabilities: toMoneyString(openingLiabilities),
      openingNetAssets: toMoneyString(openingNet),
      totalChanges: toMoneyString(totalChanges),
      closingAssets: toMoneyString(closingAssets),
      closingLiabilities: toMoneyString(closingLiabilities),
      closingNetAssets: toMoneyString(closingNet),
    },
    checks: [
      {
        code: "ROLL_FORWARD",
        description: "Aset neto awal + total perubahan = aset neto akhir",
        ok: openingNet.plus(totalChanges).equals(closingNet),
        detail: `${toMoneyString(openingNet)} + ${toMoneyString(totalChanges)} vs ${toMoneyString(closingNet)}`,
      },
      {
        code: "KNOWN_ACCOUNTS",
        description: "Seluruh posting menggunakan akun yang berlaku",
        ok: unknownAccounts.size === 0,
        detail: [...unknownAccounts].join(", ") || undefined,
      },
      {
        code: "KNOWN_LAPAN_LINES",
        description: "Seluruh posting terpetakan ke pos LAPAN yang berlaku",
        ok: unknownLines.length === 0,
        detail: unknownLines.join(", ") || undefined,
      },
      {
        code: "NON_NEGATIVE_BALANCES",
        description: "Tidak ada saldo akun negatif",
        ok: negativeBalances.length === 0,
        detail: negativeBalances.map((a) => a.code).join(", ") || undefined,
      },
    ],
  };
}

/** Closing balances by account, for carrying forward into the next period or a LANIR. */
export function closingBalances(result: LapanResult): Map<string, MoneyString> {
  return new Map(result.accounts.map((a) => [a.code, a.closing]));
}
