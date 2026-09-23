import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import type { Executor } from "@/server/db/client";
import { withTx } from "@/server/db/tx";
import {
  documents,
  ledgerEntries,
  ledgerPeriods,
  ledgerPostingLines,
  netAssetStatementLines,
  netAssetStatements,
} from "@/server/db/schema";
import { audit } from "@/server/audit/audit";
import { DomainError } from "@/server/errors";
import type { AuthContext } from "@/server/rbac/authorize";
import { formatTanggal, type IsoDate } from "@/lib/dates";
import { toDecimal, toMoneyString, type MoneyString } from "@/lib/money";
import { requireBdl, type BdlRow } from "../bdl/access";
import { accountLabel, getAccounts, getLapanLines } from "../config/effective";
import { addGeneratedVersion, createGeneratedDocument, getCurrentVersion, loadDocument } from "../documents/service";
import { loadPeriod, periodLabel, type PeriodRow } from "../ledger/period.service";
import { submitForApproval } from "../approval/workflow.service";
import { computeLapan, type AccountDef, type LapanResult } from "./lapan-calc";

export type Baseline = { statementId: string; kind: "LANAP" | "LANIR"; asOfDate: IsoDate; documentId: string | null };

/** The locked LANAP in force for a period: the latest one dated before the period starts. */
export async function getBaseline(exec: Executor, bdlId: string, before: IsoDate): Promise<Baseline | null> {
  const [s] = await exec
    .select()
    .from(netAssetStatements)
    .where(
      and(
        eq(netAssetStatements.bdlId, bdlId),
        eq(netAssetStatements.kind, "LANAP"),
        eq(netAssetStatements.status, "LOCKED"),
        lt(netAssetStatements.asOfDate, before),
      ),
    )
    .orderBy(desc(netAssetStatements.asOfDate))
    .limit(1);
  return s ? { statementId: s.id, kind: s.kind, asOfDate: s.asOfDate, documentId: s.documentId } : null;
}

/** Opening balances for a period = baseline LANAP + verified postings of the periods in between. */
export async function openingBalances(exec: Executor, bdlId: string, periodStart: IsoDate) {
  const baseline = await getBaseline(exec, bdlId, periodStart);
  if (!baseline) throw new DomainError("LANAP baseline yang telah dikunci belum tersedia untuk periode ini");
  const lines = await exec
    .select()
    .from(netAssetStatementLines)
    .where(eq(netAssetStatementLines.statementId, baseline.statementId));
  const balances = new Map<string, MoneyString>(lines.map((l) => [l.accountCode, l.amount]));
  const movements = await exec
    .select({ accountCode: ledgerPostingLines.accountCode, amount: sql<string>`sum(${ledgerPostingLines.amount})` })
    .from(ledgerPostingLines)
    .innerJoin(ledgerPeriods, eq(ledgerPeriods.id, ledgerPostingLines.periodId))
    .where(
      and(
        eq(ledgerPeriods.bdlId, bdlId),
        gt(ledgerPeriods.periodStart, baseline.asOfDate),
        lt(ledgerPeriods.periodStart, periodStart),
      ),
    )
    .groupBy(ledgerPostingLines.accountCode);
  for (const m of movements) {
    balances.set(m.accountCode, toMoneyString(toDecimal(balances.get(m.accountCode)).plus(toDecimal(m.amount))));
  }
  return { baseline, balances };
}

export async function accountDefs(exec: Executor, b: Pick<BdlRow, "bankType">, asOf: IsoDate): Promise<AccountDef[]> {
  const rows = await getAccounts(exec, asOf);
  return rows.map((a) => ({
    code: a.code,
    name: accountLabel(a, b.bankType),
    accountClass: a.accountClass,
    ppapOfCode: a.ppapOfCode,
    sortOrder: a.sortOrder,
  }));
}

export type LapanSnapshot = {
  kind: "LAPAN";
  bdl: { id: string; code: string; name: string; grade: string; bankType: string };
  period: { id: string; start: IsoDate; end: IsoDate; label: string };
  baseline: Baseline;
  entryCount: number;
  generatedAt: string;
  result: LapanResult;
};

/** Live computation of a period's LAPAN from the ledger (used for preview and generation). */
export async function computePeriodLapan(exec: Executor, b: BdlRow, period: PeriodRow) {
  const { baseline, balances } = await openingBalances(exec, b.id, period.periodStart);
  const accounts = await accountDefs(exec, b, period.periodEnd);
  const lapanLines = (await getLapanLines(exec, period.periodEnd)).map((l) => ({
    code: l.code,
    name: l.name,
    section: l.section,
    sortOrder: l.sortOrder,
  }));
  const postings = await exec
    .select({
      accountCode: ledgerPostingLines.accountCode,
      lapanLineCode: ledgerPostingLines.lapanLineCode,
      amount: ledgerPostingLines.amount,
      netAssetEffect: ledgerPostingLines.netAssetEffect,
    })
    .from(ledgerPostingLines)
    .where(eq(ledgerPostingLines.periodId, period.id));
  const [{ n }] = await exec
    .select({ n: sql<number>`count(*)::int` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.periodId, period.id), eq(ledgerEntries.status, "VERIFIED")));
  const result = computeLapan({ accounts, lapanLines, opening: balances, postings });
  return { baseline, result, entryCount: n };
}

