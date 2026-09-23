import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import { ledgerEntries } from "@/server/db/schema";
import { requireAuth } from "@/server/auth/request";
import { audit } from "@/server/audit/audit";
import { auditTrailFor } from "@/server/audit/queries";
import { getEntryDetail } from "@/server/modules/ledger/entry.service";
import { listCorrections } from "@/server/modules/ledger/correction.service";
import { loadPeriod, periodLabel } from "@/server/modules/ledger/period.service";
import { accountLabel, getAccounts, getLapanLines } from "@/server/modules/config/effective";
import { can } from "@/server/rbac/authorize";
import { NotFoundError } from "@/server/errors";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { Money } from "@/components/silika/money";
import { EntryKind, EntryStatus, PeriodStatus } from "@/components/silika/status";
import { COUNTERPARTY_LABELS } from "@/lib/labels";
import { formatTanggal, formatWaktu } from "@/lib/dates";
import { formatRupiah } from "@/lib/money";
import { loadCaseOr404 } from "../../load-case";
import { EntryDecisionForms } from "./decision-forms";

export const metadata: Metadata = { title: "Detail Transaksi" };

export default async function EntryDetailPage({ params }: PageProps<"/bdl/[bdlId]/ledger/[entryId]">) {
  const { bdlId, entryId } = await params;
  const ctx = await requireAuth();
  const { bdl } = await loadCaseOr404(ctx, bdlId);
  const detail = await getEntryDetail(db, ctx, entryId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { entry: e, lines, type, people } = detail;
  if (e.bdlId !== bdl.id) notFound();
  const target = { bdlId: bdl.id, divisionId: bdl.divisionId };
  const [period, origin, accounts, lapanLines, trail] = await Promise.all([
    loadPeriod(db, e.periodId),
    e.originPeriodId && e.originPeriodId !== e.periodId ? loadPeriod(db, e.originPeriodId) : Promise.resolve(null),
    getAccounts(db, e.transactionDate),
    getLapanLines(db, e.transactionDate),
    auditTrailFor(db, "ledger_entry", e.id),
  ]);
  await audit(db, ctx, { action: "ledger.entry.view", entityType: "ledger_entry", entityId: e.id, bdlId: bdl.id });

  const mine = e.createdBy === ctx.user.id;
  const [existingReversal] = await db
    .select({ id: ledgerEntries.id, entryNo: ledgerEntries.entryNo })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.correctsEntryId, e.id),
        eq(ledgerEntries.entryKind, "REVERSAL"),
        ne(ledgerEntries.status, "REJECTED"),
      ),
    );
  const canReverse =
    can(ctx, "correction.post", target) && e.status === "VERIFIED" && e.entryKind !== "REVERSAL" && !existingReversal;
  const ownerOps: ("submit" | "withdraw" | "delete")[] = [];
  if (mine && e.status === "DRAFT" && period.status === "OPEN") ownerOps.push("submit", "delete");
  if (mine && e.status === "SUBMITTED") ownerOps.push("withdraw");
  const corrections =
    canReverse && period.status !== "OPEN" ? await listCorrections(db, bdl.id, { usableOnly: true }) : [];
  const accountName = new Map(accounts.map((a) => [a.code, accountLabel(a, bdl.bankType)]));
  const lapanName = new Map(lapanLines.map((l) => [l.code, l.name]));

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <div className="space-y-5 xl:col-span-2">
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                Entri #{e.entryNo} <EntryStatus status={e.status} />{" "}
                {e.entryKind !== "NORMAL" && <EntryKind status={e.entryKind} />}
              </span>
            }
            description={type.name}
            actions={
              <Link href={`/bdl/${bdl.id}/ledger`} className="text-xs text-primary hover:underline">
                ← Kembali ke buku besar
              </Link>
            }
          />
          <CardBody>
            <p className="mb-4 text-sm">{e.description}</p>
            <DefinitionList
              items={[
                ["Tanggal transaksi (aktual)", formatTanggal(e.transactionDate)],
                ["Tanggal input", formatWaktu(e.createdAt)],
                ["Nilai", <Money key="v" value={e.amount} strong />],
                [
                  "Dilaporkan pada periode",
                  <span key="p" className="inline-flex items-center gap-1.5">
                    {periodLabel(period)} <PeriodStatus status={period.status} />
                  </span>,
                ],
                ...(origin ? ([["Periode asal (dikoreksi)", periodLabel(origin)]] as [string, string][]) : []),
                [
                  "Pihak lawan",
                  e.counterpartyName
                    ? `${e.counterpartyName}${e.counterpartyType ? ` (${COUNTERPARTY_LABELS[e.counterpartyType]})` : ""}`
                    : "—",
                ],
                ["Rujukan aset/kewajiban", e.assetRef ?? "—"],
                ["Rujukan bukti", e.evidenceRef ?? "—"],
                ["Diinput oleh", people.get(e.createdBy) ?? "—"],
                [
                  "Diverifikasi oleh",
                  e.verifiedBy ? `${people.get(e.verifiedBy)} · ${formatWaktu(e.verifiedAt)}` : "—",
                ],
                ...(e.correctsEntryId
                  ? ([
                      [
                        "Membalik entri",
                        <Link
                          key="r"
                          className="text-primary hover:underline"
                          href={`/bdl/${bdl.id}/ledger/${e.correctsEntryId}`}
                        >
                          lihat entri asal
                        </Link>,
                      ],
                    ] as [string, React.ReactNode][])
                  : []),
                ...(existingReversal
                  ? ([
                      [
                        "Reversal",
                        <Link
                          key="rv"
                          className="text-primary hover:underline"
                          href={`/bdl/${bdl.id}/ledger/${existingReversal.id}`}
                        >
                          entri #{existingReversal.entryNo}
                        </Link>,
                      ],
                    ] as [string, React.ReactNode][])
                  : []),
              ]}
            />
            {e.rejectionReason && (
              <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                Ditolak: {e.rejectionReason}
              </p>
            )}
          </CardBody>
          <Table>
            <thead>
              <tr>
                <Th>Komponen nilai</Th>
                <Th align="right">Isian</Th>
              </tr>
            </thead>
            <tbody>
              {type.inputSchema.map((f) => (
                <tr key={f.key}>
                  <Td>{f.label}</Td>
                  <Td align="right">
                    {f.kind === "money"
                      ? formatRupiah(e.inputs[f.key])
                      : f.kind === "account"
                        ? (accountName.get(e.inputs[f.key]) ?? e.inputs[f.key])
                        : (e.inputs[f.key] ?? "—")}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card>
          <CardHeader
            title="Posting ke buku besar"
            description="Dihasilkan otomatis dari aturan posting jenis transaksi saat verifikasi (immutable)."
          />
          {lines.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted">Posting dibuat setelah entri diverifikasi.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Akun</Th>
                  <Th>Pos LAPAN</Th>
                  <Th align="right">Mutasi saldo</Th>
                  <Th align="right">Dampak aset neto</Th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <Td>{accountName.get(l.accountCode) ?? l.accountCode}</Td>
                    <Td className="text-xs">{lapanName.get(l.lapanLineCode) ?? l.lapanLineCode}</Td>
                    <Td align="right">
                      <Money value={l.amount} />
                    </Td>
                    <Td align="right">
                      <Money value={l.netAssetEffect} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        {(ownerOps.length > 0 ||
          (can(ctx, "ledger.entry.verify", target) && e.status === "SUBMITTED" && !mine) ||
          canReverse) && (
          <Card>
            <CardHeader title="Tindakan" />
            <CardBody>
              <EntryDecisionForms
                entryId={e.id}
                ownerOps={ownerOps}
                canVerify={can(ctx, "ledger.entry.verify", target) && e.status === "SUBMITTED" && !mine}
                canReverse={canReverse}
                needsCorrection={period.status !== "OPEN"}
                corrections={corrections.map((c) => ({
                  id: c.request.id,
                  label: `${periodLabel(c.period)} — ${c.request.reason.slice(0, 60)}`,
                }))}
              />
              {can(ctx, "ledger.entry.verify", target) && e.status === "SUBMITTED" && mine && (
                <p className="text-xs text-muted">
                  Entri ini Anda buat sendiri; verifikasi harus dilakukan oleh pengguna lain (maker-checker).
                </p>
              )}
            </CardBody>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader title="Jejak audit" description="Tercatat permanen (hash-chained)" />
        <ol className="space-y-3 px-5 py-4 text-sm">
          {trail.map(({ log, actorName }) => (
            <li key={log.id} className="border-l-2 border-primary-soft pl-3">
              <div className="font-medium">{log.action}</div>
              <div className="text-xs text-muted">
                {formatWaktu(log.occurredAt)} · {actorName ?? "sistem"}
              </div>
              <div className="font-mono text-[10px] text-muted/80" title="SHA-256 rantai audit">
                {log.hash?.slice(0, 16)}…
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
