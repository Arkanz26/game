import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db/client";
import { requireAuth } from "@/server/auth/request";
import { accountDefs } from "@/server/modules/reporting/lapan.service";
import { getStatementLines, listStatements } from "@/server/modules/reporting/statement.service";
import { can } from "@/server/rbac/authorize";
import { Alert, Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/silika/money";
import { StatementStatus } from "@/components/silika/status";
import { ACCOUNT_CLASS_LABELS } from "@/lib/labels";
import { formatTanggal, formatWaktu, todayWib } from "@/lib/dates";
import { loadCaseOr404 } from "../load-case";
import { LanapForm } from "./lanap-form";

export const metadata: Metadata = { title: "LANAP / LANIR" };

export default async function StatementsPage({ params }: PageProps<"/bdl/[bdlId]/statements">) {
  const { bdlId } = await params;
  const ctx = await requireAuth();
  const { bdl } = await loadCaseOr404(ctx, bdlId);
  const target = { bdlId: bdl.id, divisionId: bdl.divisionId };
  if (!can(ctx, "lapan.read", target)) notFound();
  const statements = await listStatements(db, bdl.id);
  const hasLockedLanap = statements.some((s) => s.kind === "LANAP" && s.status === "LOCKED");
  const lanapInReview = statements.some((s) => s.kind === "LANAP" && s.status === "IN_REVIEW");
  const draft = statements.find((s) => s.kind === "LANAP" && s.status === "DRAFT");
  const canEdit = can(ctx, "baseline.manage", target) && !hasLockedLanap && !lanapInReview;
  const today = todayWib();
  const accounts = await accountDefs(db, bdl, draft?.asOfDate ?? today);
  const draftAmounts = draft ? Object.fromEntries(await getStatementLines(db, draft.id)) : {};
  const linesByStatement = new Map(
    await Promise.all(statements.map(async (s) => [s.id, await getStatementLines(db, s.id)] as const)),
  );

  return (
    <div className="space-y-5">
      <Alert tone="info" title="Alur LANAP → LAPAN → LANIR">
        LANAP menjadi baseline buku besar. Setiap bulan LAPAN disusun dari transaksi terverifikasi. LANIR diterbitkan
        dari LAPAN yang disetujui dan, setelah disetujui, otomatis menjadi LANAP periode pelaporan berikutnya.
      </Alert>

      {canEdit && (
        <Card>
          <CardHeader
            title={draft ? "Draft LANAP baseline" : "Susun LANAP baseline"}
            description="Input saldo per akun sesuai laporan posisi awal likuidasi yang telah diaudit/diverifikasi. Nilai PPAP diisi sebagai angka positif (pengurang aset)."
          />
          <CardBody>
            <LanapForm
              bdlId={bdl.id}
              asOfDate={draft?.asOfDate ?? bdl.liquidationStartDate ?? today}
              amounts={draftAmounts}
              accounts={accounts.map((a) => ({
                code: a.code,
                name: a.name,
                group: ACCOUNT_CLASS_LABELS[a.accountClass],
              }))}
            />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Riwayat LANAP / LANIR" />
        {statements.length === 0 ? (
          <EmptyState title="Belum ada laporan aset neto" />
        ) : (
          <div className="divide-y divide-border">
            {statements.map((s) => {
              const lines = linesByStatement.get(s.id)!;
              return (
                <details key={s.id} className="group px-5 py-3" open={s.status !== "LOCKED" || undefined}>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm">
                    <Badge tone={s.kind === "LANAP" ? "primary" : "info"}>{s.kind}</Badge>
                    <span className="font-medium">per {formatTanggal(s.asOfDate)}</span>
                    <StatementStatus status={s.status} />
                    {s.derivedFromStatementId && <span className="text-xs text-muted">diturunkan dari LANIR</span>}
                    <span className="ml-auto text-xs text-muted">
                      {s.lockedAt ? `Dikunci ${formatWaktu(s.lockedAt)}` : ""}
                    </span>
                    {s.documentId && (
                      <Link href={`/documents/${s.documentId}`} className="text-xs text-primary hover:underline">
                        dokumen
                      </Link>
                    )}
                  </summary>
                  <Table className="mt-3">
                    <thead>
                      <tr>
                        <Th>Akun</Th>
                        <Th align="right">Saldo</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {accounts
                        .filter((a) => lines.has(a.code))
                        .map((a) => (
                          <tr key={a.code}>
                            <Td>
                              {a.name}{" "}
                              <span className="text-xs text-muted">· {ACCOUNT_CLASS_LABELS[a.accountClass]}</span>
                            </Td>
                            <Td align="right">
                              <Money value={lines.get(a.code)} />
                            </Td>
                          </tr>
                        ))}
                    </tbody>
                  </Table>
                </details>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
