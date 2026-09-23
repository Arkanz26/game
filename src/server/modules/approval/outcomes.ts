import { eq } from "drizzle-orm";
import type { Tx } from "@/server/db/client";
import { ledgerPeriods } from "@/server/db/schema";
import type { AuthContext } from "@/server/rbac/authorize";
import type { DocumentRow } from "../documents/service";
import { onStatementApproved, onStatementReturned } from "../reporting/statement.service";
import { onCorrectionApproved, onCorrectionReturned } from "../ledger/correction.service";

/** Domain effects of a completed approval chain, dispatched by document type. */
export async function onApprovalCompleted(tx: Tx, ctx: AuthContext, doc: DocumentRow): Promise<void> {
  switch (doc.documentTypeCode) {
    case "LAPAN":
      if (doc.periodId) {
        await tx
          .update(ledgerPeriods)
          .set({ status: "APPROVED", approvedAt: new Date() })
          .where(eq(ledgerPeriods.id, doc.periodId));
      }
      return;
    case "LANAP":
    case "LANIR":
      return onStatementApproved(tx, ctx, doc);
    case "KOREKSI_PERIODE":
      return onCorrectionApproved(tx, ctx, doc);
  }
}

export async function onApprovalReturned(tx: Tx, ctx: AuthContext, doc: DocumentRow): Promise<void> {
  switch (doc.documentTypeCode) {
    case "LANAP":
    case "LANIR":
      return onStatementReturned(tx, ctx, doc);
    case "KOREKSI_PERIODE":
      return onCorrectionReturned(tx, ctx, doc);
  }
}
