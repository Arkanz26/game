import type { Executor } from "../client";
import {
  accounts,
  approvalChainSteps,
  approvalChainTemplates,
  approvalMatrixRules,
  documentTypes,
  lapanLineItems,
  regulationArticles,
  regulations,
  rolePermissions,
  systemParameters,
  transactionTypes,
} from "../schema";
import type { TransactionInputField, PostingRule } from "../schema/ledger";
import { DEFAULT_ROLE_PERMISSIONS, type Role } from "@/server/rbac/permissions";

const FROM = "2020-01-01";

/**
 * Reference configuration: permissions, document types, chart of accounts, LAPAN format,
 * transaction types, approval chains/matrix, parameters and a sample regulatory corpus.
 * Everything here is data — adjust it (as new versions) rather than changing code.
 */
export async function seedReference(db: Executor) {
  await db
    .insert(rolePermissions)
    .values(
      Object.entries(DEFAULT_ROLE_PERMISSIONS).flatMap(([role, perms]) =>
        perms.map((permission) => ({ role: role as Role, permission })),
      ),
    );

  // --- Regulatory corpus (sample; replace with the official corpus) -------------------
  const [uuLps] = await db
    .insert(regulations)
    .values({
      type: "UU",
      number: "24 Tahun 2004 jo. UU 4 Tahun 2023",
      title: "Lembaga Penjamin Simpanan (sebagaimana diubah dengan UU P2SK)",
      effectiveFrom: "2004-09-22",
      note: "Contoh data awal — [perlu verifikasi] terhadap corpus resmi",
    })
    .returning();
  const [plps] = await db
    .insert(regulations)
    .values({
      type: "PLPS",
      number: "[perlu verifikasi]",
      title: "Peraturan LPS tentang Likuidasi Bank",
      effectiveFrom: FROM,
      note: "Placeholder: nomor dan isi pasal harus diverifikasi Divisi Hukum",
    })
    .returning();
  const [padk] = await db
    .insert(regulations)
    .values({
      type: "PADK",
      number: "[perlu verifikasi]",
      title: "Peraturan ADK tentang Tata Cara Pelaporan dan Persetujuan Laporan Tim Likuidasi",
      effectiveFrom: FROM,
      note: "Placeholder",
    })
    .returning();
  const articles = await db
    .insert(regulationArticles)
    .values([
      {
        regulationId: uuLps.id,
        articleRef: "43",
        heading: "Likuidasi bank",
        body: "Ketentuan umum pelaksanaan likuidasi bank oleh LPS. [perlu verifikasi]",
        effectiveFrom: "2004-09-22",
      },
      {
        regulationId: plps.id,
        articleRef: "17(1)(e)",
        heading: "Pemberhentian anggota TL karena meninggal dunia",
        body: "Anggota Tim Likuidasi berhenti karena meninggal dunia. [perlu verifikasi]",
        effectiveFrom: FROM,
      },
      {
        regulationId: plps.id,
        articleRef: "26(3)",
        heading: "Rotasi anggota TL antar-BDL",
        body: "Penggantian anggota Tim Likuidasi karena rotasi penugasan antar bank dalam likuidasi. [perlu verifikasi]",
        effectiveFrom: FROM,
      },
      {
        regulationId: plps.id,
        articleRef: "26(4)",
        heading: "Kontinuitas honorarium pengganti",
        body: "Honorarium dasar anggota pengganti mengikuti anggota yang digantikan. [perlu verifikasi]",
        effectiveFrom: FROM,
      },
      {
        regulationId: padk.id,
        articleRef: "10",
        heading: "Laporan perubahan aset neto bulanan",
        body: "Tim Likuidasi menyampaikan LAPAN setiap bulan kepada LPS. [perlu verifikasi]",
        effectiveFrom: FROM,
      },
      {
        regulationId: padk.id,
        articleRef: "12",
        heading: "Audit KAP",
        body: "Laporan BDL dengan simpanan layak bayar di atas Rp200 miliar wajib diaudit KAP sebelum disetujui LPS. [perlu verifikasi]",
        effectiveFrom: FROM,
      },
    ])
    .returning();
  const art = (ref: string) => articles.find((a) => a.articleRef === ref)!.id;

  // --- Document types ------------------------------------------------------------------
  await db.insert(documentTypes).values([
    { code: "LK_CIU", name: "Laporan Keuangan per Tanggal CIU", requiresApproval: true, locksOnApproval: true },
    {
      code: "LANAP",
      name: "Laporan Aset Neto Awal Periode",
      requiresApproval: true,
      locksOnApproval: true,
      isGenerated: true,
    },
    {
      code: "LAPAN",
      name: "Laporan Perubahan Aset Neto",
      requiresApproval: true,
      locksOnApproval: true,
      isGenerated: true,
    },
    {
      code: "LANIR",
      name: "Laporan Aset Neto Akhir Periode",
      requiresApproval: true,
      locksOnApproval: true,
      isGenerated: true,
    },
    { code: "EVAP", name: "Evaluasi Pelaksanaan Pemberesan", requiresApproval: true, locksOnApproval: true },
    { code: "NERACA_PENUTUPAN", name: "Neraca Penutupan", requiresApproval: true, locksOnApproval: true },
    { code: "BA_PENGAMANAN_ASET", name: "Berita Acara Pengamanan Aset", requiresApproval: false },
    { code: "LEGAL", name: "Dokumen Legal", requiresApproval: false },
    { code: "NOTA_DINAS", name: "Nota Dinas", requiresApproval: true },
    { code: "KEPUTUSAN_ADK", name: "Keputusan ADK", requiresApproval: true, locksOnApproval: true },
    { code: "KOREKSI_PERIODE", name: "Permohonan Koreksi Periode Terkunci", requiresApproval: true, isGenerated: true },
  ]);

  // --- Chart of accounts ---------------------------------------------------------------
  await db.insert(accounts).values(
    [
      { code: "KAS", name: "Kas dan Setara Kas", accountClass: "ASSET" as const },
      { code: "PENEMPATAN", name: "Penempatan pada Bank Lain", accountClass: "ASSET" as const },
      {
        code: "KREDIT",
        name: "Kredit yang Diberikan",
        accountClass: "ASSET" as const,
        labelOverrides: { SYARIAH: "Pembiayaan yang Diberikan" },
      },
      {
        code: "PPAP_KREDIT",
        name: "PPAP Kredit",
        accountClass: "CONTRA_ASSET" as const,
        ppapOfCode: "KREDIT",
        labelOverrides: { SYARIAH: "PPAP Pembiayaan" },
      },
      { code: "AYDA", name: "Agunan yang Diambil Alih", accountClass: "ASSET" as const },
      { code: "ASET_TETAP", name: "Aset Tetap", accountClass: "ASSET" as const },
      { code: "ASET_LAIN", name: "Aset Lain-lain", accountClass: "ASSET" as const },
      { code: "KEWAJIBAN_LPS", name: "Kewajiban kepada LPS (Subrogasi Simpanan)", accountClass: "LIABILITY" as const },
      { code: "KEWAJIBAN_SIMPANAN", name: "Simpanan Tidak Dijamin", accountClass: "LIABILITY" as const },
      { code: "KEWAJIBAN_SEPARATIS", name: "Kewajiban kepada Kreditur Separatis", accountClass: "LIABILITY" as const },
      { code: "KEWAJIBAN_LAIN", name: "Kewajiban Lain-lain", accountClass: "LIABILITY" as const },
    ].map((a, i) => ({ ...a, sortOrder: (i + 1) * 10, effectiveFrom: FROM })),
  );

  // --- LAPAN line items ----------------------------------------------------------------
  await db.insert(lapanLineItems).values(
    [
      {
        code: "PENERIMAAN_PENAGIHAN",
        name: "Penerimaan dari penagihan kredit/piutang",
        section: "PENAMBAHAN" as const,
      },
      { code: "PENERIMAAN_PENCAIRAN_ASET", name: "Penerimaan dari pencairan aset", section: "PENAMBAHAN" as const },
      { code: "PENDAPATAN_LAIN", name: "Pendapatan lain-lain", section: "PENAMBAHAN" as const },
      { code: "PENYELESAIAN_KEWAJIBAN", name: "Penurunan kewajiban karena pembayaran", section: "PENAMBAHAN" as const },
      {
        code: "PENYELESAIAN_KEWAJIBAN_SEPARATIS",
        name: "Penyelesaian kewajiban kreditur separatis",
        section: "PENAMBAHAN" as const,
      },
      {
        code: "PELEPASAN_NILAI_BUKU",
        name: "Pelepasan nilai buku aset yang direalisasi",
        section: "PENGURANGAN" as const,
      },
      {
        code: "PENYERAHAN_ASET_SEPARATIS",
        name: "Aset diserahkan/dieksekusi kreditur separatis",
        section: "PENGURANGAN" as const,
      },
      {
        code: "PEMBAYARAN_KEWAJIBAN",
        name: "Pengeluaran kas untuk pembayaran kewajiban",
        section: "PENGURANGAN" as const,
      },
      { code: "BIAYA_LIKUIDASI", name: "Biaya operasional likuidasi", section: "PENGURANGAN" as const },
      { code: "INSENTIF_TL", name: "Honorarium & insentif Tim Likuidasi", section: "PENGURANGAN" as const },
      { code: "KOREKSI_PERIODE_LALU", name: "Koreksi periode sebelumnya", section: "KOREKSI" as const },
    ].map((l, i) => ({ ...l, sortOrder: (i + 1) * 10, effectiveFrom: FROM })),
  );

  // --- Transaction types ---------------------------------------------------------------
  const money = (key: string, label: string, required = true, help?: string): TransactionInputField => ({
    key,
    label,
    kind: "money",
    required,
    help,
  });
  const account = (key: string, label: string, accountCodes: string[]): TransactionInputField => ({
    key,
    label,
    kind: "account",
    required: true,
    accountCodes,
  });
  const rule = (acc: PostingRule["account"], lapanLine: string, amountFrom: string, sign: 1 | -1): PostingRule => ({
    account: acc,
    lapanLine,
    amountFrom,
    sign,
  });

  await db.insert(transactionTypes).values(
    [
      {
        code: "PENAGIHAN_PIUTANG",
        name: "Penagihan Kredit/Piutang",
        description: "Penerimaan pembayaran dari debitur; mengurangi baki debet dan melepas PPAP terkait.",
        inputSchema: [
          money("cash_received", "Kas diterima"),
          money("gross_reduction", "Pengurangan baki debet (gross)"),
          money("ppap_release", "Pelepasan PPAP terkait", false),
        ],
        postingRules: [
          rule("KAS", "PENERIMAAN_PENAGIHAN", "cash_received", 1),
          rule("KREDIT", "PELEPASAN_NILAI_BUKU", "gross_reduction", -1),
          rule("PPAP_KREDIT", "PELEPASAN_NILAI_BUKU", "ppap_release", -1),
        ],
        primaryAmountField: "cash_received",
        requiresCounterparty: true,
        defaultCounterpartyType: "DEBITUR" as const,
      },
      {
        code: "PENCAIRAN_ASET",
        name: "Pencairan/Penjualan Aset",
        description: "Penjualan AYDA, aset tetap, aset lain, atau pencairan penempatan.",
        inputSchema: [
          account("asset_account", "Aset yang dicairkan", ["PENEMPATAN", "AYDA", "ASET_TETAP", "ASET_LAIN"]),
          money("cash_received", "Hasil pencairan diterima"),
          money("book_value", "Nilai buku aset"),
        ],
        postingRules: [
          rule("KAS", "PENERIMAAN_PENCAIRAN_ASET", "cash_received", 1),
          rule({ fromInput: "asset_account" }, "PELEPASAN_NILAI_BUKU", "book_value", -1),
        ],
        primaryAmountField: "cash_received",
        requiresCounterparty: true,
        defaultCounterpartyType: "PEMBELI" as const,
      },
      {
        code: "PENYERAHAN_ASET_SEPARATIS",
        name: "Penyerahan Aset kepada Kreditur Separatis",
        description: "Penyerahan aset yang dijaminkan untuk menyelesaikan tagihan kreditur separatis.",
        inputSchema: [
          account("asset_account", "Aset yang diserahkan", ["AYDA", "ASET_TETAP", "ASET_LAIN"]),
          money("book_value", "Nilai buku aset"),
          money("claim_settled", "Tagihan separatis yang diselesaikan"),
        ],
        postingRules: [
          rule({ fromInput: "asset_account" }, "PENYERAHAN_ASET_SEPARATIS", "book_value", -1),
          rule("KEWAJIBAN_SEPARATIS", "PENYELESAIAN_KEWAJIBAN_SEPARATIS", "claim_settled", -1),
        ],
        primaryAmountField: "book_value",
        requiresSeparatistCreditor: true,
        requiresCounterparty: true,
        defaultCounterpartyType: "KREDITUR_SEPARATIS" as const,
      },
      {
        code: "EKSEKUSI_AGUNAN_SEPARATIS",
        name: "Eksekusi Agunan oleh Kreditur Separatis",
        description: "Eksekusi agunan oleh kreditur separatis; sisa hasil eksekusi (jika ada) diterima BDL.",
        inputSchema: [
          account("asset_account", "Aset yang dieksekusi", ["AYDA", "ASET_TETAP"]),
          money("book_value", "Nilai buku aset"),
          money("claim_settled", "Tagihan separatis yang terlunasi"),
          money("excess_cash", "Sisa hasil eksekusi diterima BDL", false),
        ],
        postingRules: [
          rule({ fromInput: "asset_account" }, "PENYERAHAN_ASET_SEPARATIS", "book_value", -1),
          rule("KEWAJIBAN_SEPARATIS", "PENYELESAIAN_KEWAJIBAN_SEPARATIS", "claim_settled", -1),
          rule("KAS", "PENERIMAAN_PENCAIRAN_ASET", "excess_cash", 1),
        ],
        primaryAmountField: "book_value",
        requiresSeparatistCreditor: true,
        requiresCounterparty: true,
        defaultCounterpartyType: "KREDITUR_SEPARATIS" as const,
      },
      {
        code: "PEMBAYARAN_KEWAJIBAN",
        name: "Pembayaran Kewajiban",
        description: "Pembayaran kepada LPS (subrogasi), penyimpan tidak dijamin, atau kreditur lain.",
        inputSchema: [
          account("liability_account", "Kewajiban yang dibayar", [
            "KEWAJIBAN_LPS",
            "KEWAJIBAN_SIMPANAN",
            "KEWAJIBAN_LAIN",
          ]),
          money("amount", "Jumlah dibayar"),
        ],
        postingRules: [
          rule("KAS", "PEMBAYARAN_KEWAJIBAN", "amount", -1),
          rule({ fromInput: "liability_account" }, "PENYELESAIAN_KEWAJIBAN", "amount", -1),
        ],
        primaryAmountField: "amount",
        requiresCounterparty: true,
        defaultCounterpartyType: "KREDITUR" as const,
      },
      {
        code: "BIAYA_LIKUIDASI",
        name: "Biaya Operasional Likuidasi",
        inputSchema: [money("amount", "Jumlah biaya")],
        postingRules: [rule("KAS", "BIAYA_LIKUIDASI", "amount", -1)],
        primaryAmountField: "amount",
      },
      {
        code: "INSENTIF_TL",
        name: "Honorarium/Insentif Tim Likuidasi",
        inputSchema: [money("amount", "Jumlah dibayarkan")],
        postingRules: [rule("KAS", "INSENTIF_TL", "amount", -1)],
        primaryAmountField: "amount",
        requiresCounterparty: true,
        defaultCounterpartyType: "TIM_LIKUIDASI" as const,
      },
      {
        code: "PENDAPATAN_LAIN",
        name: "Pendapatan Lain-lain",
        description: "Bunga/bagi hasil penempatan, sewa, dan pendapatan lain.",
        inputSchema: [money("amount", "Jumlah diterima")],
        postingRules: [rule("KAS", "PENDAPATAN_LAIN", "amount", 1)],
        primaryAmountField: "amount",
      },
    ].map((t, i) => ({ ...t, sortOrder: (i + 1) * 10, effectiveFrom: FROM })),
  );

  // --- Approval chains -----------------------------------------------------------------
  type StepDef = {
    label: string;
    requiredRole: Role;
    scope?: "SAME_DIVISION" | "GLOBAL";
    isGate?: boolean;
    gateCode?: string;
    slaDays?: number;
  };
  const chains: { code: string; name: string; steps: StepDef[] }[] = [
    {
      code: "CHAIN_STANDAR",
      name: "Katim → Kadiv",
      steps: [
        { label: "Review Kepala Tim", requiredRole: "KATIM" },
        { label: "Persetujuan Kepala Divisi", requiredRole: "KADIV" },
      ],
    },
    {
      code: "CHAIN_DIREKTUR",
      name: "Katim → Kadiv → Direktur Group",
      steps: [
        { label: "Review Kepala Tim", requiredRole: "KATIM" },
        { label: "Review Kepala Divisi", requiredRole: "KADIV" },
        { label: "Persetujuan Direktur Group", requiredRole: "DIREKTUR_GROUP", scope: "GLOBAL" },
      ],
    },
    {
      code: "CHAIN_KAP",
      name: "Audit KAP → Katim → Kadiv → Direktur Group",
      steps: [
        {
          label: "Konfirmasi laporan audit KAP",
          requiredRole: "PIC_GLIB",
          isGate: true,
          gateCode: "KAP_AUDIT_ATTACHED",
          slaDays: 30,
        },
        { label: "Review Kepala Tim", requiredRole: "KATIM" },
        { label: "Review Kepala Divisi", requiredRole: "KADIV" },
        { label: "Persetujuan Direktur Group", requiredRole: "DIREKTUR_GROUP", scope: "GLOBAL" },
      ],
    },
  ];
  for (const c of chains) {
    const [tpl] = await db
      .insert(approvalChainTemplates)
      .values({ code: c.code, name: c.name, effectiveFrom: FROM })
      .returning();
    await db
      .insert(approvalChainSteps)
      .values(
        c.steps.map((s, i) => ({
          templateId: tpl.id,
          stepOrder: i + 1,
          label: s.label,
          requiredRole: s.requiredRole,
          scope: s.scope ?? ("SAME_DIVISION" as const),
          isGate: s.isGate ?? false,
          gateCode: s.gateCode ?? null,
          slaDays: s.slaDays ?? 5,
        })),
      );
  }

  // --- Parameters ----------------------------------------------------------------------
  await db.insert(systemParameters).values([
    {
      code: "KAP_AUDIT_THRESHOLD",
      value: { amount: "200000000000.00" },
      description: "Batas simpanan layak bayar: di atas nilai ini laporan wajib diaudit KAP sebelum disetujui LPS",
      regulationArticleId: art("12"),
      effectiveFrom: FROM,
    },
    {
      code: "CORRECTION_WINDOW_DAYS",
      value: 14,
      description: "Lama jendela pencatatan koreksi setelah permohonan koreksi disetujui (hari)",
      effectiveFrom: FROM,
    },
  ]);

  // --- Approval matrix (document_type × grade × threshold → chain) ---------------------
  const m = (
    r: Partial<typeof approvalMatrixRules.$inferInsert> & {
      code: string;
      documentTypeCode: string;
      chainTemplateCode: string;
    },
  ) => ({ effectiveFrom: FROM, ...r });
  await db
    .insert(approvalMatrixRules)
    .values([
      m({
        code: "LAPAN_DEFAULT",
        documentTypeCode: "LAPAN",
        chainTemplateCode: "CHAIN_STANDAR",
        regulationArticleId: art("10"),
        description: "LAPAN bulanan: Katim → Kadiv",
      }),
      m({
        code: "LAPAN_GRADE_C",
        documentTypeCode: "LAPAN",
        bdlGrade: "C",
        chainTemplateCode: "CHAIN_DIREKTUR",
        regulationArticleId: art("10"),
        description: "BDL grade C memerlukan persetujuan Direktur Group",
      }),
      m({
        code: "LANAP_BAWAH_KAP",
        documentTypeCode: "LANAP",
        thresholdParamKey: "KAP_AUDIT_THRESHOLD",
        thresholdParamSide: "AT_OR_BELOW",
        chainTemplateCode: "CHAIN_STANDAR",
        regulationArticleId: art("12"),
        description: "Simpanan terjamin ≤ Rp200 M: tanpa audit KAP",
      }),
      m({
        code: "LANAP_ATAS_KAP",
        documentTypeCode: "LANAP",
        thresholdParamKey: "KAP_AUDIT_THRESHOLD",
        thresholdParamSide: "ABOVE",
        requiresKapAudit: true,
        chainTemplateCode: "CHAIN_KAP",
        regulationArticleId: art("12"),
        description: "Simpanan terjamin > Rp200 M: wajib audit KAP",
      }),
      m({
        code: "LANIR_BAWAH_KAP",
        documentTypeCode: "LANIR",
        thresholdParamKey: "KAP_AUDIT_THRESHOLD",
        thresholdParamSide: "AT_OR_BELOW",
        chainTemplateCode: "CHAIN_DIREKTUR",
        regulationArticleId: art("12"),
        description: "LANIR ≤ Rp200 M: sampai Direktur Group",
      }),
      m({
        code: "LANIR_ATAS_KAP",
        documentTypeCode: "LANIR",
        thresholdParamKey: "KAP_AUDIT_THRESHOLD",
        thresholdParamSide: "ABOVE",
        requiresKapAudit: true,
        chainTemplateCode: "CHAIN_KAP",
        regulationArticleId: art("12"),
        description: "LANIR > Rp200 M: wajib audit KAP",
      }),
      m({
        code: "KOREKSI_DEFAULT",
        documentTypeCode: "KOREKSI_PERIODE",
        chainTemplateCode: "CHAIN_STANDAR",
        description: "Permohonan koreksi periode terkunci",
      }),
    ]);
}
