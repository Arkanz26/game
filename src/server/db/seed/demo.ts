import { and, desc, eq } from "drizzle-orm";
import { db } from "../client";
import {
  approvalRequestSteps,
  approvalRequests,
  bdl,
  bdlStageHistory,
  divisions,
  documents,
  ledgerPeriods,
  liquidationTeamMembers,
  regulationArticles,
  userRoleAssignments,
  users,
} from "../schema";
import { hashPassword } from "@/server/auth/password";
import { loadAuthContext } from "@/server/auth/context";
import type { AuthContext } from "@/server/rbac/authorize";
import type { Role } from "@/server/rbac/permissions";
import { addDays, endOfMonth, todayWib, type IsoDate } from "@/lib/dates";
import { createEntry, verifyEntry, type CreateEntryInput } from "@/server/modules/ledger/entry.service";
import { lockPeriod, getOpenPeriod } from "@/server/modules/ledger/period.service";
import { requestCorrection } from "@/server/modules/ledger/correction.service";
import { generateLapan, submitLapan } from "@/server/modules/reporting/lapan.service";
import { issueLanir, saveLanapDraft, submitLanap } from "@/server/modules/reporting/statement.service";
import { actOnStep } from "@/server/modules/approval/workflow.service";

export const DEMO_PASSWORD = "Silika#Dev2026";

type UserKey =
  | "tl1"
  | "tl2"
  | "tl3"
  | "pic1"
  | "pic2"
  | "katim1"
  | "katim2"
  | "kadiv1"
  | "kadiv2"
  | "direktur"
  | "adk"
  | "admin"
  | "auditor";

