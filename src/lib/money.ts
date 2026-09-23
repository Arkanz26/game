import Decimal from "decimal.js";

/**
 * Rupiah arithmetic. Amounts travel as strings (NUMERIC(20,2) in PostgreSQL) and are only
 * ever combined through Decimal — never through JS numbers.
 */
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type MoneyString = string;

export const ZERO = new Decimal(0);

export function toDecimal(value: Decimal.Value | null | undefined): Decimal {
  if (value === null || value === undefined || value === "") return ZERO;
  return new Decimal(value);
}

/** Normalises to a 2-decimal string suitable for NUMERIC(20,2). */
export function toMoneyString(value: Decimal.Value): MoneyString {
  return new Decimal(value).toDecimalPlaces(2).toFixed(2);
}

export function sum(values: Iterable<Decimal.Value>): Decimal {
  let total = ZERO;
  for (const v of values) total = total.plus(toDecimal(v));
  return total;
}

const MONEY_PATTERN = /^-?\d{1,18}(\.\d{1,2})?$/;

/**
 * Parses user input such as "1.250.000,50" (id-ID) or "1250000.50" into a money string.
 * Returns null when the input is not a valid amount.
 */
export function parseMoneyInput(raw: string): MoneyString | null {
  let s = raw.trim().replace(/\s|Rp/gi, "");
  if (s === "") return null;
  if (s.includes(",")) {
    // id-ID: '.' thousands separator, ',' decimal separator.
    s = s.replace(/\./g, "").replace(",", ".");
  } else if ((s.match(/\./g) ?? []).length > 1 || /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!MONEY_PATTERN.test(s)) return null;
  return toMoneyString(s);
}

const idr = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "Rp1.250.000,50"; negative amounts in parentheses, as in financial statements. */
export function formatRupiah(value: Decimal.Value | null | undefined, opts: { parens?: boolean } = {}): string {
  const d = toDecimal(value);
  // Intl formats from a number; format integer and fraction parts separately to stay exact.
  const abs = d.abs().toFixed(2);
  const [intPart, frac] = abs.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const body = `Rp${grouped},${frac}`;
  if (d.isNeg() && !d.isZero()) return opts.parens === false ? `-${body}` : `(${body})`;
  return body;
}

/** Compact form for dashboards: "Rp1,25 M" (miliar) / "Rp350,0 Jt" (juta). */
export function formatRupiahCompact(value: Decimal.Value | null | undefined): string {
  const d = toDecimal(value);
  const abs = d.abs();
  const sign = d.isNeg() ? "-" : "";
  const units: [Decimal, string][] = [
    [new Decimal("1e12"), "T"],
    [new Decimal("1e9"), "M"],
    [new Decimal("1e6"), "Jt"],
  ];
  for (const [unit, label] of units) {
    if (abs.gte(unit))
      return `${sign}Rp${idr.format(abs.div(unit).toDecimalPlaces(2).toNumber()).replace(/,00$/, "")} ${label}`;
  }
  return formatRupiah(d, { parens: false });
}

export { Decimal };
