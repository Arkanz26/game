import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/server/db/client";
import { requireAuth } from "@/server/auth/request";
import { audit } from "@/server/audit/audit";
import { listEntries, type EntryRow } from "@/server/modules/ledger/entry.service";
import { getOpenPeriod, listPeriods, periodLabel } from "@/server/modules/ledger/period.service";
import { getTransactionTypes } from "@/server/modules/config/effective";
import { can } from "@/server/rbac/authorize";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { Select } from "@/components/ui/form";
import { LinkButton, buttonClass } from "@/components/ui/button";
import { Money } from "@/components/silika/money";
import { EntryKind, EntryStatus, PeriodStatus } from "@/components/silika/status";
import { formatTanggal, todayWib } from "@/lib/dates";
import { loadCaseOr404 } from "../load-case";
import { BulkVerifyForm, RowActions } from "./entry-actions";

export const metadata: Metadata = { title: "Buku Besar Transaksi" };

const STATUSES: [EntryRow["status"], string][] = [
  ["SUBMITTED", "Menunggu verifikasi"],
  ["DRAFT", "Draft"],
  ["VERIFIED", "Terverifikasi"],
  ["REJECTED", "Ditolak"],
];

export default async function LedgerPage({ params, searchParams }: PageProps<"/bdl/[bdlId]/ledger">) {
  const { bdlId } = await params;
  const sp = await searchParams;
  const ctx = await requireAuth();
  const { bdl } = await loadCaseOr404(ctx, bdlId);
  const target = { bdlId: bdl.id, divisionId: bdl.divisionId };
  const [periods, open, types] = await Promise.all([
    listPeriods(db, bdl.id),
    getOpenPeriod(db, bdl.id),
    getTransactionTypes(db, todayWib()),
  ]);

  const str = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const periodId = str("period") ?? (str("period") === undefined && open ? open.id : undefined);
  const filter = {
    periodId: periodId === "all" ? undefined : periodId,
    status: str("status") as EntryRow["status"] | undefined,
    typeCode: str("type"),
  };
  const rows = await listEntries(db, ctx, bdl.id, filter);
  await audit(db, ctx, { action: "ledger.view", entityType: "bdl", entityId: bdl.id, bdlId: bdl.id, after: filter });

  const canCreate = can(ctx, "ledger.entry.create", target) && !!open;
  const canVerify = can(ctx, "ledger.entry.verify", target);
  const canSubmit = can(ctx, "ledger.entry.submit", target);
  const pendingVerify = rows.filter((r) => r.entry.status === "SUBMITTED" && r.entry.createdBy !== ctx.user.id);
  const selectedPeriod = periods.find((p) => p.id === filter.periodId);
  const totalVerified = rows.filter((r) => r.entry.status === "VERIFIED");

  return (
    <Card>
      <CardHeader
        title="Buku Besar Transaksi"
        description={
          selectedPeriod ? (
            <span className="inline-flex items-center gap-2">
              Periode {periodLabel(selectedPeriod)} <PeriodStatus status={selectedPeriod.status} />
            </span>
          ) : (
            "Semua periode"
          )
        }
        actions={
          <>
            {canVerify && pendingVerify.length > 0 && (
              <BulkVerifyForm formId="bulk-verify" count={pendingVerify.length} />
            )}
            {canCreate && (
              <LinkButton href={`/bdl/${bdl.id}/ledger/new`} variant="primary" size="sm">
                + Catat transaksi
              </LinkButton>
            )}
          </>
        }
      />
      <form
        className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3"
        aria-label="Filter buku besar"
      >
        <Select name="period" defaultValue={filter.periodId ?? "all"} className="h-8 w-56 py-1" aria-label="Periode">
          <option value="all">Semua periode</option>
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {periodLabel(p)} — {p.status === "OPEN" ? "terbuka" : p.status === "LOCKED" ? "terkunci" : "disetujui"}
            </option>
          ))}
        </Select>
        <Select name="status" defaultValue={filter.status ?? ""} className="h-8 w-48 py-1" aria-label="Status">
          <option value="">Semua status</option>
          {STATUSES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Select name="type" defaultValue={filter.typeCode ?? ""} className="h-8 w-64 py-1" aria-label="Jenis transaksi">
          <option value="">Semua jenis transaksi</option>
          {types.map((t) => (
            <option key={t.code} value={t.code}>
              {t.name}
            </option>
          ))}
        </Select>
        <button className={buttonClass("secondary", "sm")}>Terapkan</button>
        <span className="ml-auto text-xs text-muted">
          {rows.length} entri · {totalVerified.length} terverifikasi
        </span>
      </form>
      {!open && (
        <p className="border-b border-border bg-warning-soft px-5 py-2 text-xs text-warning">
          Belum ada periode terbuka — LANAP baseline harus disetujui terlebih dahulu.
        </p>
      )}
      {rows.length === 0 ? (
        <EmptyState title="Belum ada transaksi pada filter ini" />
      ) : (
        <Table>
          <thead>
            <tr>
              {canVerify && <Th className="w-8" />}
              <Th>No.</Th>
              <Th>Tgl transaksi</Th>
              <Th>Jenis & uraian</Th>
              <Th>Pihak lawan</Th>
              <Th align="right">Nilai</Th>
              <Th>Status</Th>
              <Th>Diinput</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ entry: e, typeName, creatorName }) => {
              const mine = e.createdBy === ctx.user.id;
              const verifiable = canVerify && e.status === "SUBMITTED" && !mine;
              return (
                <tr key={e.id} className="hover:bg-surface-muted/60">
                  {canVerify && (
                    <Td>
                      {verifiable && (
                        <input
                          type="checkbox"
                          name="entryIds"
                          value={e.id}
                          form="bulk-verify"
                          aria-label={`Pilih entri #${e.entryNo}`}
                          className="mt-1"
                        />
                      )}
                    </Td>
                  )}
                  <Td className="tabular text-muted">#{e.entryNo}</Td>
                  <Td className="whitespace-nowrap">{formatTanggal(e.transactionDate)}</Td>
                  <Td>
                    <div className="flex items-center gap-1.5 text-xs text-muted">
                      {typeName}
                      {e.entryKind !== "NORMAL" && <EntryKind status={e.entryKind} />}
                    </div>
                    <Link
                      href={`/bdl/${bdl.id}/ledger/${e.id}`}
                      className="text-foreground hover:text-primary hover:underline"
                    >
                      {e.description}
                    </Link>
                  </Td>
                  <Td className="text-xs">{e.counterpartyName ?? "—"}</Td>
                  <Td align="right">
                    <Money value={e.amount} />
                  </Td>
                  <Td>
                    <EntryStatus status={e.status} />
                  </Td>
                  <Td className="text-xs text-muted">{creatorName}</Td>
                  <Td>
                    <RowActions
                      entryId={e.id}
                      canSubmit={canSubmit && mine && e.status === "DRAFT"}
                      canWithdraw={canSubmit && mine && e.status === "SUBMITTED"}
                      canDelete={mine && e.status === "DRAFT"}
                      canVerify={verifiable}
                    />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
