import type { Metadata } from "next";
import Link from "next/link";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { documents, ledgerEntries } from "@/server/db/schema";
import { requireAuth } from "@/server/auth/request";
import { listPeriods, periodLabel } from "@/server/modules/ledger/period.service";
import { can } from "@/server/rbac/authorize";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { DocumentStatus, PeriodStatus } from "@/components/silika/status";
import { formatWaktu } from "@/lib/dates";
import { notFound } from "next/navigation";
import { loadCaseOr404 } from "../load-case";

export const metadata: Metadata = { title: "Periode & LAPAN" };

export default async function PeriodsPage({ params }: PageProps<"/bdl/[bdlId]/periods">) {
  const { bdlId } = await params;
  const ctx = await requireAuth();
  const { bdl } = await loadCaseOr404(ctx, bdlId);
  if (!can(ctx, "lapan.read", { bdlId: bdl.id, divisionId: bdl.divisionId })) notFound();
  const periods = await listPeriods(db, bdl.id);
  const ids = periods.map((p) => p.id);
  const [counts, docs] = ids.length
    ? await Promise.all([
        db
          .select({ periodId: ledgerEntries.periodId, status: ledgerEntries.status, n: sql<number>`count(*)::int` })
          .from(ledgerEntries)
          .where(inArray(ledgerEntries.periodId, ids))
          .groupBy(ledgerEntries.periodId, ledgerEntries.status),
        db.select().from(documents).where(eq(documents.bdlId, bdl.id)),
      ])
    : [[], []];
  const count = (pid: string, s: string) => counts.find((c) => c.periodId === pid && c.status === s)?.n ?? 0;
  return (
    <Card>
      <CardHeader
        title="Periode buku besar & LAPAN"
        description="LAPAN disusun otomatis dari buku besar setelah periode dikunci."
      />
      {periods.length === 0 ? (
        <EmptyState title="Belum ada periode">
          Periode pertama dibuka otomatis setelah LANAP baseline disetujui.
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Periode</Th>
              <Th>Status periode</Th>
              <Th align="right">Terverifikasi</Th>
              <Th align="right">Belum final</Th>
              <Th>LAPAN</Th>
              <Th>Dikunci</Th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => {
              const doc = docs.find((d) => d.id === p.lapanDocumentId);
              const open = count(p.id, "DRAFT") + count(p.id, "SUBMITTED");
              return (
                <tr key={p.id} className="hover:bg-surface-muted/60">
                  <Td>
                    <Link href={`/bdl/${bdl.id}/periods/${p.id}`} className="font-medium text-primary hover:underline">
                      {periodLabel(p)}
                    </Link>
                  </Td>
                  <Td>
                    <PeriodStatus status={p.status} />
                  </Td>
                  <Td align="right">{count(p.id, "VERIFIED")}</Td>
                  <Td align="right" className={open ? "font-semibold text-warning" : "text-muted"}>
                    {open}
                  </Td>
                  <Td>
                    {doc ? (
                      <DocumentStatus status={doc.status} />
                    ) : (
                      <span className="text-xs text-muted">Belum disusun</span>
                    )}
                  </Td>
                  <Td className="text-xs text-muted">{formatWaktu(p.lockedAt)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
