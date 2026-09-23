import { and, asc, desc, eq, inArray, max, ne, sql, type SQL } from "drizzle-orm";
import type { Executor, Tx } from "@/server/db/client";
import { withTx } from "@/server/db/tx";
import {
  ledgerEntries,
  ledgerPeriods,
  ledgerPostingLines,
  periodCorrectionRequests,
  transactionTypes,
  users,
} from "@/server/db/schema";
import { audit } from "@/server/audit/audit";
import { DomainError, NotFoundError } from "@/server/errors";
import type { AuthContext } from "@/server/rbac/authorize";
import { isIsoDate, todayWib, type IsoDate } from "@/lib/dates";
import { requireBdl } from "../bdl/access";
import { getAccounts, getTransactionType } from "../config/effective";
import { buildPostingLines, reverseLines, validateInputs, type AccountClass, type PostingLine } from "./posting-engine";
import { getOpenPeriod, periodLabel } from "./period.service";

export const PRIOR_PERIOD_LAPAN_LINE = "KOREKSI_PERIODE_LALU";

export type EntryRow = typeof ledgerEntries.$inferSelect;
export type CounterpartyType = NonNullable<EntryRow["counterpartyType"]>;

export type CreateEntryInput = {
  bdlId: string;
  transactionTypeCode: string;
  transactionDate: string;
  description: string;
  counterpartyType?: CounterpartyType | null;
  counterpartyName?: string | null;
  assetRef?: string | null;
  evidenceRef?: string | null;
  rawInputs: Record<string, string | undefined>;
  /** Required when the transaction date falls in a locked period. */
  correctionRequestId?: string | null;
  submit?: boolean;
};

export class EntryValidationError extends DomainError {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super("Periksa kembali isian transaksi");
  }
}

async function nextEntryNo(tx: Tx, bdlId: string): Promise<number> {
  // Serialise numbering per BDL.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${bdlId}, 0))`);
  const [row] = await tx
    .select({ n: max(ledgerEntries.entryNo) })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.bdlId, bdlId));
  return (row?.n ?? 0) + 1;
}

async function loadEntryForUpdate(tx: Tx, entryId: string): Promise<EntryRow> {
  const [e] = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.id, entryId)).for("update");
  if (!e) throw new NotFoundError("Entri transaksi");
  return e;
}

/** Resolves where a transaction with this date is reported: the open period, or via an approved correction. */
async function resolvePosting(
  tx: Tx,
  bdlId: string,
  date: IsoDate,
  correctionRequestId: string | null | undefined,
): Promise<{
  periodId: string;
  originPeriodId: string | null;
  correctionRequestId: string | null;
  kind: "NORMAL" | "CORRECTION";
}> {
  const open = await getOpenPeriod(tx, bdlId);
  if (!open) throw new DomainError("Belum ada periode buku besar yang terbuka (LANAP baseline belum dikunci?)");
  if (date > open.periodEnd) {
    throw new DomainError(
      `Periode yang berjalan adalah ${periodLabel(open)}; kunci periode tersebut sebelum mencatat transaksi ${date}`,
    );
  }
  if (date >= open.periodStart)
    return { periodId: open.id, originPeriodId: null, correctionRequestId: null, kind: "NORMAL" };

  if (!correctionRequestId) {
    throw new DomainError(
      `Tanggal ${date} berada pada periode yang sudah dikunci. Transaksi hanya dapat dicatat melalui Permohonan Koreksi yang disetujui.`,
    );
  }
  const [cr] = await tx
    .select()
    .from(periodCorrectionRequests)
    .where(eq(periodCorrectionRequests.id, correctionRequestId));
  if (!cr || cr.bdlId !== bdlId) throw new NotFoundError("Permohonan koreksi");
  if (cr.status !== "APPROVED") throw new DomainError("Permohonan koreksi belum disetujui");
  if (!cr.windowUntil || cr.windowUntil.getTime() < Date.now()) throw new DomainError("Jendela koreksi sudah berakhir");
  const [target] = await tx.select().from(ledgerPeriods).where(eq(ledgerPeriods.id, cr.targetPeriodId));
  if (date < target.periodStart || date > target.periodEnd) {
    throw new DomainError(`Tanggal koreksi harus berada dalam periode ${periodLabel(target)}`);
  }
  return { periodId: open.id, originPeriodId: target.id, correctionRequestId: cr.id, kind: "CORRECTION" };
}

