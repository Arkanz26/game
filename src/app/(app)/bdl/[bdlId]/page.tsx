import { db } from "@/server/db/client";
import { requireAuth } from "@/server/auth/request";
import { getCaseOverview } from "@/server/modules/bdl/service";
import { getOpenPeriod, listPeriods, periodLabel } from "@/server/modules/ledger/period.service";
import { computePeriodLapan } from "@/server/modules/reporting/lapan.service";
import { Card, CardBody, CardHeader, DefinitionList, EmptyState } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { Money } from "@/components/silika/money";
import { PeriodStatus } from "@/components/silika/status";
import { STAGE_LABELS, STAGE_ORDER, TL_END_REASON_LABELS } from "@/lib/labels";
import { formatTanggal, formatWaktu } from "@/lib/dates";
import { formatRupiah } from "@/lib/money";
import { cn } from "@/lib/cn";
import { loadCaseOr404 } from "./load-case";

export default async function CaseOverviewPage({ params }: PageProps<"/bdl/[bdlId]">) {
  const { bdlId } = await params;
  const ctx = await requireAuth();
  const { bdl } = await loadCaseOr404(ctx, bdlId);
  const [overview, periods, open] = await Promise.all([
    getCaseOverview(db, bdl.id),
    listPeriods(db, bdl.id),
    getOpenPeriod(db, bdl.id),
  ]);
  // Current position = opening balance of the open period (i.e. everything verified so far).
  const position = open ? await computePeriodLapan(db, bdl, open) : null;
  const currentStageIdx = STAGE_ORDER.indexOf(bdl.lifecycleStage);
  const stageDates = new Map<string, string>(overview.stages.map((s) => [s.stage, s.enteredAt]));

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <div className="space-y-5 xl:col-span-2">
        <Card>
          <CardHeader title="Tahapan likuidasi" />
          <CardBody>
            <ol className="flex flex-wrap gap-y-3">
              {STAGE_ORDER.map((stage, i) => (
                <li key={stage} className="flex min-w-32 flex-1 items-start gap-2">
                  <span
                    className={cn(
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                      i < currentStageIdx && "bg-success text-white",
                      i === currentStageIdx && "bg-primary text-white ring-4 ring-primary-soft",
                      i > currentStageIdx && "bg-surface-muted text-muted",
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="text-xs">
                    <span className={cn("block font-medium", i > currentStageIdx && "text-muted")}>
                      {STAGE_LABELS[stage]}
                    </span>
                    <span className="text-muted">
                      {stageDates.has(stage) ? formatTanggal(stageDates.get(stage)!) : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Posisi aset neto terkini"
            description={
              position
                ? `Saldo awal periode ${periodLabel(open!)} (seluruh transaksi terverifikasi hingga periode sebelumnya)`
                : undefined
            }
          />
          {position ? (
            <>
              <CardBody>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-xs text-muted">Total aset (neto PPAP)</div>
                    <Money value={position.result.totals.openingAssets} strong />
                  </div>
                  <div>
                    <div className="text-xs text-muted">Total kewajiban</div>
                    <Money value={position.result.totals.openingLiabilities} strong />
                  </div>
                  <div>
                    <div className="text-xs text-muted">Aset neto</div>
                    <Money value={position.result.totals.openingNetAssets} strong className="text-lg" />
                  </div>
                </div>
              </CardBody>
              <Table>
                <thead>
                  <tr>
                    <Th>Akun</Th>
                    <Th align="right">Saldo</Th>
                  </tr>
                </thead>
                <tbody>
                  {position.result.accounts
                    .filter((a) => a.opening !== "0.00")
                    .map((a) => (
                      <tr key={a.code}>
                        <Td>
                          {a.name}
                          {a.accountClass === "CONTRA_ASSET" && (
                            <span className="text-xs text-muted"> (pengurang aset)</span>
                          )}
                        </Td>
                        <Td align="right">{formatRupiah(a.opening)}</Td>
                      </tr>
                    ))}
                </tbody>
              </Table>
            </>
          ) : (
            <EmptyState title="Belum ada LANAP baseline yang dikunci">
              Buku besar dibuka setelah LANAP disetujui.
            </EmptyState>
          )}
        </Card>

        <Card>
          <CardHeader title="Periode buku besar" />
          {periods.length === 0 ? (
            <EmptyState title="Belum ada periode" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Periode</Th>
                  <Th>Status</Th>
                  <Th>Dikunci</Th>
                </tr>
              </thead>
              <tbody>
                {periods.slice(0, 6).map((p) => (
                  <tr key={p.id}>
                    <Td>{periodLabel(p)}</Td>
                    <Td>
                      <PeriodStatus status={p.status} />
                    </Td>
                    <Td className="text-xs text-muted">{formatWaktu(p.lockedAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader title="Profil BDL" />
          <CardBody>
            <DefinitionList
              items={[
                ["Tanggal CIU", formatTanggal(bdl.licenseRevokedDate)],
                ["Mulai likuidasi", formatTanggal(bdl.liquidationStartDate)],
                ["Simpanan terjamin", formatRupiah(bdl.insuredDepositsAmount)],
                ["Kota", bdl.city ?? "—"],
                ["PIC GLIB", overview.pics.map((p) => p.name).join(", ") || "—"],
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Tim Likuidasi" description="Riwayat penunjukan & penggantian" />
          <ul className="divide-y divide-border text-sm">
            {overview.team.map((m) => (
              <li key={m.id} className={cn("px-5 py-2.5", m.endedAt && "text-muted")}>
                <div className="font-medium">
                  {m.fullName}{" "}
                  <span className="text-xs font-normal text-muted">
                    · {m.position === "KETUA" ? "Ketua" : "Anggota"}
                  </span>
                </div>
                <div className="text-xs text-muted">
                  Sejak {formatTanggal(m.appointedAt)} ({m.decreeRef})
                  {m.endedAt &&
                    ` — berhenti ${formatTanggal(m.endedAt)}: ${TL_END_REASON_LABELS[m.endReason ?? ""] ?? m.endReason}`}
                  {m.replacesMemberId && " — pengganti anggota sebelumnya"}
                </div>
              </li>
            ))}
            {overview.team.length === 0 && <li className="px-5 py-3 text-sm text-muted">Belum ada TL ditunjuk</li>}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Linimasa kasus" />
          <ol className="space-y-3 px-5 py-4 text-sm">
            {overview.events.map(({ event, actorName }) => (
              <li key={event.id} className="border-l-2 border-primary-soft pl-3">
                <div>{event.title}</div>
                <div className="text-xs text-muted">
                  {formatWaktu(event.occurredAt)}
                  {actorName && ` · ${actorName}`}
                </div>
              </li>
            ))}
            {overview.events.length === 0 && <li className="text-muted">Belum ada peristiwa</li>}
          </ol>
        </Card>
      </div>
    </div>
  );
}
