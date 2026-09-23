import { and, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import type { Executor, Tx } from "@/server/db/client";
import { withTx } from "@/server/db/tx";
import { documents, ledgerPeriods, netAssetStatementLines, netAssetStatements } from "@/server/db/schema";
import { audit } from "@/server/audit/audit";
import { DomainError, NotFoundError } from "@/server/errors";
import type { AuthContext } from "@/server/rbac/authorize";
import { formatTanggal, isIsoDate } from "@/lib/dates";
import { parseMoneyInput, toDecimal, type MoneyString } from "@/lib/money";
import { loadBdl, requireBdl, type BdlRow } from "../bdl/access";
import {
  addGeneratedVersion,
  createGeneratedDocument,
  loadDocument,
  recordEvent,
  type DocumentRow,
} from "../documents/service";
import { loadPeriod, openPeriodAfter, periodLabel } from "../ledger/period.service";
import { submitForApproval } from "../approval/workflow.service";
import { computeLapan } from "./lapan-calc";
import { accountDefs, loadLapanSnapshot } from "./lapan.service";

export type StatementRow = typeof netAssetStatements.$inferSelect;

export async function listStatements(exec: Executor, bdlId: string) {
  return exec
    .select()
    .from(netAssetStatements)
    .where(eq(netAssetStatements.bdlId, bdlId))
    .orderBy(desc(netAssetStatements.asOfDate), desc(netAssetStatements.createdAt));
}

export async function getStatementLines(exec: Executor, statementId: string) {
  const lines = await exec
    .select()
    .from(netAssetStatementLines)
    .where(eq(netAssetStatementLines.statementId, statementId));
  return new Map<string, MoneyString>(lines.map((l) => [l.accountCode, l.amount]));
}

/** Statement content: balances per account plus gross/PPAP/net and totals (via the LAPAN calculator with no movements). */
async function statementContent(
  exec: Executor,
  b: BdlRow,
  s: Pick<StatementRow, "id" | "kind" | "asOfDate">,
  balances: Map<string, MoneyString>,
) {
  const accounts = await accountDefs(exec, b, s.asOfDate);
  const result = computeLapan({ accounts, lapanLines: [], opening: balances, postings: [] });
  return {
    kind: s.kind,
    statementId: s.id,
    bdl: { id: b.id, code: b.code, name: b.name, grade: b.grade, bankType: b.bankType },
    asOfDate: s.asOfDate,
    accounts: result.accounts.map((a) => ({
      code: a.code,
      name: a.name,
      accountClass: a.accountClass,
      amount: a.closing,
    })),
    grossNet: result.grossNet,
    totals: {
      assets: result.totals.closingAssets,
      liabilities: result.totals.closingLiabilities,
      netAssets: result.totals.closingNetAssets,
    },
  };
}

async function replaceLines(tx: Tx, statementId: string, balances: Map<string, MoneyString>) {
  await tx.delete(netAssetStatementLines).where(eq(netAssetStatementLines.statementId, statementId));
  const rows = [...balances.entries()].map(([accountCode, amount]) => ({ statementId, accountCode, amount }));
  if (rows.length) await tx.insert(netAssetStatementLines).values(rows);
}

/**
 * Saves the initial LANAP baseline (from the audited opening position) as a draft.
 * Only possible before the first baseline is locked — later LANAPs derive from LANIRs.
 */
export async function saveLanapDraft(
  ctx: AuthContext,
  input: { bdlId: string; asOfDate: string; amounts: Record<string, string | undefined> },
): Promise<StatementRow> {
  return withTx(ctx, async (tx) => {
    const b = await requireBdl(tx, ctx, "baseline.manage", input.bdlId);
    if (!isIsoDate(input.asOfDate)) throw new DomainError("Tanggal posisi LANAP tidak valid");
    const existing = await tx
      .select()
      .from(netAssetStatements)
      .where(and(eq(netAssetStatements.bdlId, b.id), eq(netAssetStatements.kind, "LANAP")));
    if (existing.some((s) => s.status === "LOCKED"))
      throw new DomainError("LANAP baseline sudah dikunci; LANAP berikutnya berasal dari LANIR");
    if (existing.some((s) => s.status === "IN_REVIEW")) throw new DomainError("LANAP sedang dalam proses persetujuan");

    const accounts = await accountDefs(tx, b, input.asOfDate);
    const balances = new Map<string, MoneyString>();
    const errors: string[] = [];
    for (const a of accounts) {
      const raw = input.amounts[a.code]?.trim() ?? "";
      if (raw === "") continue;
      const v = parseMoneyInput(raw);
      if (v === null || toDecimal(v).isNeg()) errors.push(`${a.name}: nominal tidak valid`);
      else if (!toDecimal(v).isZero()) balances.set(a.code, v);
    }
    if (errors.length) throw new DomainError(errors.join("; "));

    let statement = existing.find((s) => s.status === "DRAFT");
    if (statement) {
      [statement] = await tx
        .update(netAssetStatements)
        .set({ asOfDate: input.asOfDate })
        .where(eq(netAssetStatements.id, statement.id))
        .returning();
    } else {
      [statement] = await tx
        .insert(netAssetStatements)
        .values({ bdlId: b.id, kind: "LANAP", asOfDate: input.asOfDate, createdBy: ctx.user.id })
        .returning();
    }
    await replaceLines(tx, statement.id, balances);
    await audit(tx, ctx, {
      action: "lanap.save_draft",
      entityType: "net_asset_statement",
      entityId: statement.id,
      bdlId: b.id,
      after: { asOfDate: input.asOfDate, lines: Object.fromEntries(balances) },
    });
    return statement;
  });
}

async function snapshotAndSubmit(tx: Tx, ctx: AuthContext, b: BdlRow, s: StatementRow) {
  const balances = await getStatementLines(tx, s.id);
  const content = await statementContent(tx, b, s, balances);
  let doc: DocumentRow;
  if (s.documentId) {
    doc = await loadDocument(tx, s.documentId);
    await addGeneratedVersion(tx, ctx, doc, content, "Diajukan ulang");
  } else {
    doc = await createGeneratedDocument(tx, ctx, {
      bdlId: b.id,
      documentTypeCode: s.kind,
      title: `${s.kind} ${b.code} per ${formatTanggal(s.asOfDate)}`,
      periodId: s.sourcePeriodId,
      effectiveDate: s.asOfDate,
      content,
      metadata: { statementId: s.id },
    });
  }
  await tx
    .update(netAssetStatements)
    .set({ status: "IN_REVIEW", documentId: doc.id })
    .where(eq(netAssetStatements.id, s.id));
  await submitForApproval(tx, ctx, { documentId: doc.id, documentAmount: content.totals.netAssets });
}

export async function submitLanap(ctx: AuthContext, statementId: string): Promise<void> {
  await withTx(ctx, async (tx) => {
    const [s] = await tx.select().from(netAssetStatements).where(eq(netAssetStatements.id, statementId));
    if (!s || s.kind !== "LANAP") throw new NotFoundError("LANAP");
    const b = await requireBdl(tx, ctx, "lapan.submit", s.bdlId);
    await requireBdl(tx, ctx, "baseline.manage", s.bdlId);
    if (s.status !== "DRAFT") throw new DomainError("LANAP tidak dalam status draft");
    const lines = await getStatementLines(tx, s.id);
    if (lines.size === 0) throw new DomainError("LANAP belum memiliki saldo akun");
    await snapshotAndSubmit(tx, ctx, b, s);
  });
}

/** Issues the LANIR at the end of an approved period; once approved it becomes the next LANAP. */
export async function issueLanir(ctx: AuthContext, periodId: string): Promise<void> {
  await withTx(ctx, async (tx) => {
    const period = await loadPeriod(tx, periodId);
    const b = await requireBdl(tx, ctx, "lanir.issue", period.bdlId);
    if (period.status !== "APPROVED" || !period.lapanDocumentId)
      throw new DomainError("LANIR hanya dapat diterbitkan setelah LAPAN periode disetujui");
    const { snapshot } = await loadLapanSnapshot(tx, period.lapanDocumentId);
    if (!snapshot) throw new DomainError("Snapshot LAPAN tidak ditemukan");
    const unapproved = await tx
      .select({ id: ledgerPeriods.id })
      .from(ledgerPeriods)
      .where(
        and(
          eq(ledgerPeriods.bdlId, b.id),
          ne(ledgerPeriods.status, "APPROVED"),
          lte(ledgerPeriods.periodEnd, period.periodEnd),
          gte(ledgerPeriods.periodStart, snapshot.baseline.asOfDate),
        ),
      );
    if (unapproved.length)
      throw new DomainError("Seluruh LAPAN sejak LANAP terakhir harus disetujui sebelum LANIR diterbitkan");
    const later = await tx
      .select({ id: netAssetStatements.id })
      .from(netAssetStatements)
      .where(
        and(
          eq(netAssetStatements.bdlId, b.id),
          eq(netAssetStatements.kind, "LANAP"),
          eq(netAssetStatements.status, "LOCKED"),
          gte(netAssetStatements.asOfDate, period.periodEnd),
        ),
      );
    if (later.length) throw new DomainError("Sudah ada LANAP pada atau setelah tanggal ini");

    const [existing] = await tx
      .select()
      .from(netAssetStatements)
      .where(
        and(
          eq(netAssetStatements.sourcePeriodId, period.id),
          eq(netAssetStatements.kind, "LANIR"),
          inArray(netAssetStatements.status, ["DRAFT", "IN_REVIEW", "LOCKED"]),
        ),
      );
    if (existing && existing.status !== "DRAFT") throw new DomainError("LANIR untuk periode ini sudah diterbitkan");
    let statement = existing;
    if (!statement) {
      [statement] = await tx
        .insert(netAssetStatements)
        .values({
          bdlId: b.id,
          kind: "LANIR",
          asOfDate: period.periodEnd,
          sourcePeriodId: period.id,
          createdBy: ctx.user.id,
        })
        .returning();
      const closing = new Map(
        snapshot.result.accounts.filter((a) => !toDecimal(a.closing).isZero()).map((a) => [a.code, a.closing]),
      );
      await replaceLines(tx, statement.id, closing);
    }
    await audit(tx, ctx, {
      action: "lanir.issue",
      entityType: "net_asset_statement",
      entityId: statement.id,
      bdlId: b.id,
      after: { periodId: period.id, asOfDate: period.periodEnd },
    });
    await snapshotAndSubmit(tx, ctx, b, statement);
  });
}

// --- approval outcomes -------------------------------------------------------

async function statementForDocument(tx: Tx, doc: DocumentRow): Promise<StatementRow> {
  const [s] = await tx.select().from(netAssetStatements).where(eq(netAssetStatements.documentId, doc.id));
  if (!s) throw new NotFoundError("Laporan aset neto");
  return s;
}

export async function onStatementApproved(tx: Tx, ctx: AuthContext, doc: DocumentRow): Promise<void> {
  const s = await statementForDocument(tx, doc);
  await tx
    .update(netAssetStatements)
    .set({ status: "LOCKED", lockedAt: new Date() })
    .where(eq(netAssetStatements.id, s.id));
  const b = await loadBdl(tx, s.bdlId);
  if (s.kind === "LANAP") {
    const [anyPeriod] = await tx
      .select({ id: ledgerPeriods.id })
      .from(ledgerPeriods)
      .where(eq(ledgerPeriods.bdlId, b.id))
      .limit(1);
    if (!anyPeriod) {
      const p = await openPeriodAfter(tx, b.id, s.asOfDate);
      await recordEvent(tx, ctx, {
        bdlId: b.id,
        eventType: "PERIOD_OPENED",
        title: `Buku besar dibuka mulai periode ${periodLabel(p)}`,
        refEntityType: "ledger_period",
        refEntityId: p.id,
      });
    }
    await recordEvent(tx, ctx, {
      bdlId: b.id,
      eventType: "LANAP_LOCKED",
      title: `LANAP per ${formatTanggal(s.asOfDate)} dikunci`,
      refEntityType: "net_asset_statement",
      refEntityId: s.id,
    });
    return;
  }
  // LANIR approved → it becomes the LANAP of the next reporting period.
  const balances = await getStatementLines(tx, s.id);
  const [lanap] = await tx
    .insert(netAssetStatements)
    .values({
      bdlId: b.id,
      kind: "LANAP",
      asOfDate: s.asOfDate,
      derivedFromStatementId: s.id,
      sourcePeriodId: s.sourcePeriodId,
      createdBy: ctx.user.id,
    })
    .returning();
  await replaceLines(tx, lanap.id, balances);
  const content = { ...(await statementContent(tx, b, lanap, balances)), derivedFromLanir: s.id };
  const lanapDoc = await createGeneratedDocument(tx, ctx, {
    bdlId: b.id,
    documentTypeCode: "LANAP",
    title: `LANAP ${b.code} per ${formatTanggal(s.asOfDate)} (dari LANIR)`,
    effectiveDate: s.asOfDate,
    content,
    metadata: { statementId: lanap.id, derivedFromLanirDocumentId: doc.id },
    changeNote: "LANAP diturunkan otomatis dari LANIR yang disetujui",
  });
  await tx.update(documents).set({ status: "LOCKED" }).where(eq(documents.id, lanapDoc.id));
  await tx
    .update(netAssetStatements)
    .set({ documentId: lanapDoc.id, status: "LOCKED", lockedAt: new Date() })
    .where(eq(netAssetStatements.id, lanap.id));
  await recordEvent(tx, ctx, {
    bdlId: b.id,
    eventType: "LANIR_LOCKED",
    title: `LANIR per ${formatTanggal(s.asOfDate)} disetujui dan menjadi LANAP periode berikutnya`,
    refEntityType: "net_asset_statement",
    refEntityId: s.id,
  });
}

export async function onStatementReturned(tx: Tx, _ctx: AuthContext, doc: DocumentRow): Promise<void> {
  const s = await statementForDocument(tx, doc);
  await tx.update(netAssetStatements).set({ status: "DRAFT" }).where(eq(netAssetStatements.id, s.id));
}
