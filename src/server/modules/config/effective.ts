import { and, asc, eq, gt, isNull, lte, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Executor } from "@/server/db/client";
import {
  accounts,
  approvalChainSteps,
  approvalChainTemplates,
  approvalMatrixRules,
  lapanLineItems,
  systemParameters,
  transactionTypes,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import type { IsoDate } from "@/lib/dates";

/** `effective_from <= d < effective_to` (NULL upper bound = still in force). */
export function effectiveOn(t: { effectiveFrom: AnyPgColumn; effectiveTo: AnyPgColumn }, d: IsoDate): SQL {
  return and(lte(t.effectiveFrom, d), or(isNull(t.effectiveTo), gt(t.effectiveTo, d)))!;
}

export type AccountRow = typeof accounts.$inferSelect;
export type LapanLineRow = typeof lapanLineItems.$inferSelect;
export type TransactionTypeRow = typeof transactionTypes.$inferSelect;
export type MatrixRuleRow = typeof approvalMatrixRules.$inferSelect;

export function getAccounts(exec: Executor, d: IsoDate): Promise<AccountRow[]> {
  return exec.select().from(accounts).where(effectiveOn(accounts, d)).orderBy(asc(accounts.sortOrder));
}

export function getLapanLines(exec: Executor, d: IsoDate): Promise<LapanLineRow[]> {
  return exec
    .select()
    .from(lapanLineItems)
    .where(effectiveOn(lapanLineItems, d))
    .orderBy(asc(lapanLineItems.sortOrder));
}

export function getTransactionTypes(exec: Executor, d: IsoDate): Promise<TransactionTypeRow[]> {
  return exec
    .select()
    .from(transactionTypes)
    .where(effectiveOn(transactionTypes, d))
    .orderBy(asc(transactionTypes.sortOrder));
}

export async function getTransactionType(exec: Executor, code: string, d: IsoDate): Promise<TransactionTypeRow> {
  const [row] = await exec
    .select()
    .from(transactionTypes)
    .where(and(eq(transactionTypes.code, code), effectiveOn(transactionTypes, d)));
  if (!row) throw new DomainError(`Jenis transaksi ${code} tidak berlaku pada tanggal ${d}`);
  return row;
}

export async function getParameters(
  exec: Executor,
  d: IsoDate,
): Promise<Record<string, { id: string; value: unknown }>> {
  const rows = await exec.select().from(systemParameters).where(effectiveOn(systemParameters, d));
  return Object.fromEntries(rows.map((r) => [r.code, { id: r.id, value: r.value }]));
}

export function getMatrixRules(exec: Executor, documentTypeCode: string, d: IsoDate): Promise<MatrixRuleRow[]> {
  return exec
    .select()
    .from(approvalMatrixRules)
    .where(and(eq(approvalMatrixRules.documentTypeCode, documentTypeCode), effectiveOn(approvalMatrixRules, d)));
}

export async function getChainTemplate(exec: Executor, code: string, d: IsoDate) {
  const [template] = await exec
    .select()
    .from(approvalChainTemplates)
    .where(and(eq(approvalChainTemplates.code, code), effectiveOn(approvalChainTemplates, d)));
  if (!template) throw new DomainError(`Template rantai persetujuan ${code} tidak berlaku pada ${d}`);
  const steps = await exec
    .select()
    .from(approvalChainSteps)
    .where(eq(approvalChainSteps.templateId, template.id))
    .orderBy(asc(approvalChainSteps.stepOrder));
  return { template, steps };
}

/** Display name of an account for a BDL profile (e.g. "Pembiayaan" for syariah banks). */
export function accountLabel(a: Pick<AccountRow, "name" | "labelOverrides">, bankType: string): string {
  return a.labelOverrides?.[bankType] ?? a.name;
}