/** Divisions, users, role assignments, BDLs and TL membership. */
export async function seedOrganisation() {
  const [d1, d2] = await db
    .insert(divisions)
    .values([
      { code: "DLB1", name: "Divisi Pelaksanaan Likuidasi Bank I" },
      { code: "DLB2", name: "Divisi Pelaksanaan Likuidasi Bank II" },
    ])
    .returning();

  const bdls = await db
    .insert(bdl)
    .values([
      {
        code: "BDL-001",
        name: "PT BPR Maju Sejahtera (DL)",
        bankClass: "BPR",
        bankType: "KONVENSIONAL",
        grade: "B",
        hasSeparatistCreditor: false,
        insuredDepositsAmount: "85400000000.00",
        lifecycleStage: "OPERASIONAL",
        divisionId: d1.id,
        licenseRevokedDate: "2025-11-14",
        liquidationStartDate: "2025-11-14",
        city: "Bandung",
      },
      {
        code: "BDL-002",
        name: "PT BPRS Amanah Ummah (DL)",
        bankClass: "BPRS",
        bankType: "SYARIAH",
        grade: "A",
        hasSeparatistCreditor: true,
        insuredDepositsAmount: "42750000000.00",
        lifecycleStage: "OPERASIONAL",
        divisionId: d1.id,
        licenseRevokedDate: "2025-12-05",
        liquidationStartDate: "2025-12-05",
        city: "Bogor",
      },
      {
        code: "BDL-003",
        name: "PT Bank Nusantara Niaga (DL)",
        bankClass: "BU",
        bankType: "KONVENSIONAL",
        grade: "C",
        hasSeparatistCreditor: true,
        insuredDepositsAmount: "1215000000000.00",
        lifecycleStage: "OPERASIONAL",
        divisionId: d2.id,
        licenseRevokedDate: "2026-02-20",
        liquidationStartDate: "2026-02-20",
        city: "Jakarta",
      },
      {
        code: "BDL-004",
        name: "PT BPR Karya Tani (DL)",
        bankClass: "BPR",
        bankType: "KONVENSIONAL",
        grade: "A",
        hasSeparatistCreditor: false,
        insuredDepositsAmount: "12300000000.00",
        lifecycleStage: "PENGAMANAN_ASET",
        divisionId: d2.id,
        licenseRevokedDate: "2026-08-28",
        liquidationStartDate: "2026-08-28",
        city: "Klaten",
      },
    ])
    .returning();
  const B = Object.fromEntries(bdls.map((b) => [b.code, b])) as Record<string, (typeof bdls)[number]>;

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const people: {
    key: UserKey;
    name: string;
    divisionId: string | null;
    roles: { role: Role; scope: "GLOBAL" | "DIVISION" | "BDL"; target?: string }[];
  }[] = [
    {
      key: "tl1",
      name: "Budi Santoso",
      divisionId: null,
      roles: [{ role: "TL", scope: "BDL", target: B["BDL-001"].id }],
    },
    {
      key: "tl2",
      name: "Siti Rahmawati",
      divisionId: null,
      roles: [{ role: "TL", scope: "BDL", target: B["BDL-002"].id }],
    },
    {
      key: "tl3",
      name: "Andi Wijaya",
      divisionId: null,
      roles: [{ role: "TL", scope: "BDL", target: B["BDL-003"].id }],
    },
    {
      key: "pic1",
      name: "Rina Kusuma",
      divisionId: d1.id,
      roles: [
        { role: "PIC_GLIB", scope: "BDL", target: B["BDL-001"].id },
        { role: "PIC_GLIB", scope: "BDL", target: B["BDL-002"].id },
      ],
    },
    {
      key: "pic2",
      name: "Dimas Pratama",
      divisionId: d2.id,
      roles: [
        { role: "PIC_GLIB", scope: "BDL", target: B["BDL-003"].id },
        { role: "PIC_GLIB", scope: "BDL", target: B["BDL-004"].id },
      ],
    },
    {
      key: "katim1",
      name: "Hendra Gunawan",
      divisionId: d1.id,
      roles: [{ role: "KATIM", scope: "DIVISION", target: d1.id }],
    },
    {
      key: "katim2",
      name: "Maya Sari",
      divisionId: d2.id,
      roles: [{ role: "KATIM", scope: "DIVISION", target: d2.id }],
    },
    {
      key: "kadiv1",
      name: "Agus Salim",
      divisionId: d1.id,
      roles: [{ role: "KADIV", scope: "DIVISION", target: d1.id }],
    },
    {
      key: "kadiv2",
      name: "Lestari Wulandari",
      divisionId: d2.id,
      roles: [{ role: "KADIV", scope: "DIVISION", target: d2.id }],
    },
    {
      key: "direktur",
      name: "Bambang Hartono",
      divisionId: null,
      roles: [{ role: "DIREKTUR_GROUP", scope: "GLOBAL" }],
    },
    { key: "adk", name: "Dewi Anggraini", divisionId: null, roles: [{ role: "ADK", scope: "GLOBAL" }] },
    { key: "admin", name: "Administrator Sistem", divisionId: null, roles: [{ role: "ADMIN", scope: "GLOBAL" }] },
    { key: "auditor", name: "Auditor Internal", divisionId: null, roles: [{ role: "AUDITOR", scope: "GLOBAL" }] },
  ];
  const userIds = {} as Record<UserKey, string>;
  for (const p of people) {
    const [u] = await db
      .insert(users)
      .values({
        email: `${p.key}@silika.local`,
        name: p.name,
        passwordHash,
        divisionId: p.divisionId,
        nip: `DEMO-${p.key.toUpperCase()}`,
      })
      .returning();
    userIds[p.key] = u.id;
    await db.insert(userRoleAssignments).values(
      p.roles.map((r) => ({
        userId: u.id,
        role: r.role,
        scopeType: r.scope,
        divisionId: r.scope === "DIVISION" ? r.target! : null,
        bdlId: r.scope === "BDL" ? r.target! : null,
        validFrom: "2025-01-01",
      })),
    );
  }

  const [deathArticle] = await db
    .select()
    .from(regulationArticles)
    .where(eq(regulationArticles.articleRef, "17(1)(e)"));
  const [rudi] = await db
    .insert(liquidationTeamMembers)
    .values({
      bdlId: B["BDL-001"].id,
      fullName: "Rudi Setiawan",
      position: "ANGGOTA",
      appointedAt: "2025-11-14",
      decreeRef: "KEP-LPS/TL/2025/118",
      endedAt: "2026-03-02",
      endReason: "MENINGGAL",
      legalBasisArticleId: deathArticle?.id,
    })
    .returning();
  await db.insert(liquidationTeamMembers).values([
    {
      bdlId: B["BDL-001"].id,
      userId: userIds.tl1,
      fullName: "Budi Santoso",
      position: "KETUA",
      appointedAt: "2025-11-14",
      decreeRef: "KEP-LPS/TL/2025/118",
    },
    {
      bdlId: B["BDL-001"].id,
      fullName: "Yudi Hartanto",
      position: "ANGGOTA",
      appointedAt: "2026-03-16",
      decreeRef: "KEP-LPS/TL/2026/031",
      replacesMemberId: rudi.id,
      legalBasisArticleId: deathArticle?.id,
    },
    {
      bdlId: B["BDL-002"].id,
      userId: userIds.tl2,
      fullName: "Siti Rahmawati",
      position: "KETUA",
      appointedAt: "2025-12-05",
      decreeRef: "KEP-LPS/TL/2025/131",
    },
    {
      bdlId: B["BDL-003"].id,
      userId: userIds.tl3,
      fullName: "Andi Wijaya",
      position: "KETUA",
      appointedAt: "2026-02-20",
      decreeRef: "KEP-LPS/TL/2026/019",
    },
  ]);

  const stages: [string, string, string][] = [
    ["BDL-001", "PERSIAPAN", "2025-11-14"],
    ["BDL-001", "PENGAMANAN_ASET", "2025-11-15"],
    ["BDL-001", "PENUNJUKAN_TL", "2025-11-20"],
    ["BDL-001", "OPERASIONAL", "2025-12-01"],
    ["BDL-002", "PERSIAPAN", "2025-12-05"],
    ["BDL-002", "PENGAMANAN_ASET", "2025-12-06"],
    ["BDL-002", "PENUNJUKAN_TL", "2025-12-10"],
    ["BDL-002", "OPERASIONAL", "2026-01-02"],
    ["BDL-003", "PERSIAPAN", "2026-02-20"],
    ["BDL-003", "PENGAMANAN_ASET", "2026-02-21"],
    ["BDL-003", "PENUNJUKAN_TL", "2026-02-27"],
    ["BDL-003", "OPERASIONAL", "2026-03-16"],
    ["BDL-004", "PERSIAPAN", "2026-08-28"],
    ["BDL-004", "PENGAMANAN_ASET", "2026-08-29"],
  ];
  await db
    .insert(bdlStageHistory)
    .values(stages.map(([code, stage, enteredAt]) => ({ bdlId: B[code].id, stage: stage as "PERSIAPAN", enteredAt })));

  return { bdls: B, userIds, divisions: { d1, d2 } };
}