export async function createEntry(ctx: AuthContext, input: CreateEntryInput): Promise<EntryRow> {
  return withTx(ctx, async (tx) => {
    const bdl = await requireBdl(tx, ctx, "ledger.entry.create", input.bdlId);
    if (input.correctionRequestId) await requireBdl(tx, ctx, "correction.post", input.bdlId);

    const fieldErrors: Record<string, string> = {};
    if (!isIsoDate(input.transactionDate)) fieldErrors.transactionDate = "Tanggal transaksi tidak valid";
    else if (input.transactionDate > todayWib())
      fieldErrors.transactionDate = "Tanggal transaksi tidak boleh di masa depan";
    if (!input.description.trim()) fieldErrors.description = "Uraian wajib diisi";
    if (Object.keys(fieldErrors).length) throw new EntryValidationError(fieldErrors);

    const type = await getTransactionType(tx, input.transactionTypeCode, input.transactionDate);
    if (type.requiresSeparatistCreditor && !bdl.hasSeparatistCreditor) {
      throw new DomainError(`${type.name} hanya berlaku untuk BDL yang memiliki kreditur separatis`);
    }
    if (type.requiresCounterparty && !input.counterpartyName?.trim()) {
      throw new EntryValidationError({ counterpartyName: "Pihak lawan transaksi wajib diisi" });
    }
    const validated = validateInputs(type, input.rawInputs);
    if (!validated.ok) throw new EntryValidationError(validated.errors);

    const where = await resolvePosting(tx, bdl.id, input.transactionDate, input.correctionRequestId);
    const entryNo = await nextEntryNo(tx, bdl.id);
    const now = new Date();
    const [entry] = await tx
      .insert(ledgerEntries)
      .values({
        bdlId: bdl.id,
        periodId: where.periodId,
        entryNo,
        transactionTypeId: type.id,
        transactionTypeCode: type.code,
        transactionDate: input.transactionDate,
        description: input.description.trim(),
        amount: validated.amount,
        inputs: validated.inputs,
        counterpartyType: input.counterpartyType ?? type.defaultCounterpartyType ?? null,
        counterpartyName: input.counterpartyName?.trim() || null,
        assetRef: input.assetRef?.trim() || null,
        evidenceRef: input.evidenceRef?.trim() || null,
        entryKind: where.kind,
        correctionRequestId: where.correctionRequestId,
        originPeriodId: where.originPeriodId,
        status: input.submit ? "SUBMITTED" : "DRAFT",
        submittedAt: input.submit ? now : null,
        createdBy: ctx.user.id,
      })
      .returning();
    await audit(tx, ctx, {
      action: "ledger.entry.create",
      entityType: "ledger_entry",
      entityId: entry.id,
      bdlId: bdl.id,
      after: entry,
    });
    return entry;
  });
}

export async function submitEntry(ctx: AuthContext, entryId: string): Promise<void> {
  await withTx(ctx, async (tx) => {
    const e = await loadEntryForUpdate(tx, entryId);
    await requireBdl(tx, ctx, "ledger.entry.submit", e.bdlId);
    if (e.createdBy !== ctx.user.id) throw new DomainError("Hanya pembuat entri yang dapat mengajukannya");
    if (e.status !== "DRAFT") throw new DomainError("Hanya entri DRAFT yang dapat diajukan");
    await tx
      .update(ledgerEntries)
      .set({ status: "SUBMITTED", submittedAt: new Date() })
      .where(eq(ledgerEntries.id, e.id));
    await audit(tx, ctx, {
      action: "ledger.entry.submit",
      entityType: "ledger_entry",
      entityId: e.id,
      bdlId: e.bdlId,
      before: { status: e.status },
      after: { status: "SUBMITTED" },
    });
  });
}

export async function withdrawEntry(ctx: AuthContext, entryId: string): Promise<void> {
  await withTx(ctx, async (tx) => {
    const e = await loadEntryForUpdate(tx, entryId);
    await requireBdl(tx, ctx, "ledger.entry.submit", e.bdlId);
    if (e.createdBy !== ctx.user.id) throw new DomainError("Hanya pembuat entri yang dapat menariknya kembali");
    if (e.status !== "SUBMITTED") throw new DomainError("Hanya entri yang sedang diajukan yang dapat ditarik");
    await tx.update(ledgerEntries).set({ status: "DRAFT", submittedAt: null }).where(eq(ledgerEntries.id, e.id));
    await audit(tx, ctx, {
      action: "ledger.entry.withdraw",
      entityType: "ledger_entry",
      entityId: e.id,
      bdlId: e.bdlId,
      before: { status: e.status },
      after: { status: "DRAFT" },
    });
  });
}

