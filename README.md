# SILIKA — Sistem Informasi Likuidasi Bank

Sistem web end-to-end untuk proses likuidasi bank di bawah kerangka LPS (GLIB & Tim Likuidasi) sekaligus repository
data terpusat seluruh BDL. **Tahap 1** berisi fondasi (skema data inti, autentikasi + RBAC, mesin persetujuan berbasis
konfigurasi, audit trail immutable) dan modul pertama yang lengkap: **Buku Besar Transaksi → kunci periode → LAPAN
otomatis → rantai persetujuan → LANIR → LANAP periode berikutnya**.

## Stack

| Lapisan  | Teknologi                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Aplikasi | Next.js 16 (App Router, Server Components, Server Actions), TypeScript strict                                                      |
| UI       | Tailwind CSS 4, komponen lokal (tanpa CDN/font eksternal — siap air-gapped), Bahasa Indonesia, format `id-ID`                      |
| Data     | PostgreSQL 16 + Drizzle ORM; uang `NUMERIC(20,2)` ↔ string + `decimal.js` (tidak pernah float)                                     |
| Auth     | Session di DB (token opak di-hash SHA-256, cookie httpOnly/SameSite=strict, idle 30 mnt/absolut 8 jam), Argon2id, lockout 5× gagal |
| Uji      | Vitest (unit + integrasi ke PostgreSQL nyata), Playwright (E2E)                                                                    |
| Deploy   | Docker (`output: standalone`), docker-compose (PostgreSQL, MinIO, migrasi, app), GitHub Actions                                    |

## Menjalankan secara lokal

```bash
cp .env.example .env                       # sesuaikan DATABASE_URL
docker compose up -d postgres minio        # atau gunakan PostgreSQL 16 lokal
pnpm install
pnpm db:setup                              # reset skema + migrasi + seed referensi & skenario demo
pnpm dev                                   # http://localhost:3000
```

Stack penuh (termasuk migrasi & app dalam container): `docker compose --profile app up --build`.

### Akun demo (kata sandi `Silika#Dev2026`)

| Email                             | Peran          | Cakupan                                           |
| --------------------------------- | -------------- | ------------------------------------------------- |
| `tl1@silika.local`                | Tim Likuidasi  | BDL-001                                           |
| `tl2@silika.local`                | Tim Likuidasi  | BDL-002                                           |
| `pic1@silika.local`               | PIC GLIB       | BDL-001, BDL-002                                  |
| `pic2@silika.local`               | PIC GLIB       | BDL-003, BDL-004                                  |
| `katim1@` / `katim2@silika.local` | Kepala Tim     | Divisi I / II                                     |
| `kadiv1@` / `kadiv2@silika.local` | Kepala Divisi  | Divisi I / II                                     |
| `direktur@silika.local`           | Direktur Group | Global                                            |
| `adk@silika.local`                | ADK            | Global (baca + persetujuan)                       |
| `auditor@silika.local`            | Auditor        | Global, read-only                                 |
| `admin@silika.local`              | Admin sistem   | Konfigurasi saja — tidak dapat membaca data kasus |

Skenario demo dibangun **lewat service aplikasi** (bukan insert langsung) sehingga seluruh aturan berlaku, relatif
terhadap tanggal hari ini:

- **BDL-001** (grade B, BPR): 4 periode — LAPAN disetujui, LAPAN menunggu Kadiv, periode terkunci dengan LAPAN draft,
  periode berjalan dengan entri menunggu verifikasi.
- **BDL-002** (grade A, BPRS syariah, kreditur separatis): penyerahan aset ke separatis, LAPAN → LANIR → LANAP turunan
  disetujui, permohonan koreksi disetujui + entri koreksi menunggu verifikasi.
- **BDL-003** (grade C, simpanan terjamin Rp1,2 T): LANAP menunggu **gate audit KAP** (> Rp200 M).
- **BDL-004**: tahap pengamanan aset, belum ada LANAP.

## Perintah

