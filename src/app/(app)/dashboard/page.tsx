import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/server/db/client";
import { requireAuth } from "@/server/auth/request";
import { listCases } from "@/server/modules/bdl/service";
import { periodLabel } from "@/server/modules/ledger/period.service";
import { can } from "@/server/rbac/authorize";
import { Card, CardHeader, EmptyState, StatTile } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { Input, Select } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BankTypeBadge, DocumentStatus, GradeBadge, PeriodStatus, StageBadge } from "@/components/silika/status";
import { STAGE_LABELS } from "@/lib/labels";
import { daysBetween, formatBulan, todayWib } from "@/lib/dates";
import { formatRupiahCompact } from "@/lib/money";

export const metadata: Metadata = { title: "Dashboard Kasus" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const ctx = await requireAuth();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const filter = { q: str("q"), grade: str("grade"), stage: str("stage") };
  const cases = await listCases(db, ctx, filter);
  const today = todayWib();

  const submitted = cases.reduce((n, c) => n + c.submittedEntries, 0);
  const inReview = cases.reduce((n, c) => n + c.pendingApprovalCount, 0);
  const overduePeriods = cases.filter((c) => c.openPeriod && c.openPeriod.periodEnd < today);
  const oldest = cases
    .map((c) => c.oldestPendingApproval?.activatedAt)
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const portfolio = can(ctx, "dashboard.portfolio");

  return (
    <>
      <PageHeader
        title={portfolio ? "Dashboard Portofolio Likuidasi" : "Dashboard Kasus BDL"}
        subtitle={`${cases.length} BDL dalam cakupan akses Anda · posisi ${formatBulan(today)}`}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="BDL aktif"
          value={cases.length}
          hint={`${cases.filter((c) => c.lifecycleStage === "OPERASIONAL").length} dalam tahap pemberesan`}
        />
        <StatTile
          label="Menunggu verifikasi"
          value={submitted}
          tone={submitted ? "warning" : "success"}
          hint="Entri transaksi dari Tim Likuidasi"
        />
        <StatTile
          label="Dokumen dalam persetujuan"
          value={inReview}
          hint={oldest ? `Tertua ${daysBetween(oldest)} hari di satu tahap` : "Tidak ada antrian"}
          tone={oldest && daysBetween(oldest) > 5 ? "danger" : "default"}
        />
        <StatTile
          label="Periode lewat bulan belum dikunci"
          value={overduePeriods.length}
          tone={overduePeriods.length ? "danger" : "success"}
          hint={overduePeriods.map((c) => c.code).join(", ") || "Semua periode tepat waktu"}
        />
      </div>

      <Card>
        <CardHeader
          title="Daftar BDL"
          actions={
            <form className="flex flex-wrap items-center gap-2" role="search">
              <Input
                name="q"
                placeholder="Cari kode / nama BDL"
                defaultValue={filter.q}
                className="h-8 w-56 py-1"
                aria-label="Cari BDL"
              />
              <Select
                name="grade"
                defaultValue={filter.grade ?? ""}
                className="h-8 w-36 py-1"
                aria-label="Filter grade"
              >
                <option value="">Semua grade</option>
                {["A", "B", "C"].map((g) => (
                  <option key={g} value={g}>
                    Grade {g}
                  </option>
                ))}
              </Select>
              <Select
                name="stage"
                defaultValue={filter.stage ?? ""}
                className="h-8 w-48 py-1"
                aria-label="Filter tahap"
              >
                <option value="">Semua tahap</option>
                {Object.entries(STAGE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
              <button className={buttonClass("secondary", "sm")}>Terapkan</button>
            </form>
          }
        />
        {cases.length === 0 ? (
          <EmptyState title="Tidak ada BDL yang sesuai">Periksa filter atau cakupan penugasan Anda.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>BDL</Th>
                <Th>Profil</Th>
                <Th>Tahap</Th>
                <Th>TL aktif</Th>
                <Th>Periode berjalan</Th>
                <Th align="center">Verifikasi</Th>
                <Th>LAPAN terakhir</Th>
                <Th>Persetujuan tertunda</Th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => {
                const overdue = c.openPeriod && c.openPeriod.periodEnd < today;
                const ketua = c.activeTl.find((t) => t.position === "KETUA") ?? c.activeTl[0];
                return (
                  <tr key={c.id} className="hover:bg-surface-muted/60">
                    <Td className="min-w-60">
                      <Link href={`/bdl/${c.id}`} className="font-semibold text-primary hover:underline">
                        {c.code}
                      </Link>
                      <div className="text-foreground">{c.name}</div>
                      <div className="text-xs text-muted">
                        {c.divisionCode} · {c.city}
                      </div>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <GradeBadge grade={c.grade} />
                        <BankTypeBadge bankClass={c.bankClass} bankType={c.bankType} />
                        {c.hasSeparatistCreditor && <Badge tone="neutral">Separatis</Badge>}
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        Simpanan terjamin {formatRupiahCompact(c.insuredDepositsAmount)}
                      </div>
                    </Td>
                    <Td>
                      <StageBadge stage={c.lifecycleStage} />
                    </Td>
                    <Td className="min-w-36 text-xs">
                      {ketua ? (
                        `${ketua.fullName} (${ketua.position === "KETUA" ? "Ketua" : "Anggota"})`
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                    <Td className="text-xs">
                      {c.openPeriod ? (
                        <>
                          <div>{periodLabel(c.openPeriod)}</div>
                          {overdue ? <Badge tone="danger">Lewat bulan</Badge> : <PeriodStatus status="OPEN" />}
                        </>
                      ) : (
                        <span className="text-muted">Belum ada LANAP</span>
                      )}
                    </Td>
                    <Td align="center">
                      {c.submittedEntries > 0 ? (
                        <Badge tone="warning">{c.submittedEntries} menunggu</Badge>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                      {c.draftEntries > 0 && <div className="mt-1 text-xs text-muted">{c.draftEntries} draft</div>}
                    </Td>
                    <Td className="text-xs">
                      {c.lastLapan ? (
                        <>
                          <div>{formatBulan(c.lastLapan.periodEnd)}</div>
                          <DocumentStatus status={c.lastLapan.status} />
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                    <Td className="text-xs">
                      {c.oldestPendingApproval ? (
                        <>
                          <div className="max-w-56 truncate" title={c.oldestPendingApproval.title}>
                            {c.oldestPendingApproval.title}
                          </div>
                          <div className="text-muted">
                            {c.oldestPendingApproval.label} ·{" "}
                            <span
                              className={
                                daysBetween(c.oldestPendingApproval.activatedAt!) > 5 ? "font-semibold text-danger" : ""
                              }
                            >
                              {daysBetween(c.oldestPendingApproval.activatedAt!)} hari
                            </span>
                          </div>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