const BLOCKING_CHECKS = new Set(["ROLL_FORWARD", "KNOWN_ACCOUNTS", "KNOWN_LAPAN_LINES"]);

/** Generates (or re-generates, as a new immutable version) the LAPAN of a locked period. */
export async function generateLapan(
  ctx: AuthContext,
  periodId: string,
): Promise<{ documentId: string; versionNo: number }> {
  return withTx(ctx, async (tx) => {
    const period = await loadPeriod(tx, periodId);
    const b = await requireBdl(tx, ctx, "lapan.generate", period.bdlId);
    if (period.status === "OPEN") throw new DomainError("Kunci periode terlebih dahulu sebelum menyusun LAPAN");
    if (period.status === "APPROVED") throw new DomainError("LAPAN periode ini sudah disetujui");
    const { baseline, result, entryCount } = await computePeriodLapan(tx, b, period);
    const content: LapanSnapshot = {
      kind: "LAPAN",
      bdl: { id: b.id, code: b.code, name: b.name, grade: b.grade, bankType: b.bankType },
      period: { id: period.id, start: period.periodStart, end: period.periodEnd, label: periodLabel(period) },
      baseline,
      entryCount,
      generatedAt: new Date().toISOString(),
      result,
    };
    let documentId: string;
    let versionNo: number;
    if (period.lapanDocumentId) {
      const doc = await loadDocument(tx, period.lapanDocumentId);
      versionNo = await addGeneratedVersion(tx, ctx, doc, content, "Digenerate ulang dari buku besar");
      documentId = doc.id;
    } else {
      const doc = await createGeneratedDocument(tx, ctx, {
        bdlId: b.id,
        documentTypeCode: "LAPAN",
        title: `LAPAN ${b.code} — ${periodLabel(period)}`,
        periodId: period.id,
        effectiveDate: period.periodEnd,
        content,
        metadata: { periodStart: period.periodStart, periodEnd: period.periodEnd },
      });
      await tx.update(ledgerPeriods).set({ lapanDocumentId: doc.id }).where(eq(ledgerPeriods.id, period.id));
      documentId = doc.id;
      versionNo = 1;
    }
    await audit(tx, ctx, {
      action: "lapan.generate",
      entityType: "ledger_period",
      entityId: period.id,
      bdlId: b.id,
      after: { documentId, versionNo, totals: result.totals },
    });
    return { documentId, versionNo };
  });
}

export async function submitLapan(ctx: AuthContext, periodId: string): Promise<void> {
  await withTx(ctx, async (tx) => {
    const period = await loadPeriod(tx, periodId);
    const b = await requireBdl(tx, ctx, "lapan.submit", period.bdlId);
    if (!period.lapanDocumentId) throw new DomainError("LAPAN belum disusun");
    const doc = await loadDocument(tx, period.lapanDocumentId);
    if (doc.status !== "DRAFT" && doc.status !== "REJECTED") throw new DomainError("LAPAN tidak dalam status draft");
    if (doc.status === "REJECTED")
      throw new DomainError("LAPAN dikembalikan: susun ulang LAPAN (versi baru) sebelum mengajukan kembali");
    const version = await getCurrentVersion(tx, doc);
    const snapshot = version?.contentJson as LapanSnapshot | undefined;
    if (!snapshot) throw new DomainError("Snapshot LAPAN tidak ditemukan");
    const failing = snapshot.result.checks.filter((c) => !c.ok && BLOCKING_CHECKS.has(c.code));
    if (failing.length) throw new DomainError(`LAPAN gagal validasi: ${failing.map((c) => c.description).join("; ")}`);

    // Earlier periods since the baseline must already have their LAPAN submitted.
    const earlier = await tx
      .select({
        id: ledgerPeriods.id,
        start: ledgerPeriods.periodStart,
        end: ledgerPeriods.periodEnd,
        docStatus: documents.status,
      })
      .from(ledgerPeriods)
      .leftJoin(documents, eq(documents.id, ledgerPeriods.lapanDocumentId))
      .where(
        and(
          eq(ledgerPeriods.bdlId, b.id),
          lt(ledgerPeriods.periodStart, period.periodStart),
          gt(ledgerPeriods.periodStart, snapshot.baseline.asOfDate),
        ),
      )
      .orderBy(asc(ledgerPeriods.periodStart));
    const missing = earlier.filter(
      (p) => p.docStatus !== "IN_REVIEW" && p.docStatus !== "LOCKED" && p.docStatus !== "APPROVED",
    );
    if (missing.length) {
      throw new DomainError(
        `LAPAN periode sebelumnya (${missing.map((p) => formatTanggal(p.end)).join(", ")}) belum diajukan`,
      );
    }
    await submitForApproval(tx, ctx, { documentId: doc.id, documentAmount: snapshot.result.totals.closingNetAssets });
  });
}

export async function loadLapanSnapshot(exec: Executor, documentId: string) {
  const doc = await loadDocument(exec, documentId);
  const version = await getCurrentVersion(exec, doc);
  return { doc, version, snapshot: version?.contentJson as LapanSnapshot | undefined };
}

export async function periodsSinceBaseline(exec: Executor, bdlId: string, baselineAsOf: IsoDate) {
  return exec
    .select()
    .from(ledgerPeriods)
    .where(and(eq(ledgerPeriods.bdlId, bdlId), gt(ledgerPeriods.periodStart, baselineAsOf)))
    .orderBy(asc(ledgerPeriods.periodStart));
}
