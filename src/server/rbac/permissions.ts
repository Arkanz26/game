import type { roleCode } from "@/server/db/schema/enums";

export type Role = (typeof roleCode.enumValues)[number];

export const ROLE_LABELS: Record<Role, string> = {
  TL: "Tim Likuidasi",
  PIC_GLIB: "PIC GLIB",
  KATIM: "Kepala Tim",
  KADIV: "Kepala Divisi",
  DIREKTUR_GROUP: "Direktur Group",
  ADK: "Anggota Dewan Komisioner",
  ADMIN: "Administrator Sistem",
  AUDITOR: "Auditor (read-only)",
};

/** Permission catalog. Role → permission mapping lives in the role_permissions table. */
export const PERMISSIONS = {
  "bdl.read": "Melihat case file BDL",
  "bdl.manage": "Mengelola profil & tahap BDL",
  "ledger.read": "Melihat buku besar transaksi",
  "ledger.entry.create": "Mencatat transaksi",
  "ledger.entry.submit": "Mengajukan transaksi untuk verifikasi",
  "ledger.entry.verify": "Memverifikasi / menolak transaksi",
  "period.lock": "Mengunci periode buku besar",
  "lapan.read": "Melihat LANAP / LAPAN / LANIR",
  "lapan.generate": "Menyusun LAPAN dari buku besar",
  "lapan.submit": "Mengajukan LAPAN / LANAP / LANIR ke rantai persetujuan",
  "baseline.manage": "Menyusun LANAP baseline",
  "lanir.issue": "Menerbitkan LANIR",
  "correction.request": "Mengajukan permohonan koreksi periode",
  "correction.post": "Mencatat entri koreksi / reversal",
  "approval.act": "Bertindak pada langkah persetujuan",
  "dashboard.portfolio": "Melihat dashboard lintas-portofolio",
  "audit.read": "Membaca audit trail",
  "config.read": "Melihat konfigurasi (matriks persetujuan, jenis transaksi)",
  "config.manage": "Mengubah konfigurasi",
  "user.manage": "Mengelola pengguna & penugasan peran",
} as const;

export type Permission = keyof typeof PERMISSIONS;

const READ_CASE: Permission[] = ["bdl.read", "ledger.read", "lapan.read"];
const REVIEWER: Permission[] = [...READ_CASE, "approval.act", "dashboard.portfolio", "audit.read", "config.read"];

/** Default mapping seeded into role_permissions (editable later by ADMIN). */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  TL: [...READ_CASE, "ledger.entry.create", "ledger.entry.submit", "correction.post"],
  PIC_GLIB: [
    ...READ_CASE,
    "bdl.manage",
    "ledger.entry.create",
    "ledger.entry.submit",
    "ledger.entry.verify",
    "period.lock",
    "lapan.generate",
    "lapan.submit",
    "baseline.manage",
    "lanir.issue",
    "correction.request",
    "correction.post",
    "approval.act",
    "config.read",
  ],
  KATIM: REVIEWER,
  KADIV: REVIEWER,
  DIREKTUR_GROUP: REVIEWER,
  ADK: [...READ_CASE, "approval.act", "dashboard.portfolio"],
  // Administrators manage configuration and users but do not see case data.
  ADMIN: ["config.read", "config.manage", "user.manage", "audit.read"],
  AUDITOR: [...READ_CASE, "audit.read", "config.read", "dashboard.portfolio"],
};
