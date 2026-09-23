import type { LapanResult } from "@/server/modules/reporting/lapan-calc";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Money } from "./money";
import { ACCOUNT_CLASS_LABELS } from "@/lib/labels";
import { toDecimal } from "@/lib/money";
import { cn } from "@/lib/cn";

const SECTION_LABELS = {
  PENAMBAHAN: "Penambahan aset neto",
  PENGURANGAN: "Pengurangan aset neto",
  KOREKSI: "Koreksi",
} as const;

/** Renders a LAPAN (statement of changes in net assets) from its computed/snapshotted result. */
export function LapanView({
  result,
  openingLabel,
  closingLabel,
}: {
  result: LapanResult;
  openingLabel: string;
  closingLabel: string;
}) {
  const t = result.totals;
  const sections = (["PENAMBAHAN", "PENGURANGAN", "KOREKSI"] as const).map((s) => ({
    section: s,
    rows: result.changes.filter((c) => c.section === s),
  }));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Summary label={`Aset neto awal (${openingLabel})`} value={t.openingNetAssets} />
        <Summary label="Total perubahan aset neto" value={t.totalChanges} />
        <Summary label={`Aset neto akhir (${closingLabel})`} value={t.closingNetAssets} strong />
      </div>

      <Card>
        <CardHeader
          title="I. Perubahan aset neto"
          description="Agregasi otomatis posting transaksi terverifikasi per pos LAPAN"
        />
        <Table>
          <tbody>
            <tr className="bg-surface-muted/60">
              <Td className="font-semibold">Aset neto awal periode</Td>
              <Td align="right">
                <Money value={t.openingNetAssets} strong />
              </Td>
            </tr>
            {sections.map(({ section, rows }) => (
              <SectionRows key={section} title={SECTION_LABELS[section]} rows={rows} />
            ))}
            <tr className="border-t-2 border-foreground/30">
              <Td className="font-semibold">Total perubahan aset neto</Td>
              <Td align="right">
                <Money value={t.totalChanges} strong />
              </Td>
            </tr>
            <tr className="bg-primary-soft">
              <Td className="font-semibold">Aset neto akhir periode</Td>
              <Td align="right">
                <Money value={t.closingNetAssets} strong />
              </Td>
            </tr>
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader title="II. Posisi aset neto per akun" />
        <Table>
          <thead>
            <tr>
              <Th>Akun</Th>
              <Th>Kelompok</Th>
              <Th align="right">Saldo awal</Th>
              <Th align="right">Mutasi</Th>
              <Th align="right">Saldo akhir</Th>
            </tr>
          </thead>
          <tbody>
            {result.accounts.map((a) => (
              <tr
                key={a.code}
                className={cn(toDecimal(a.opening).isZero() && toDecimal(a.closing).isZero() && "text-muted")}
              >
                <Td>{a.name}</Td>
                <Td className="text-xs text-muted">{ACCOUNT_CLASS_LABELS[a.accountClass]}</Td>
                <Td align="right">
                  <Money value={a.opening} />
                </Td>
                <Td align="right">
                  <Money value={a.movement} />
                </Td>
                <Td align="right">
                  <Money value={a.closing} />
                </Td>
              </tr>
            ))}
            <tr className="bg-surface-muted/60 font-semibold">
              <Td colSpan={2}>Total aset (neto PPAP)</Td>
              <Td align="right">
                <Money value={t.openingAssets} />
              </Td>
              <Td />
              <Td align="right">
                <Money value={t.closingAssets} />
              </Td>
            </tr>
            <tr className="bg-surface-muted/60 font-semibold">
              <Td colSpan={2}>Total kewajiban</Td>
              <Td align="right">
                <Money value={t.openingLiabilities} />
              </Td>
              <Td />
              <Td align="right">
                <Money value={t.closingLiabilities} />
              </Td>
            </tr>
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader title="III. Rekonsiliasi gross vs nett (PPAP)" />
        <Table>
          <thead>
            <tr>
              <Th>Aset</Th>
              <Th align="right">Gross</Th>
              <Th align="right">PPAP</Th>
              <Th align="right">Nett</Th>
            </tr>
          </thead>
          <tbody>
            {result.grossNet
              .filter((g) => !toDecimal(g.gross).isZero() || !toDecimal(g.ppap).isZero())
              .map((g) => (
                <tr key={g.assetCode}>
                  <Td>{g.name}</Td>
                  <Td align="right">
                    <Money value={g.gross} />
                  </Td>
                  <Td align="right">
                    <Money value={g.ppap} />
                  </Td>
                  <Td align="right">
                    <Money value={g.net} strong />
                  </Td>
                </tr>
              ))}
          </tbody>
        </Table>
      </Card>

      <ValidationChecks checks={result.checks} />
    </div>
  );
}

function SectionRows({ title, rows }: { title: string; rows: LapanResult["changes"] }) {
  const nonZero = rows.filter((r) => !toDecimal(r.amount).isZero());
  return (
    <>
      <tr>
        <Td colSpan={2} className="pt-3 text-xs font-semibold tracking-wide text-muted uppercase">
          {title}
        </Td>
      </tr>
      {nonZero.length === 0 ? (
        <tr>
          <Td className="pl-6 text-xs text-muted">Tidak ada mutasi</Td>
          <Td align="right" className="text-muted">
            —
          </Td>
        </tr>
      ) : (
        nonZero.map((r) => (
          <tr key={r.code}>
            <Td className="pl-6">{r.name}</Td>
            <Td align="right">
              <Money value={r.amount} />
            </Td>
          </tr>
        ))
      )}
    </>
  );
}

function Summary({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface px-4 py-3",
        strong && "border-primary/40 bg-primary-soft",
      )}
    >
      <div className="text-xs text-muted">{label}</div>
      <Money value={value} strong className="mt-1 block text-lg" />
    </div>
  );
}

export function ValidationChecks({ checks }: { checks: LapanResult["checks"] }) {
  return (
    <Card>
      <CardHeader title="Validasi konsistensi" />
      <ul className="divide-y divide-border text-sm">
        {checks.map((c) => (
          <li key={c.code} className="flex items-start justify-between gap-3 px-5 py-2.5">
            <div>
              <div>{c.description}</div>
              {c.detail && <div className="font-mono text-xs text-muted">{c.detail}</div>}
            </div>
            {c.ok ? <Badge tone="success">Lolos</Badge> : <Badge tone="danger">Gagal</Badge>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
