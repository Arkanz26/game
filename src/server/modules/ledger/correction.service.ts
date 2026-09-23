import { and, desc, eq, inArray } from "drizzle-orm";
import type { Executor, Tx } from "@/server/db/client";
import { withTx } from "@/server/db/tx";
import { ledgerPeriods, periodCorrectionRequests, users } from "@/server/db/schema";
import { audit } from "@/server/audit/audit";
import { DomainError, NotFoundError } from "@/server/errors";
import type { AuthContext } from "@/server/rbac/authorize";
import { todayWib } from "@/lib/dates";
import { requireBdl } from "../bdl/access";
import { getParameters } from "../config/effective";
import { createGeneratedDocument, type DocumentRow } from "../documents/service";
import { submitForApproval } from "../approval/workflow.service";
import { loadPeriod, periodLabel } from "./period.service";

const DEFAULT_WINDOW_DAYS = 14;

/**
 * Explicit correction mechanism for locked periods: once approved, correction/reversal
 * entries dated in the target period may be posted — they are reported in the current
 * OPEN period under "Koreksi periode sebelumnya"; the locked LAPAN is never altered.
 */
export async function requestCorrection(
  ctx: AuthContext,
  input: { targetPeriodId: string; reason: string },
): Promise<string> {
  if (input.reason.trim().length < 10) throw new DomainError("Uraikan alasan koreksi (minimal 10 karakter)");
  return withTx(ctx, async (tx) => {
    const period = await loadPeriod(tx, input.targetPeriodId);
    const b = await requireBdl(tx, ctx, "correction.request", period.bdlId);
    if (period.status === "OPEN") throw new DomainError("Periode masih terbuka; koreksi dapat dilakukan langsung");
    const [req] = await tx
      .insert(periodCorrectionRequests)
      .values({
        bdlId: b.id,
        targetPeriodId: period.id,
        reason: input.reason.trim(),
        status: "IN_REVIEW",
        requestedBy: ctx.user.id,
      })
      .returning();
    const doc = await createGeneratedDocument(tx, ctx, {
      bdlId: b.id,
      documentTypeCode: "KOREKSI_PERIODE",
      title: `Permohonan Koreksi ${b.code} — ${periodLabel(period)}`,
      periodId: period.id,
      effectiveDate: todayWib(),
      content: {
        kind: "KOREKSI_PERIODE",
        correctionRequestId: req.id,
        targetPeriod: { id: period.id, start: period.periodStart, end: period.periodEnd },
        reason: req.reason,
      },
      metadata: { correctionRequestId: req.id },
    });
    await tx
      .update(periodCorrectionRequests)
      .set({ documentId: doc.id })
      .where(eq(periodCorrectionRequests.id, req.id));
    await audit(tx, ctx, {
      action: "correction.request",
      entityType: "period_correction_request",
      entityId: req.id,
      bdlId: b.id,
      after: req,
    });
    await submitForApproval(tx, ctx, { documentId: doc.id });
    return req.id;
  });
}

async function requestForDocument(tx: Tx, doc: DocumentRow) {
  const [req] = await tx.select().from(periodCorrectionRequests).where(eq(periodCorrectionRequests.documentId, doc.id));
  if (!req) throw new NotFoundError("Permohonan koreksi");
  return req;
}

export async function onCorrectionApproved(tx: Tx, _ctx: AuthContext, doc: DocumentRow) {
  const req = await requestForDocument(tx, doc);
  const params = await getParameters(tx, todayWib());
  const days = Number(params.CORRECTION_WINDOW_DAYS?.value ?? DEFAULT_WINDOW_DAYS);
  await tx
    .update(periodCorrectionRequests)
    .set({ status: "APPROVED", windowUntil: new Date(Date.now() + days * 86_400_000) })
    .where(eq(periodCorrectionRequests.id, req.id));
}

export async function onCorrectionReturned(tx: Tx, _ctx: AuthContext, doc: DocumentRow) {
  const req = await requestForDocument(tx, doc);
  await tx.update(periodCorrectionRequests).set({ status: "RETURNED" }).where(eq(periodCorrectionRequests.id, req.id));
}

export async function listCorrections(exec: Executor, bdlId: string, opts: { usableOnly?: boolean } = {}) {
  const rows = await exec
    .select({ request: periodCorrectionRequests, period: ledgerPeriods, requesterName: users.name })
    .from(periodCorrectionRequests)
    .innerJoin(ledgerPeriods, eq(ledgerPeriods.id, periodCorrectionRequests.targetPeriodId))
    .innerJoin(users, eq(users.id, periodCorrectionRequests.requestedBy))
    .where(
      opts.usableOnly
        ? and(eq(periodCorrectionRequests.bdlId, bdlId), inArray(periodCorrectionRequests.status, ["APPROVED"]))
        : eq(periodCorrectionRequests.bdlId, bdlId),
    )
    .orderBy(desc(periodCorrectionRequests.createdAt));
  return opts.usableOnly
    ? rows.filter((r) => r.request.windowUntil && r.request.windowUntil.getTime() > Date.now())
    : rows;
}