// ---------------------------------------------------------------------------
// Demo scenario — driven through the real services so every rule is respected.
// ---------------------------------------------------------------------------

function monthStart(offset: number, today: IsoDate): IsoDate {
  const [y, m] = today.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return d.toISOString().slice(0, 10);
}

/** Day `day` of the month starting at `start`, never later than today. */
function dayOf(start: IsoDate, day: number, today: IsoDate): IsoDate {
  const d = addDays(start, day - 1);
  const capped = d > endOfMonth(start) ? endOfMonth(start) : d;
  return capped > today ? today : capped;
}

async function latestDocumentId(bdlId: string, type: string): Promise<string> {
  const [doc] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.bdlId, bdlId), eq(documents.documentTypeCode, type)))
    .orderBy(desc(documents.createdAt))
    .limit(1);
  return doc.id;
}

async function approveThrough(documentId: string, actors: AuthContext[]) {
  for (const ctx of actors) {
    const [step] = await db
      .select({ id: approvalRequestSteps.id })
      .from(approvalRequestSteps)
      .innerJoin(approvalRequests, eq(approvalRequests.id, approvalRequestSteps.requestId))
      .where(and(eq(approvalRequests.documentId, documentId), eq(approvalRequestSteps.status, "PENDING")));
    if (!step) throw new Error("Tidak ada langkah persetujuan yang menunggu");
    await actOnStep(ctx, step.id, { decision: "APPROVE", comment: "Sesuai." });
  }
}

