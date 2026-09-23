import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Executor } from "@/server/db/client";
import { withTx } from "@/server/db/tx";
import { ledgerEntries, ledgerPeriods } from "@/server/db/schema";
import { audit } from "@/server/audit/audit";
import { DomainError, NotFoundError } from "@/server/errors";
import type { AuthContext } from "@/server/rbac/authorize";
import { addDays, endOfMonth, formatBulan, type IsoDate } from "@/lib/dates";
import { recordEvent } from "../documents/service";
import { requireBdl } from "../bdl/access";

export type PeriodRow = typeof ledgerPeriods.$inferSelect;

export async function loadPeriod(exec: Executor, periodId: string): Promise<PeriodRow> {
  const [p] = await exec.select().from(ledgerPeriods).where(eq(ledgerPeriods.id, periodId));
  if (!p) throw new NotFoundError("Periode");
  return p;
}

export async function listPeriods(exec: Executor, bdlId: string): Promise<PeriodRow[]> {
  return exec
    .select()
    .from(ledgerPeriods)
    .where(eq(ledgerPeriods.bdlId, bdlId))
    .orderBy(desc(ledgerPeriods.periodStart));
}

export async function getOpenPeriod(exec: Executor, bdlId: string): Promise<PeriodRow | null> {
  const [p] = await exec
    .select()
    .from(ledgerPeriods)
    .where(and(eq(ledgerPeriods.bdlId, bdlId), eq(ledgerPeriods.status, "OPEN")))
    .orderBy(asc(ledgerPeriods.periodStart))
    .limit(1);
  return p ?? null;
}

export function periodLabel(p: Pick<PeriodRow, "periodStart" | "periodEnd">): string {
  const month = formatBulan(p.periodEnd);
  return p.periodStart.slice(8) === "01" ? month : `${month} (mulai ${Number(p.periodStart.slice(8))})`;
}

/** Opens the monthly period starting the day after `afterDate` (e.g. a LANAP as-of date). */
export async function openPeriodAfter(tx: Executor, bdlId: string, afterDate: IsoDate): Promise<PeriodRow> {
  const start = addDays(afterDate, 1);
  const [p] = await tx
    .insert(ledgerPeriods)
    .values({ bdlId, periodStart: start, periodEnd: endOfMonth(start) })
    .returning();
  return p;
}

export async function countOpenItems(exec: Executor, periodId: string) {
  const rows = await exec
    .select({ status: ledgerEntries.status, n: sql<number>`count(*)::int` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.periodId, periodId), inArray(ledgerEntries.status, ["DRAFT", "SUBMITTED"])))
    .groupBy(ledgerEntries.status);
  const get = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
  return { draft: get("DRAFT"), submitted: get("SUBMITTED") };
}

/**
 * Period close: requires every entry to be VERIFIED or REJECTED (also enforced by trigger),
 * locks the period against further input and opens the next month.
 */
export async function lockPeriod(ctx: AuthContext, periodId: string): Promise<{ nextPeriodId: string }> {
  return withTx(ctx, async (tx) => {
    const [period] = await tx.select().from(ledgerPeriods).where(eq(ledgerPeriods.id, periodId)).for("update");
    if (!period) throw new NotFoundError("Periode");
    await requireBdl(tx, ctx, "period.lock", period.bdlId);
    if (period.status !== "OPEN") throw new DomainError("Periode sudah dikunci");
    const open = await countOpenItems(tx, period.id);
    if (open.draft + open.submitted > 0) {
      throw new DomainError(
        `Periode belum dapat dikunci: ${open.submitted} entri menunggu verifikasi dan ${open.draft} entri draft`,
      );
    }
    await tx
      .update(ledgerPeriods)
      .set({ status: "LOCKED", lockedAt: new Date(), lockedBy: ctx.user.id })
      .where(eq(ledgerPeriods.id, period.id));
    const next = await openPeriodAfter(tx, period.bdlId, period.periodEnd);
    await audit(tx, ctx, {
      action: "period.lock",
      entityType: "ledger_period",
      entityId: period.id,
      bdlId: period.bdlId,
      before: { status: "OPEN" },
      after: { status: "LOCKED", nextPeriodId: next.id },
    });
    await recordEvent(tx, ctx, {
      bdlId: period.bdlId,
      eventType: "PERIOD_LOCKED",
      title: `Periode ${periodLabel(period)} dikunci`,
      refEntityType: "ledger_period",
      refEntityId: period.id,
    });
    return { nextPeriodId: next.id };
  });
}