export async function deleteDraftEntry(ctx: AuthContext, entryId: string): Promise<void> {
  await withTx(ctx, async (tx) => {
    const e = await loadEntryForUpdate(tx, entryId);
    await requireBdl(tx, ctx, "ledger.entry.create", e.bdlId);
    if (e.createdBy !== ctx.user.id) throw new DomainError("Hanya pembuat entri yang dapat menghapus draft");
    if (e.status !== "DRAFT") throw new DomainError("Hanya entri DRAFT yang dapat dihapus");
    await tx.delete(ledgerEntries).where(eq(ledgerEntries.id, e.id));
    await audit(tx, ctx, {
      action: "ledger.entry.delete",
      entityType: "ledger_entry",
      entityId: e.id,
      bdlId: e.bdlId,
      before: e,
    });
  });
}

async function postingLinesFor(tx: Tx, e: EntryRow): Promise<PostingLine[]> {
  const isPriorPeriod = e.originPeriodId !== null && e.originPeriodId !== e.periodId;
  const opts = isPriorPeriod ? { lapanOverride: PRIOR_PERIOD_LAPAN_LINE } : {};
  if (e.entryKind === "REVERSAL") {
    const original = await tx
      .select({
        accountCode: ledgerPostingLines.accountCode,
        lapanLineCode: ledgerPostingLines.lapanLineCode,
        amount: ledgerPostingLines.amount,
        netAssetEffect: ledgerPostingLines.netAssetEffect,
      })
      .from(ledgerPostingLines)
      .where(eq(ledgerPostingLines.entryId, e.correctsEntryId!));
    return reverseLines(original, opts);
  }
  const [type] = await tx.select().from(transactionTypes).where(eq(transactionTypes.id, e.transactionTypeId));
  const accounts = await getAccounts(tx, e.transactionDate);
  const classes = new Map(accounts.map((a) => [a.code, a.accountClass as AccountClass]));
  return buildPostingLines(type, e.inputs, classes, opts);
}

/** PIC verification (maker-checker). Generates the immutable posting lines that feed the LAPAN. */
export async function verifyEntry(ctx: AuthContext, entryId: string): Promise<void> {
  await withTx(ctx, async (tx) => {
    const e = await loadEntryForUpdate(tx, entryId);
    await requireBdl(tx, ctx, "ledger.entry.verify", e.bdlId);
    if (e.status !== "SUBMITTED") throw new DomainError(`Entri #${e.entryNo} tidak dalam status menunggu verifikasi`);
    if (e.createdBy === ctx.user.id)
      throw new DomainError("Pembuat entri tidak boleh memverifikasi entrinya sendiri (maker-checker)");
    const lines = await postingLinesFor(tx, e);
    if (lines.length === 0) throw new DomainError("Entri tidak menghasilkan posting apa pun");
    await tx
      .update(ledgerEntries)
      .set({ status: "VERIFIED", verifiedBy: ctx.user.id, verifiedAt: new Date() })
      .where(eq(ledgerEntries.id, e.id));
    await tx.insert(ledgerPostingLines).values(lines.map((l) => ({ ...l, entryId: e.id, periodId: e.periodId })));
    await audit(tx, ctx, {
      action: "ledger.entry.verify",
      entityType: "ledger_entry",
      entityId: e.id,
      bdlId: e.bdlId,
      before: { status: e.status },
      after: { status: "VERIFIED", postingLines: lines },
    });
  });
}

export async function rejectEntry(ctx: AuthContext, entryId: string, reason: string): Promise<void> {
  if (!reason.trim()) throw new DomainError("Alasan penolakan wajib diisi");
  await withTx(ctx, async (tx) => {
    const e = await loadEntryForUpdate(tx, entryId);
    await requireBdl(tx, ctx, "ledger.entry.verify", e.bdlId);
    if (e.status !== "SUBMITTED") throw new DomainError(`Entri #${e.entryNo} tidak dalam status menunggu verifikasi`);
    if (e.createdBy === ctx.user.id) throw new DomainError("Pembuat entri tidak boleh menolak entrinya sendiri");
    await tx
      .update(ledgerEntries)
      .set({ status: "REJECTED", verifiedBy: ctx.user.id, verifiedAt: new Date(), rejectionReason: reason.trim() })
      .where(eq(ledgerEntries.id, e.id));
    await audit(tx, ctx, {
      action: "ledger.entry.reject",
      entityType: "ledger_entry",
      entityId: e.id,
      bdlId: e.bdlId,
      before: { status: e.status },
      after: { status: "REJECTED", reason },
    });
  });
}

