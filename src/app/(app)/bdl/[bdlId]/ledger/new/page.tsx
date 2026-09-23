import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/server/db/client";
import { requireAuth } from "@/server/auth/request";
import { accountLabel, getAccounts, getTransactionTypes } from "@/server/modules/config/effective";
import { getOpenPeriod, periodLabel } from "@/server/modules/ledger/period.service";
import { listCorrections } from "@/server/modules/ledger/correction.service";
import { can } from "@/server/rbac/authorize";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatWaktu, todayWib } from "@/lib/dates";
import { loadCaseOr404 } from "../../load-case";
import { EntryForm } from "./entry-form";

export const metadata: Metadata = { title: "Catat Transaksi" };

export default async function NewEntryPage({ params }: PageProps<"/bdl/[bdlId]/ledger/new">) {
  const { bdlId } = await params;
  const ctx = await requireAuth();
  const { bdl } = await loadCaseOr404(ctx, bdlId);
  const target = { bdlId: bdl.id, divisionId: bdl.divisionId };
  if (!can(ctx, "ledger.entry.create", target)) notFound();
  const open = await getOpenPeriod(db, bdl.id);
  if (!open) notFound();
  const today = todayWib();
  const [types, accounts, corrections] = await Promise.all([
    getTransactionTypes(db, today),
    getAccounts(db, today),
    can(ctx, "correction.post", target) ? listCorrections(db, bdl.id, { usableOnly: true }) : Promise.resolve([]),
  ]);
  return (
    <Card className="max-w-4xl">
      <CardHeader
        title="Catat transaksi"
        description="Transaksi tersimpan sebagai draft atau langsung diajukan untuk verifikasi PIC (maker-checker)."
      />
      <CardBody>
        <EntryForm
          bdlId={bdl.id}
          today={today}
          openPeriod={{ label: periodLabel(open), start: open.periodStart, end: open.periodEnd }}
          accounts={Object.fromEntries(accounts.map((a) => [a.code, accountLabel(a, bdl.bankType)]))}
          corrections={corrections.map((c) => ({
            id: c.request.id,
            label: `${periodLabel(c.period)} — ${c.request.reason.slice(0, 60)} (berlaku s.d. ${formatWaktu(c.request.windowUntil)})`,
            periodStart: c.period.periodStart,
            periodEnd: c.period.periodEnd,
          }))}
          types={types.map((t) => ({
            code: t.code,
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            requiresCounterparty: t.requiresCounterparty,
            defaultCounterpartyType: t.defaultCounterpartyType,
            // Profile-driven availability (config flag, not hard-coded per BDL).
            disabledReason:
              t.requiresSeparatistCreditor && !bdl.hasSeparatistCreditor ? "BDL tanpa kreditur separatis" : null,
          }))}
        />
      </CardBody>
    </Card>
  );
}
