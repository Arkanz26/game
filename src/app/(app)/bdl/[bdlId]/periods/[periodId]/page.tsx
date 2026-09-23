import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { netAssetStatements, periodCorrectionRequests } from "@/server/db/schema";
import { requireAuth } from "@/server/auth/request";
import { audit } from "@/server/audit/audit";
import { countOpenItems, loadPeriod, periodLabel } from "@/server/modules/ledger/period.service";
import { computePeriodLapan, loadLapanSnapshot } from "@/server/modules/reporting/lapan.service";
import { getApprovalTrail } from "@/server/modules/approval/workflow.service";
import { can } from "@/server/rbac/authorize";
import { NotFoundError } from "@/server/errors";
import { Alert, Card, CardBody, CardHeader } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { LapanView } from "@/components/silika/lapan-view";
import { ApprovalTrail } from "@/components/silika/approval-trail";
import { CorrectionStatus, DocumentStatus, PeriodStatus, StatementStatus } from "@/components/silika/status";
import { formatTanggal, formatWaktu } from "@/lib/dates";
import { loadCaseOr404 } from "../../load-case";
import { CorrectionRequestForm, PeriodButton } from "../period-forms";

export const metadata: Metadata = { title: "Periode & LAPAN" };

export default async function PeriodDetailPage({ params }: PageProps<"/bdl/[bdlId]/periods/[periodId]">) {
  const { bdlId, periodId } = await params;
  const ctx = await requireAuth();
  const { bdl } = await loadCaseOr404(ctx, bdlId);
  const target = { bdlId: bdl.id, divisionId: bdl.divisionId };
  if (!can(ctx, "lapan.read", target)) notFound();
  const period = await loadPeriod(db, periodId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (period.bdlId !== bdl.id) notFound();

  const [openItems, lapan, corrections, lanirs] = await Promise.all([
    countOpenItems(db, period.id),
    period.lapanDocumentId ? loadLapanSnapshot(db, period.lapanDocumentId) : Promise.resolve(null),
    db.select().from(periodCorrectionRequests).where(eq(periodCorrectionRequests.targetPeriodId, period.id)),
    db
      .select()
      .from(netAssetStatements)
      .where(and(eq(netAssetStatements.sourcePeriodId, period.id), eq(netAssetStatements.kind, "LANIR"))),
  ]);
  const trail = lapan ? await getApprovalTrail(db, lapan.doc.id) : [];
  // Final numbers come from the immutable snapshot; otherwise show a live preview from the ledger.
  let live: Awaited<ReturnType<typeof computePeriodLapan>> | null = null;
  let liveError: string | null = null;
  if (!lapan?.snapshot) {
    try {
      live = await computePeriodLapan(db, bdl, period);
    } catch (e) {
      liveError = e instanceof Error ? e.message : String(e);
    }
  }
  await audit(db, ctx, { action: "lapan.view", entityType: "ledger_period", entityId: period.id, bdlId: bdl.id });

  const docStatus = lapan?.doc.status;
  const pending = openItems.draft + openItems.submitted;
  const canLock = can(ctx, "period.lock", target) && period.status === "OPEN";
  const canGenerate = can(ctx, "lapan.generate", target) && period.status === "LOCKED" && docStatus !== "IN_REVIEW";
  const canSubmit = can(ctx, "lapan.submit", target) && period.status === "LOCKED" && docStatus === "DRAFT";
  const lanir = lanirs.find((l) => l.status !== "DRAFT") ?? lanirs[0];
  const canLanir =
    can(ctx, "lanir.issue", target) && period.status === "APPROVED" && (!lanir || lanir.status === "DRAFT");
  const result = lapan?.snapshot?.result ?? live?.result;
  const baselineDate = lapan?.snapshot?.baseline.asOfDate ?? live?.baseline.asOfDate;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              Periode {periodLabel(period)} <PeriodStatus status={period.status} />
            </span>
          }
          description={`${formatTanggal(period.periodStart)} s.d. ${formatTanggal(period.periodEnd)}`}
          actions={
            <>
              <LinkButton href={`/bdl/${bdl.id}/ledger?period=${period.id}`} size="sm">
                Lihat transaksi
              </LinkButton>
              {canLock && (
                <PeriodButton
                  periodId={period.id}
                  op="lock"
                  label="Kunci periode"
                  confirm="Kunci periode ini? Setelah dikunci, transaksi baru hanya dapat dicatat melalui mekanisme koreksi."
                />
              )}
              {canGenerate && (
                <PeriodButton
                  periodId={period.id}
                  op="generate"
                  label={lapan ? "Susun ulang LAPAN" : "Susun LAPAN dari buku besar"}
                  variant={lapan ? "secondary" : "primary"}
                />
              )}
              {canSubmit && (
                <PeriodButton
                  periodId={period.id}
                  op="submit"
                  label="Ajukan LAPAN"
                  variant="success"
                  confirm="Ajukan LAPAN ke rantai persetujuan sesuai matriks?"
                />
              )}
              {canLanir && (
                <PeriodButton
                  periodId={period.id}
                  op="lanir"
                  label="Terbitkan LANIR"
                  confirm="Terbitkan LANIR per akhir periode ini? Setelah disetujui, LANIR menjadi LANAP periode berikutnya."
                />
              )}
            </>
          }
        />
        <CardBody>
          <ol className="grid grid-cols-1 gap-3 text-sm md:grid-cols-4">
            <Step done={pending === 0} title="Semua entri final">
              {pending === 0
                ? "Tidak ada draft/menunggu verifikasi"
                : `${openItems.submitted} menunggu verifikasi, ${openItems.draft} draft`}
            </Step>
            <Step done={period.status !== "OPEN"} title="Periode dikunci">
              {period.lockedAt ? formatWaktu(period.lockedAt) : "Belum"}
            </Step>
            <Step done={!!lapan && docStatus !== "DRAFT" && docStatus !== "REJECTED"} title="LAPAN diajukan">
              {lapan ? (
                <span className="inline-flex items-center gap-1">
                  v{lapan.doc.currentVersionNo} <DocumentStatus status={lapan.doc.status} />
                </span>
              ) : (
                "Belum disusun"
              )}
            </Step>
            <Step done={period.status === "APPROVED"} title="LAPAN disetujui">
              {period.approvedAt ? formatWaktu(period.approvedAt) : "Belum"}
              {lanir && (
                <span className="mt-1 flex items-center gap-1 text-xs">
                  LANIR <StatementStatus status={lanir.status} />
                </span>
              )}
            </Step>
          </ol>
          {lapan?.version && (
            <p className="mt-4 text-xs text-muted">
              Snapshot LAPAN v{lapan.version.versionNo} · SHA-256{" "}
              <span className="font-mono">{lapan.version.sha256.slice(0, 24)}…</span> ·{" "}
              <Link className="text-primary hover:underline" href={`/documents/${lapan.doc.id}`}>
                buka dokumen
              </Link>
            </p>
          )}
        </CardBody>
      </Card>

      {liveError && (
        <Alert tone="warning" title="LAPAN belum dapat dihitung">
          {liveError}
        </Alert>
      )}
      {!lapan?.snapshot && live && (
        <Alert tone="info" title="Pratinjau langsung dari buku besar">
          Angka di bawah dihitung dari entri terverifikasi saat ini dan belum final. LAPAN final disusun sebagai
          snapshot immutable setelah periode dikunci.
        </Alert>
      )}
      {docStatus === "REJECTED" && (
        <Alert tone="danger" title="LAPAN dikembalikan">
          Periksa catatan pada jejak persetujuan, lakukan koreksi bila perlu, lalu susun ulang LAPAN.
        </Alert>
      )}

      <ApprovalTrail trail={trail} />

      {result && (
        <LapanView
          result={result}
          openingLabel={baselineDate ? `dasar LANAP ${formatTanggal(baselineDate)}` : "awal"}
          closingLabel={formatTanggal(period.periodEnd)}
        />
      )}

      {period.status !== "OPEN" && (can(ctx, "correction.request", target) || corrections.length > 0) && (
        <Card>
          <CardHeader
            title="Koreksi periode terkunci"
            description="Periode & LAPAN terkunci tidak diubah; koreksi dicatat di periode berjalan sebagai pos “Koreksi periode sebelumnya”."
          />
          <CardBody className="space-y-4">
            {corrections.length > 0 && (
              <ul className="divide-y divide-border rounded-md border border-border text-sm">
                {corrections.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-3 px-3 py-2">
                    <div>
                      <div>{c.reason}</div>
                      <div className="text-xs text-muted">
                        Diajukan {formatWaktu(c.createdAt)}
                        {c.windowUntil && ` · jendela koreksi s.d. ${formatWaktu(c.windowUntil)}`}
                      </div>
                    </div>
                    <CorrectionStatus status={c.status} />
                  </li>
                ))}
              </ul>
            )}
            {can(ctx, "correction.request", target) && <CorrectionRequestForm periodId={period.id} />}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function Step({ done, title, children }: { done: boolean; title: string; children: React.ReactNode }) {
  return (
    <li
      className={`rounded-md border px-3 py-2 ${done ? "border-success/30 bg-success-soft" : "border-border bg-surface-muted"}`}
    >
      <div className="text-xs font-semibold">
        {done ? "✓ " : ""}
        {title}
      </div>
      <div className="mt-0.5 text-xs text-muted">{children}</div>
    </li>
  );
}