/**
 * Reverses a VERIFIED entry. Within the open period no approval is needed; for an entry
 * belonging to a locked period an approved correction request covering that period is required.
 * The reversal goes through the normal submit → verify cycle.
 */
export async function reverseEntry(
  ctx: AuthContext,
  entryId: string,
  input: { reason: string; correctionRequestId?: string | null },
): Promise<EntryRow> {
  if (!input.reason.trim()) throw new DomainError("Alasan reversal wajib diisi");
  return withTx(ctx, async (tx) => {
    const [orig] = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.id, entryId));
    if (!orig) throw new NotFoundError("Entri transaksi");
    await requireBdl(tx, ctx, "correction.post", orig.bdlId);
    if (orig.status !== "VERIFIED") throw new DomainError("Hanya entri terverifikasi yang dapat di-reversal");
    if (orig.entryKind === "REVERSAL") throw new DomainError("Entri reversal tidak dapat di-reversal kembali");
    const [existing] = await tx
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.correctsEntryId, orig.id),
          eq(ledgerEntries.entryKind, "REVERSAL"),
          ne(ledgerEntries.status, "REJECTED"),
        ),
      );
    if (existing) throw new DomainError("Entri ini sudah memiliki reversal");

    const where = await resolvePosting(tx, orig.bdlId, orig.transactionDate, input.correctionRequestId);
    const entryNo = await nextEntryNo(tx, orig.bdlId);
    const [rev] = await tx
      .insert(ledgerEntries)
      .values({
        bdlId: orig.bdlId,
        periodId: where.periodId,
        entryNo,
        transactionTypeId: orig.transactionTypeId,
        transactionTypeCode: orig.transactionTypeCode,
        transactionDate: orig.transactionDate,
        description: `Reversal entri #${orig.entryNo}: ${input.reason.trim()}`,
        amount: orig.amount,
        inputs: orig.inputs,
        counterpartyType: orig.counterpartyType,
        counterpartyName: orig.counterpartyName,
        assetRef: orig.assetRef,
        entryKind: "REVERSAL",
        correctsEntryId: orig.id,
        correctionRequestId: where.correctionRequestId,
        originPeriodId: where.originPeriodId,
        status: "SUBMITTED",
        submittedAt: new Date(),
        createdBy: ctx.user.id,
      })
      .returning();
    await audit(tx, ctx, {
      action: "ledger.entry.reverse",
      entityType: "ledger_entry",
      entityId: rev.id,
      bdlId: orig.bdlId,
      after: { reverses: orig.id, reason: input.reason },
    });
    return rev;
  });
}

export type EntryListFilter = { periodId?: string; status?: EntryRow["status"]; typeCode?: string };

export async function listEntries(exec: Executor, ctx: AuthContext, bdlId: string, filter: EntryListFilter = {}) {
  await requireBdl(exec, ctx, "ledger.read", bdlId);
  const conds: SQL[] = [eq(ledgerEntries.bdlId, bdlId)];
  if (filter.periodId) conds.push(eq(ledgerEntries.periodId, filter.periodId));
  if (filter.status) conds.push(eq(ledgerEntries.status, filter.status));
  if (filter.typeCode) conds.push(eq(ledgerEntries.transactionTypeCode, filter.typeCode));
  const creator = users;
  return exec
    .select({
      entry: ledgerEntries,
      typeName: transactionTypes.name,
      creatorName: creator.name,
    })
    .from(ledgerEntries)
    .innerJoin(transactionTypes, eq(transactionTypes.id, ledgerEntries.transactionTypeId))
    .innerJoin(creator, eq(creator.id, ledgerEntries.createdBy))
    .where(and(...conds))
    .orderBy(desc(ledgerEntries.transactionDate), desc(ledgerEntries.entryNo));
}

export async function getEntryDetail(exec: Executor, ctx: AuthContext, entryId: string) {
  const [e] = await exec.select().from(ledgerEntries).where(eq(ledgerEntries.id, entryId));
  if (!e) throw new NotFoundError("Entri transaksi");
  await requireBdl(exec, ctx, "ledger.read", e.bdlId);
  const lines = await exec
    .select()
    .from(ledgerPostingLines)
    .where(eq(ledgerPostingLines.entryId, e.id))
    .orderBy(asc(ledgerPostingLines.createdAt));
  const people = await exec
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(
      inArray(
        users.id,
        [e.createdBy, e.verifiedBy].filter((x): x is string => !!x),
      ),
    );
  const [type] = await exec.select().from(transactionTypes).where(eq(transactionTypes.id, e.transactionTypeId));
  return { entry: e, lines, type, people: new Map(people.map((p) => [p.id, p.name])) };
}