| Perintah                                             | Fungsi                                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm dev` / `pnpm build` / `pnpm start`             | Pengembangan / build produksi / jalankan build                                      |
| `pnpm lint` · `pnpm typecheck`                       | ESLint · type-check (termasuk tipe rute Next)                                       |
| `pnpm test:unit`                                     | Uji unit (money, posting engine, kalkulasi LAPAN, resolver matriks, RBAC)           |
| `pnpm test:integration`                              | Uji integrasi ke `TEST_DATABASE_URL` (di-reset tiap run): invariant DB & alur penuh |
| `pnpm test:e2e`                                      | Playwright terhadap build produksi + DB demo (`pnpm db:setup && pnpm build` dulu)   |
| `pnpm db:generate`                                   | Buat migrasi dari perubahan skema Drizzle                                           |
| `pnpm db:migrate` · `pnpm db:reset` · `pnpm db:seed` | Migrasi · reset skema (non-produksi) · seed                                         |

Jika Chromium Playwright sudah terpasang di lokasi lain, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

## Arsitektur

Modular monolith. Semua akses data melalui service di `src/server/modules/*` yang menerima `AuthContext`; halaman dan
Server Actions tidak pernah menulis ke DB secara langsung.

```
src/
  app/                      # halaman & server actions (tipis)
  components/               # UI (ui/ generik, silika/ domain)
  lib/                      # money, dates, labels (dipakai client & server)
  server/
    db/schema/              # skema Drizzle per domain
    db/seed/                # konfigurasi referensi + organisasi + skenario demo
    auth/                   # session, provider (local; OIDC/LDAP menyusul), AuthContext
    rbac/                   # katalog permission, can()/bdlScope()/hasRoleFor()
    audit/                  # audit log hash-chained
    modules/
      bdl/  ledger/  reporting/  approval/  documents/  config/
drizzle/                    # migrasi SQL (0001_invariants.sql = trigger & constraint domain)
tests/{unit,integration,e2e}
```

### Prinsip kunci

**Konfigurasi, bukan if-else.** Tabel konfigurasi berversi (`effective_from`/`effective_to`, baris immutable,
exclusion constraint anti-tumpang-tindih, setiap perubahan tercatat otomatis di audit log oleh trigger):

| Tabel                            | Mengatur                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `approval_matrix_rules`          | `document_type × grade × jenis bank × separatis × threshold → chain template` (+ prioritas, spesifisitas) |
| `approval_chain_templates/steps` | Urutan langkah, peran, cakupan (divisi/global), SLA, gate (mis. audit KAP)                                |
| `system_parameters`              | mis. `KAP_AUDIT_THRESHOLD = Rp200 M`, `CORRECTION_WINDOW_DAYS`                                            |
| `transaction_types`              | Jenis transaksi terkontrol: skema input form **dan** aturan posting ke akun & pos LAPAN                   |
| `accounts`, `lapan_line_items`   | Bagan akun aset neto (label per profil, mis. "Pembiayaan" untuk syariah) & format LAPAN                   |

Resolusi aturan memakai **tanggal pembuatan dokumen**, bukan hari ini — regulasi baru tidak mengubah jalur
persetujuan dokumen lama. Setiap `approval_request` menyimpan id baris aturan & template yang dipakai beserta
fakta masukan (`resolution_context`), sehingga auditor (BPK/OJK) dapat menelusuri aturan yang berlaku.

**Buku besar sebagai source of truth.**

```
LANAP (baseline, dikunci) ─► transaksi periode (TL input → PIC verifikasi → posting)
   ─► kunci periode ─► LAPAN (agregasi otomatis, snapshot immutable + SHA-256)
   ─► rantai persetujuan (matriks) ─► LANIR ─► disetujui ─► LANAP periode berikutnya
```

- Tanggal transaksi aktual terpisah dari tanggal input.
- Maker-checker: pembuat entri tidak dapat memverifikasi (juga `CHECK` di DB).
- Posting lines dihasilkan saat verifikasi dari `posting_rules` dan bersifat immutable.
- LAPAN: saldo awal (LANAP / akhir periode sebelumnya) + Σ posting → saldo akhir, pos perubahan aset neto,
  rekonsiliasi gross vs nett (PPAP), dan validasi (roll-forward, akun/pos dikenal, saldo negatif).
- **Koreksi periode terkunci**: Permohonan Koreksi (melalui matriks persetujuan) membuka jendela waktu; entri koreksi
  bertanggal asli dicatat di periode OPEN berjalan dan dilaporkan pada pos "Koreksi periode sebelumnya". LAPAN yang
  sudah terkunci tidak pernah berubah.

**Invariant di level database** (`drizzle/0001_invariants.sql`) — berlaku walau ada penulisan di luar aplikasi:
audit log append-only + hash chain (`select silika_audit_verify_chain()` → `NULL` = utuh); versi dokumen immutable;
dokumen `LOCKED` beku; entri hanya masuk ke periode `OPEN`; entri bertanggal mundur wajib permohonan koreksi yang
disetujui; entri `VERIFIED/REJECTED` final; periode hanya bisa dikunci jika semua entri final; LANAP/LANIR terkunci
beku; baris konfigurasi immutable. Role `silika_app` tidak memiliki hak UPDATE/DELETE atas tabel append-only —
di produksi aplikasi harus login dengan role anggota `silika_app`, bukan owner skema.

**RBAC.** Peran (TL, PIC GLIB, Katim, Kadiv, Direktur Group, ADK, Admin, Auditor) × cakupan (`GLOBAL`, `DIVISION`,
`BDL`) di `user_role_assignments`; pemetaan peran→permission di tabel `role_permissions`. BDL di luar cakupan tampil
sebagai 404. Pembacaan data rahasia (case, buku besar, LAPAN, dokumen) juga dicatat di audit log.

**Siap SSO.** Provider identitas hanya menetapkan _siapa_ pengguna (`AuthProvider` di `src/server/auth/providers`);
peran & cakupan tetap dari SILIKA, sehingga OIDC (IdP LPS) atau LDAP/AD dapat ditambahkan tanpa mengubah RBAC.

## Asumsi yang perlu divalidasi

- **Corpus regulasi** di seed adalah placeholder bertanda `[perlu verifikasi]` (nomor PLPS/PADK dan bunyi pasal).
- **Format LAPAN & bagan akun** adalah default yang wajar dan sepenuhnya konfigurabel; sesuaikan dengan format resmi.
- **Gate audit KAP** diterapkan pada LANAP/LANIR (bukan LAPAN bulanan) untuk BDL dengan simpanan terjamin > Rp200 M;
  LAPAN grade C memerlukan Direktur Group. Semuanya baris di `approval_matrix_rules`.

## Belum termasuk (tahap berikutnya)

Unggah & versi berkas di Repository Dokumen (MinIO), TL Governance + kalkulator honorarium (kontinuitas Pasal 26(4),
band ceiling), drafting Nota Dinas/Keputusan ADK dengan template bersyarat, admin panel konfigurasi, aging report
lintas-portofolio, SSO OIDC/LDAP, PostgreSQL Row-Level Security sebagai defense-in-depth, e-sign ADK.
