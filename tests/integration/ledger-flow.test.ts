import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  approvalRequestSteps,
  approvalRequests,
  documents,
  ledgerPeriods,
  ledgerPostingLines,
  netAssetStatementLines,
  netAssetStatements,
} from "@/server/db/schema";
import type { AuthContext } from "@/server/rbac/authorize";
import { ForbiddenError } from "@/server/rbac/authorize";
import { DomainError } from "@/server/errors";
import {
  createEntry,
  reverseEntry,
  submitEntry,
  verifyEntry,
  rejectEntry,
} from "@/server/modules/ledger/entry.service";
import { getOpenPeriod, lockPeriod } from "@/server/modules/ledger/period.service";
import { requestCorrection } from "@/server/modules/ledger/correction.service";
import {
  computePeriodLapan,
  generateLapan,
  loadLapanSnapshot,
  submitLapan,
} from "@/server/modules/reporting/lapan.service";
import { issueLanir, saveLanapDraft, submitLanap } from "@/server/modules/reporting/statement.service";
import { actOnStep, listInbox } from "@/server/modules/approval/workflow.service";
import { listCases } from "@/server/modules/bdl/service";
import { addDays } from "@/lib/dates";
import { ctxFor, expectDbRejects, freshDatabase, monthDay, monthStart } from "./helpers";

type Org = Awaited<ReturnType<typeof freshDatabase>>;

async function pendingStep(documentId: string) {
  const [s] = await db
    .select({ step: approvalRequestSteps, request: approvalRequests })
    .from(approvalRequestSteps)
    .innerJoin(approvalRequests, eq(approvalRequests.id, approvalRequestSteps.requestId))
    .where(and(eq(approvalRequests.documentId, documentId), eq(approvalRequestSteps.status, "PENDING")));
  return s;
}

async function approve(documentId: string, actor: AuthContext, extra: { gateEvidence?: string } = {}) {
  const s = await pendingStep(documentId);
  await actOnStep(actor, s.step.id, { decision: "APPROVE", ...extra });
}

async function docOf(bdlId: string, type: string) {
  const [d] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.bdlId, bdlId), eq(documents.documentTypeCode, type)))
    .orderBy(sql`created_at desc`)
    .limit(1);
  return d;
}