async function postVerified(maker: AuthContext, checker: AuthContext, entries: Omit<CreateEntryInput, "submit">[]) {
  for (const e of entries) {
    const created = await createEntry(maker, { ...e, submit: true });
    await verifyEntry(checker, created.id);
  }
}

async function closeMonth(
  bdlId: string,
  start: IsoDate,
  pic: AuthContext,
  approvers: AuthContext[] | null,
): Promise<string> {
  const [period] = await db
    .select()
    .from(ledgerPeriods)
    .where(and(eq(ledgerPeriods.bdlId, bdlId), eq(ledgerPeriods.periodStart, start)));
  await lockPeriod(pic, period.id);
  const { documentId } = await generateLapan(pic, period.id);
  if (approvers) {
    await submitLapan(pic, period.id);
    await approveThrough(documentId, approvers);
  }
  return period.id;
}

export async function seedDemoScenario(org: Awaited<ReturnType<typeof seedOrganisation>>) {
  const today = todayWib();
  const ctx = {} as Record<UserKey, AuthContext>;
  for (const [key, id] of Object.entries(org.userIds) as [UserKey, string][]) {
    const [u] = await db.select().from(users).where(eq(users.id, id));
    ctx[key] = await loadAuthContext(
      { id: u.id, name: u.name, email: u.email, divisionId: u.divisionId },
      { requestId: "seed" },
    );
  }
  const B = org.bdls;
  const m = (offset: number) => monthStart(offset, today);
  const d = (offset: number, day: number) => dayOf(m(offset), day, today);

  // ---- BDL-001: grade B, 4 months of history -----------------------------------------
  const b1 = B["BDL-001"].id;
  const lanap1 = await saveLanapDraft(ctx.pic1, {
    bdlId: b1,
    asOfDate: addDays(m(-3), -1),
    amounts: {
      KAS: "2350000000",
      PENEMPATAN: "1500000000",
      KREDIT: "18750000000",
      PPAP_KREDIT: "9200000000",
      AYDA: "3400000000",
      ASET_TETAP: "2100000000",
      ASET_LAIN: "450000000",
      KEWAJIBAN_LPS: "71200000000",
      KEWAJIBAN_SIMPANAN: "4800000000",
      KEWAJIBAN_LAIN: "1300000000",
    },
  });
  await submitLanap(ctx.pic1, lanap1.id);
  await approveThrough(await latestDocumentId(b1, "LANAP"), [ctx.katim1, ctx.kadiv1]);

  await postVerified(ctx.tl1, ctx.pic1, [
    {
      bdlId: b1,
      transactionTypeCode: "PENAGIHAN_PIUTANG",
      transactionDate: d(-3, 6),
      description: "Pelunasan kredit a.n. CV Sumber Rejeki",
      counterpartyName: "CV Sumber Rejeki",
      evidenceRef: "BKM-001/TL-MS",
      rawInputs: { cash_received: "425000000", gross_reduction: "500000000", ppap_release: "120000000" },
    },
    {
      bdlId: b1,
      transactionTypeCode: "BIAYA_LIKUIDASI",
      transactionDate: d(-3, 10),
      description: "Biaya pengamanan dan sewa kantor",
      evidenceRef: "BKK-004/TL-MS",
      rawInputs: { amount: "38500000" },
    },
    {
      bdlId: b1,
      transactionTypeCode: "PENCAIRAN_ASET",
      transactionDate: d(-3, 22),
      description: "Penjualan kendaraan operasional (lelang KPKNL)",
      counterpartyName: "Pemenang lelang KPKNL Bandung",
      assetRef: "AT-KEND-07",
      evidenceRef: "Risalah Lelang 112/2026",
      rawInputs: { asset_account: "ASET_TETAP", cash_received: "182000000", book_value: "150000000" },
    },
    {
      bdlId: b1,
      transactionTypeCode: "INSENTIF_TL",
      transactionDate: d(-3, 28),
      description: "Honorarium Tim Likuidasi",
      counterpartyName: "Tim Likuidasi BPR Maju Sejahtera",
      rawInputs: { amount: "96000000" },
    },
  ]);
  await closeMonth(b1, m(-3), ctx.pic1, [ctx.katim1, ctx.kadiv1]);

  await postVerified(ctx.tl1, ctx.pic1, [
    {
      bdlId: b1,
      transactionTypeCode: "PENAGIHAN_PIUTANG",
      transactionDate: d(-2, 4),
      description: "Angsuran debitur kelompok UMKM",
      counterpartyName: "Debitur UMKM (rekap)",
      rawInputs: { cash_received: "312500000", gross_reduction: "340000000", ppap_release: "40000000" },
    },
    {
      bdlId: b1,
      transactionTypeCode: "PEMBAYARAN_KEWAJIBAN",
      transactionDate: d(-2, 15),
      description: "Pembayaran tahap I kepada LPS atas subrogasi simpanan",
      counterpartyName: "Lembaga Penjamin Simpanan",
      rawInputs: { liability_account: "KEWAJIBAN_LPS", amount: "2000000000" },
    },
    {
      bdlId: b1,
      transactionTypeCode: "PENDAPATAN_LAIN",
      transactionDate: d(-2, 30),
      description: "Bunga penempatan deposito",
      rawInputs: { amount: "7850000" },
    },
  ]);
  await closeMonth(b1, m(-2), ctx.pic1, [ctx.katim1]); // waiting for Kadiv

  await postVerified(ctx.tl1, ctx.pic1, [
    {
      bdlId: b1,
      transactionTypeCode: "PENCAIRAN_ASET",
      transactionDate: d(-1, 9),
      description: "Penjualan AYDA tanah dan bangunan Jl. Soekarno-Hatta",
      counterpartyName: "PT Graha Properti",
      assetRef: "AYDA-015",
      evidenceRef: "AJB 45/2026",
      rawInputs: { asset_account: "AYDA", cash_received: "1250000000", book_value: "1400000000" },
    },
    {
      bdlId: b1,
      transactionTypeCode: "BIAYA_LIKUIDASI",
      transactionDate: d(-1, 18),
      description: "Biaya jasa penilai (KJPP)",
      rawInputs: { amount: "27500000" },
    },
  ]);
  await closeMonth(b1, m(-1), ctx.pic1, null); // LAPAN generated, not yet submitted

  await createEntry(ctx.tl1, {
    bdlId: b1,
    transactionTypeCode: "PENAGIHAN_PIUTANG",
    transactionDate: d(0, 3),
    description: "Pelunasan kredit a.n. Toko Makmur Jaya",
    counterpartyName: "Toko Makmur Jaya",
    rawInputs: { cash_received: "96000000", gross_reduction: "110000000", ppap_release: "25000000" },
    submit: true,
  });
  await createEntry(ctx.tl1, {
    bdlId: b1,
    transactionTypeCode: "BIAYA_LIKUIDASI",
    transactionDate: d(0, 5),
    description: "Biaya listrik & keamanan kantor pusat",
    rawInputs: { amount: "14250000" },
    submit: true,
  });
  await createEntry(ctx.tl1, {
    bdlId: b1,
    transactionTypeCode: "PENDAPATAN_LAIN",
    transactionDate: d(0, 8),
    description: "Pendapatan sewa ruang ATM",
    rawInputs: { amount: "4500000" },
  });

  // ---- BDL-002: syariah + kreditur separatis; LAPAN → LANIR → LANAP, correction ---------
  const b2 = B["BDL-002"].id;
  const lanap2 = await saveLanapDraft(ctx.pic1, {
    bdlId: b2,
    asOfDate: addDays(m(-1), -1),
    amounts: {
      KAS: "780000000",
      KREDIT: "9650000000",
      PPAP_KREDIT: "4100000000",
      AYDA: "2250000000",
      ASET_TETAP: "640000000",
      KEWAJIBAN_LPS: "38900000000",
      KEWAJIBAN_SEPARATIS: "1800000000",
      KEWAJIBAN_LAIN: "420000000",
    },
  });
  await submitLanap(ctx.pic1, lanap2.id);
  await approveThrough(await latestDocumentId(b2, "LANAP"), [ctx.katim1, ctx.kadiv1]);
  await postVerified(ctx.tl2, ctx.pic1, [
    {
      bdlId: b2,
      transactionTypeCode: "PENYERAHAN_ASET_SEPARATIS",
      transactionDate: d(-1, 7),
      description: "Penyerahan AYDA ruko kepada kreditur separatis (hak tanggungan)",
      counterpartyName: "PT Bank Syariah Mitra",
      assetRef: "AYDA-003",
      rawInputs: { asset_account: "AYDA", book_value: "900000000", claim_settled: "950000000" },
    },
    {
      bdlId: b2,
      transactionTypeCode: "PENAGIHAN_PIUTANG",
      transactionDate: d(-1, 14),
      description: "Pelunasan pembiayaan murabahah",
      counterpartyName: "Koperasi Tani Makmur",
      rawInputs: { cash_received: "215000000", gross_reduction: "260000000", ppap_release: "60000000" },
    },
  ]);
  const p2 = await closeMonth(b2, m(-1), ctx.pic1, [ctx.katim1, ctx.kadiv1]);
  await issueLanir(ctx.pic1, p2);
  await approveThrough(await latestDocumentId(b2, "LANIR"), [ctx.katim1, ctx.kadiv1, ctx.direktur]);

  // Correction of the locked month: approved request, correction entry awaiting verification.
  const crId = await requestCorrection(ctx.pic1, {
    targetPeriodId: p2,
    reason: "Biaya notaris penyerahan aset separatis belum tercatat pada bulan berjalan",
  });
  await approveThrough(await latestDocumentId(b2, "KOREKSI_PERIODE"), [ctx.katim1, ctx.kadiv1]);
  await createEntry(ctx.tl2, {
    bdlId: b2,
    transactionTypeCode: "BIAYA_LIKUIDASI",
    transactionDate: d(-1, 7),
    description: "Biaya notaris penyerahan AYDA-003 (koreksi)",
    correctionRequestId: crId,
    rawInputs: { amount: "6500000" },
    submit: true,
  });

  // ---- BDL-003: grade C, simpanan terjamin > Rp200 M → LANAP menunggu audit KAP -----------
  const lanap3 = await saveLanapDraft(ctx.pic2, {
    bdlId: B["BDL-003"].id,
    asOfDate: addDays(m(0), -1),
    amounts: {
      KAS: "48500000000",
      PENEMPATAN: "125000000000",
      KREDIT: "812000000000",
      PPAP_KREDIT: "402000000000",
      AYDA: "96000000000",
      ASET_TETAP: "54000000000",
      ASET_LAIN: "12500000000",
      KEWAJIBAN_LPS: "1180000000000",
      KEWAJIBAN_SIMPANAN: "215000000000",
      KEWAJIBAN_SEPARATIS: "88000000000",
      KEWAJIBAN_LAIN: "36000000000",
    },
  });
  await submitLanap(ctx.pic2, lanap3.id);

  // BDL-004 stays in asset-securing stage with no baseline yet.
  const open1 = await getOpenPeriod(db, b1);
  return { openPeriodBdl1: open1?.id };
}
