import type { PostingRule, TransactionInputField } from "@/server/db/schema/ledger";
import { parseMoneyInput, toDecimal, toMoneyString, type MoneyString } from "@/lib/money";

export type AccountClass = "ASSET" | "CONTRA_ASSET" | "LIABILITY";

export type PostingLine = {
  accountCode: string;
  lapanLineCode: string;
  /** Change of the account's natural balance. */
  amount: MoneyString;
  /** Effect on net assets. */
  netAssetEffect: MoneyString;
};

export type TransactionTypeDef = {
  code: string;
  inputSchema: TransactionInputField[];
  postingRules: PostingRule[];
  primaryAmountField: string;
};

/** Assets add to net assets; PPAP allowances and liabilities reduce them. */
export function netEffectFactor(cls: AccountClass): 1 | -1 {
  return cls === "ASSET" ? 1 : -1;
}

export type InputValidation =
  { ok: true; inputs: Record<string, string>; amount: MoneyString } | { ok: false; errors: Record<string, string> };

/** Validates raw form input against a transaction type's input schema. */
export function validateInputs(type: TransactionTypeDef, raw: Record<string, string | undefined>): InputValidation {
  const errors: Record<string, string> = {};
  const inputs: Record<string, string> = {};
  for (const field of type.inputSchema) {
    const value = (raw[field.key] ?? "").trim();
    if (value === "") {
      if (field.required) errors[field.key] = `${field.label} wajib diisi`;
      else if (field.kind === "money") inputs[field.key] = "0.00";
      continue;
    }
    if (field.kind === "money") {
      const parsed = parseMoneyInput(value);
      if (parsed === null) errors[field.key] = `${field.label}: format nominal tidak valid`;
      else if (toDecimal(parsed).isNeg()) errors[field.key] = `${field.label} tidak boleh negatif`;
      else inputs[field.key] = parsed;
    } else if (field.kind === "account") {
      if (field.accountCodes && !field.accountCodes.includes(value)) {
        errors[field.key] = `${field.label}: akun tidak diizinkan untuk jenis transaksi ini`;
      } else inputs[field.key] = value;
    } else {
      inputs[field.key] = value;
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const amount = inputs[type.primaryAmountField] ?? "0.00";
  if (toDecimal(amount).isZero()) {
    return { ok: false, errors: { [type.primaryAmountField]: "Nilai transaksi tidak boleh nol" } };
  }
  return { ok: true, inputs, amount };
}

export type PostingOptions = {
  /** Replace every line's LAPAN line (e.g. KOREKSI_PERIODE_LALU for prior-period corrections). */
  lapanOverride?: string;
};

/**
 * Evaluates the type's posting rules against validated inputs. Zero lines are dropped.
 * Throws if a rule references an unknown account or input — that is a configuration error.
 */
export function buildPostingLines(
  type: TransactionTypeDef,
  inputs: Record<string, string>,
  accountClasses: Map<string, AccountClass>,
  opts: PostingOptions = {},
): PostingLine[] {
  const lines: PostingLine[] = [];
  for (const rule of type.postingRules) {
    const accountCode = typeof rule.account === "string" ? rule.account : inputs[rule.account.fromInput];
    if (!accountCode) throw new Error(`Aturan posting ${type.code}: input akun ${JSON.stringify(rule.account)} kosong`);
    const cls = accountClasses.get(accountCode);
    if (!cls) throw new Error(`Aturan posting ${type.code}: akun ${accountCode} tidak dikenal`);
    const raw = inputs[rule.amountFrom];
    if (raw === undefined) throw new Error(`Aturan posting ${type.code}: input ${rule.amountFrom} tidak ada`);
    const amount = toDecimal(raw).times(rule.sign);
    if (amount.isZero()) continue;
    lines.push({
      accountCode,
      lapanLineCode: opts.lapanOverride ?? rule.lapanLine,
      amount: toMoneyString(amount),
      netAssetEffect: toMoneyString(amount.times(netEffectFactor(cls))),
    });
  }
  return lines;
}

/** Posting lines of a reversal: the original lines negated. */
export function reverseLines(original: PostingLine[], opts: PostingOptions = {}): PostingLine[] {
  return original.map((l) => ({
    accountCode: l.accountCode,
    lapanLineCode: opts.lapanOverride ?? l.lapanLineCode,
    amount: toMoneyString(toDecimal(l.amount).neg()),
    netAssetEffect: toMoneyString(toDecimal(l.netAssetEffect).neg()),
  }));
}