describe("Buku Besar → LAPAN → approval chain → LANIR (end-to-end through services)", () => {
  let org: Org;
  let tl1: AuthContext,
    tl2: AuthContext,
    pic1: AuthContext,
    pic2: AuthContext,
    katim1: AuthContext,
    kadiv1: AuthContext,
    katim2: AuthContext,
    direktur: AuthContext;
  let b1: string;
  let firstPeriodId: string;

  beforeAll(async () => {
    org = await freshDatabase();
    [tl1, tl2, pic1, pic2, katim1, kadiv1, katim2, direktur] = await Promise.all(
      ["tl1", "tl2", "pic1", "pic2", "katim1", "kadiv1", "katim2", "direktur"].map(ctxFor),
    );
    b1 = org.bdls["BDL-001"].id;
  });

  it("LANAP baseline is approved through the matrix chain and opens the first period", async () => {
    const lanap = await saveLanapDraft(pic1, {
      bdlId: b1,
      asOfDate: addDays(monthStart(-1), -1),
      amounts: { KAS: "1.000.000.000", KREDIT: "5000000000", PPAP_KREDIT: "2000000000", KEWAJIBAN_LPS: "6000000000" },
    });
    await submitLanap(pic1, lanap.id);
    const doc = await docOf(b1, "LANAP");
    const s = await pendingStep(doc.id);
    expect((s.request.resolutionContext as { rule: { code: string } }).rule.code).toBe("LANAP_BAWAH_KAP");
    // Katim of another division is out of scope.
    await expect(actOnStep(katim2, s.step.id, { decision: "APPROVE" })).rejects.toBeInstanceOf(ForbiddenError);
    // Kadiv cannot jump the queue.
    await expect(actOnStep(kadiv1, s.step.id, { decision: "APPROVE" })).rejects.toBeInstanceOf(ForbiddenError);
    await approve(doc.id, katim1);
    await approve(doc.id, kadiv1);

    const [st] = await db.select().from(netAssetStatements).where(eq(netAssetStatements.id, lanap.id));
    expect(st.status).toBe("LOCKED");
    const open = await getOpenPeriod(db, b1);
    expect(open?.periodStart).toBe(monthStart(-1));
    firstPeriodId = open!.id;
    // A locked baseline cannot be edited, even directly in SQL.
    await expectDbRejects(
      db.execute(sql`update net_asset_statement_lines set amount = 1 where statement_id = ${lanap.id}`),
      /SILIKA|violates/,
    );
  });

  it("enforces scope, maker-checker and profile rules on entries", async () => {
    const input = {
      bdlId: b1,
      transactionTypeCode: "PENAGIHAN_PIUTANG",
      transactionDate: monthDay(-1, 5),
      description: "Pelunasan kredit",
      counterpartyName: "Debitur A",
      rawInputs: { cash_received: "425000000", gross_reduction: "500000000", ppap_release: "120000000" },
    };
    await expect(createEntry(tl2, input)).rejects.toBeInstanceOf(ForbiddenError); // TL of another BDL
    await expect(
      createEntry(tl1, {
        ...input,
        transactionTypeCode: "PENYERAHAN_ASET_SEPARATIS",
        rawInputs: { asset_account: "AYDA", book_value: "1", claim_settled: "1" },
      }),
    ).rejects.toThrow(/kreditur separatis/);
    await expect(createEntry(tl1, { ...input, transactionDate: addDays(monthStart(-1), -3) })).rejects.toThrow(
      /Permohonan Koreksi/,
    );
    await expect(createEntry(tl1, { ...input, rawInputs: { cash_received: "abc" } })).rejects.toBeInstanceOf(
      DomainError,
    );

    const e = await createEntry(tl1, { ...input, submit: true });
    expect(e.status).toBe("SUBMITTED");
    expect(e.transactionDate).toBe(monthDay(-1, 5));
    await expect(verifyEntry(tl1, e.id)).rejects.toBeInstanceOf(ForbiddenError);
    await verifyEntry(pic1, e.id);
    const lines = await db.select().from(ledgerPostingLines).where(eq(ledgerPostingLines.entryId, e.id));
    expect(lines).toHaveLength(3);

    // PIC-created entries need another verifier.
    const own = await createEntry(pic1, {
      ...input,
      transactionTypeCode: "BIAYA_LIKUIDASI",
      description: "Biaya",
      rawInputs: { amount: "30000000" },
      submit: true,
    });
    await expect(verifyEntry(pic1, own.id)).rejects.toThrow(/maker-checker/);
    await expectDbRejects(
      db.execute(sql`update ledger_entries set status = 'VERIFIED', verified_by = created_by where id = ${own.id}`),
      /SILIKA|violates/,
    );
    await expect(rejectEntry(pic1, own.id, "x")).rejects.toThrow(/tidak boleh menolak/);

    // Verified entries are final at the database level too.
    await expectDbRejects(db.execute(sql`update ledger_entries set amount = 1 where id = ${e.id}`), /sudah final/);
  });

  it("period cannot be locked while entries are pending; locking opens the next month", async () => {
    const draft = await createEntry(tl1, {
      bdlId: b1,
      transactionTypeCode: "BIAYA_LIKUIDASI",
      transactionDate: monthDay(-1, 10),
      description: "Biaya keamanan",
      rawInputs: { amount: "30000000" },
    });
    // The PIC's own entry above is still SUBMITTED (self-reject is not allowed) — both block the lock.
    await expect(lockPeriod(pic1, firstPeriodId)).rejects.toThrow(/belum dapat dikunci/);
    await expectDbRejects(
      db.execute(sql`update ledger_periods set status = 'LOCKED' where id = ${firstPeriodId}`),
      /belum final/,
    );

    await submitEntry(tl1, draft.id);
    await verifyEntry(pic1, draft.id);
    const [pendingOwn] = await db.execute<{ id: string }>(
      sql`select id from ledger_entries where period_id = ${firstPeriodId} and status = 'SUBMITTED'`,
    );
    await expect(verifyEntry(katim1, pendingOwn.id)).rejects.toBeInstanceOf(ForbiddenError); // reviewers do not verify entries
    await expect(verifyEntry(pic2, pendingOwn.id)).rejects.toBeInstanceOf(ForbiddenError); // PIC outside portfolio
    // Withdraw path: PIC pulls own entry back to draft and deletes it.
    const { withdrawEntry, deleteDraftEntry } = await import("@/server/modules/ledger/entry.service");
    await withdrawEntry(pic1, pendingOwn.id);
    await deleteDraftEntry(pic1, pendingOwn.id);

    const { nextPeriodId } = await lockPeriod(pic1, firstPeriodId);
    const [next] = await db.select().from(ledgerPeriods).where(eq(ledgerPeriods.id, nextPeriodId));
    expect(next.periodStart).toBe(monthStart(0));
    // No more entries into the locked month, even via SQL.
    await expectDbRejects(
      db.execute(sql`update ledger_entries set description = 'x' where period_id = ${firstPeriodId}`),
      /SILIKA/,
    );
  });

  it("generates the LAPAN from the ledger, snapshots it, and routes it via the matrix", async () => {
    const period = (await db.select().from(ledgerPeriods).where(eq(ledgerPeriods.id, firstPeriodId)))[0];
    const live = await computePeriodLapan(db, org.bdls["BDL-001"], period);
    // opening −2.000.000.000; +425 −500 +120 −30 (juta) = +15.000.000
    expect(live.result.totals.openingNetAssets).toBe("-2000000000.00");
    expect(live.result.totals.totalChanges).toBe("15000000.00");
    expect(live.result.checks.every((c) => c.ok)).toBe(true);

    const { documentId, versionNo } = await generateLapan(pic1, firstPeriodId);
    expect(versionNo).toBe(1);
    const again = await generateLapan(pic1, firstPeriodId);
    expect(again.versionNo).toBe(2);
    const { snapshot, version } = await loadLapanSnapshot(db, documentId);
    expect(snapshot?.result.totals.closingNetAssets).toBe("-1985000000.00");
    expect(version?.sha256).toMatch(/^[0-9a-f]{64}$/);

    await submitLapan(pic1, firstPeriodId);
    const s = await pendingStep(documentId);
    expect((s.request.resolutionContext as { rule: { code: string } }).rule.code).toBe("LAPAN_DEFAULT");
    expect((await listInbox(db, katim1)).map((r) => r.document.id)).toContain(documentId);
    expect(await listInbox(db, katim2)).toHaveLength(0);
    await expect(actOnStep(katim1, s.step.id, { decision: "RETURN" })).rejects.toThrow(/Catatan wajib/);
    await approve(documentId, katim1);
    await approve(documentId, kadiv1);

    const [p] = await db.select().from(ledgerPeriods).where(eq(ledgerPeriods.id, firstPeriodId));
    expect(p.status).toBe("APPROVED");
    const [d] = await db.select().from(documents).where(eq(documents.id, documentId));
    expect(d.status).toBe("LOCKED");
    await expect(generateLapan(pic1, firstPeriodId)).rejects.toThrow(/sudah disetujui/);
    await expectDbRejects(
      db.execute(
        sql`insert into document_versions (document_id, version_no, content_json, sha256, created_by) values (${documentId}, 9, '{}', 'x', ${pic1.user.id})`,
      ),
      /LOCKED/,
    );
  });

  it("corrections of a locked period go through an approved request into the open period", async () => {
    const reqId = await requestCorrection(pic1, {
      targetPeriodId: firstPeriodId,
      reason: "Biaya notaris bulan lalu belum tercatat",
    });
    const crDoc = await docOf(b1, "KOREKSI_PERIODE");
    const input = {
      bdlId: b1,
      transactionTypeCode: "BIAYA_LIKUIDASI",
      transactionDate: monthDay(-1, 20),
      description: "Biaya notaris (koreksi)",
      rawInputs: { amount: "5000000" },
      correctionRequestId: reqId,
      submit: true,
    };
    await expect(createEntry(tl1, input)).rejects.toThrow(/belum disetujui/);
    await approve(crDoc.id, katim1);
    await approve(crDoc.id, kadiv1);

    const corr = await createEntry(tl1, input);
    expect(corr.entryKind).toBe("CORRECTION");
    expect(corr.originPeriodId).toBe(firstPeriodId);
    await verifyEntry(pic1, corr.id);
    const lines = await db.select().from(ledgerPostingLines).where(eq(ledgerPostingLines.entryId, corr.id));
    expect(lines.map((l) => l.lapanLineCode)).toEqual(["KOREKSI_PERIODE_LALU"]);

    // Reversal within the open period needs no correction request.
    const orig = await createEntry(tl1, {
      bdlId: b1,
      transactionTypeCode: "PENDAPATAN_LAIN",
      transactionDate: monthDay(0, 1),
      description: "Bunga",
      rawInputs: { amount: "1000000" },
      submit: true,
    });
    await verifyEntry(pic1, orig.id);
    const rev = await reverseEntry(tl1, orig.id, { reason: "salah catat" });
    await verifyEntry(pic1, rev.id);
    await expect(reverseEntry(tl1, orig.id, { reason: "lagi" })).rejects.toThrow(/sudah memiliki reversal/);

    const open = (await getOpenPeriod(db, b1))!;
    const lapan = await computePeriodLapan(db, org.bdls["BDL-001"], open);
    expect(lapan.result.totals.openingNetAssets).toBe("-1985000000.00");
    expect(lapan.result.changes.find((c) => c.code === "KOREKSI_PERIODE_LALU")?.amount).toBe("-5000000.00");
    expect(lapan.result.changes.find((c) => c.code === "PENDAPATAN_LAIN")?.amount).toBe("0.00");
  });

  it("LANIR from an approved period becomes the next LANAP after the (≤ Rp200 M) chain", async () => {
    await issueLanir(pic1, firstPeriodId);
    const lanirDoc = await docOf(b1, "LANIR");
    const s = await pendingStep(lanirDoc.id);
    expect((s.request.resolutionContext as { rule: { code: string } }).rule.code).toBe("LANIR_BAWAH_KAP");
    await approve(lanirDoc.id, katim1);
    await approve(lanirDoc.id, kadiv1);
    await expect(approve(lanirDoc.id, katim1)).rejects.toBeInstanceOf(ForbiddenError); // Direktur step is GLOBAL-only
    await approve(lanirDoc.id, direktur);

    const lanaps = await db
      .select()
      .from(netAssetStatements)
      .where(and(eq(netAssetStatements.bdlId, b1), eq(netAssetStatements.kind, "LANAP")))
      .orderBy(netAssetStatements.asOfDate);
    expect(lanaps).toHaveLength(2);
    expect(lanaps[1]).toMatchObject({ status: "LOCKED", asOfDate: addDays(monthStart(0), -1) });
    const lines = await db
      .select()
      .from(netAssetStatementLines)
      .where(eq(netAssetStatementLines.statementId, lanaps[1].id));
    expect(Object.fromEntries(lines.map((l) => [l.accountCode, l.amount]))).toMatchObject({
      KAS: "1395000000.00",
      KREDIT: "4500000000.00",
      PPAP_KREDIT: "1880000000.00",
    });

    // The open period now rolls forward from the derived LANAP — same opening as before.
    const open = (await getOpenPeriod(db, b1))!;
    const lapan = await computePeriodLapan(db, org.bdls["BDL-001"], open);
    expect(lapan.baseline.statementId).toBe(lanaps[1].id);
    expect(lapan.result.totals.openingNetAssets).toBe("-1985000000.00");
  });

  it("BDL above the Rp200 M threshold (grade C) requires the KAP gate", async () => {
    const b3 = org.bdls["BDL-003"].id;
    const s3 = await saveLanapDraft(pic2, {
      bdlId: b3,
      asOfDate: addDays(monthStart(0), -1),
      amounts: { KAS: "10000000000", KEWAJIBAN_LPS: "20000000000" },
    });
    await submitLanap(pic2, s3.id);
    const doc = await docOf(b3, "LANAP");
    const s = await pendingStep(doc.id);
    expect(s.step.gateCode).toBe("KAP_AUDIT_ATTACHED");
    expect((s.request.resolutionContext as { requiresKapAudit: boolean }).requiresKapAudit).toBe(true);
    await expect(actOnStep(pic2, s.step.id, { decision: "APPROVE" })).rejects.toThrow(/audit KAP wajib/);
    await approve(doc.id, pic2, { gateEvidence: "LAI-KAP/2026/77" });
    // Submitter (PIC) may confirm the gate but not the hierarchical sign-offs; Katim D2 takes step 2.
    expect((await pendingStep(doc.id)).step.requiredRole).toBe("KATIM");
    const [d] = await db.select().from(documents).where(eq(documents.id, doc.id));
    expect(d.metadata).toMatchObject({ kapAuditRef: "LAI-KAP/2026/77" });
  });

  it("dashboard lists only BDLs in the user's scope", async () => {
    expect((await listCases(db, tl1)).map((c) => c.code)).toEqual(["BDL-001"]);
    expect((await listCases(db, pic1)).map((c) => c.code)).toEqual(["BDL-001", "BDL-002"]);
    expect((await listCases(db, direktur)).map((c) => c.code)).toEqual(["BDL-001", "BDL-002", "BDL-003", "BDL-004"]);
    expect(await listCases(db, await ctxFor("admin"))).toEqual([]);
  });
});
