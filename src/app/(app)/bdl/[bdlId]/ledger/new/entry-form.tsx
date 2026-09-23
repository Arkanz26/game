"use client";

import { useActionState, useMemo, useState } from "react";
import type { TransactionInputField } from "@/server/db/schema/ledger";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/card";
import { COUNTERPARTY_LABELS } from "@/lib/labels";
import { formatRupiah, parseMoneyInput } from "@/lib/money";
import { createEntryAction } from "../../actions";

export type TypeOption = {
  code: string;
  name: string;
  description: string | null;
  inputSchema: TransactionInputField[];
  requiresCounterparty: boolean;
  defaultCounterpartyType: string | null;
  disabledReason: string | null;
};

export type CorrectionOption = { id: string; label: string; periodStart: string; periodEnd: string };

export function EntryForm({
  bdlId,
  types,
  accounts,
  corrections,
  openPeriod,
  today,
}: {
  bdlId: string;
  types: TypeOption[];
  accounts: Record<string, string>;
  corrections: CorrectionOption[];
  openPeriod: { label: string; start: string; end: string };
  today: string;
}) {
  const [state, action] = useActionState(createEntryAction, null);
  const v = state?.values ?? {};
  const err = state?.fieldErrors ?? {};
  const [typeCode, setTypeCode] = useState(v.transactionTypeCode ?? types.find((t) => !t.disabledReason)?.code ?? "");
  const [date, setDate] = useState(v.transactionDate ?? (today < openPeriod.end ? today : openPeriod.end));
  const [correctionId, setCorrectionId] = useState(v.correctionRequestId ?? "");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const type = useMemo(() => types.find((t) => t.code === typeCode), [types, typeCode]);
  const backDated = date < openPeriod.start;
  const maxDate = today < openPeriod.end ? today : openPeriod.end;

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="bdlId" value={bdlId} />
      {state && !state.ok && (
        <Alert tone="danger" title="Entri belum tersimpan">
          {state.message}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Jenis transaksi" htmlFor="transactionTypeCode" required error={err.transactionTypeCode}>
          <Select
            id="transactionTypeCode"
            name="transactionTypeCode"
            value={typeCode}
            onChange={(e) => setTypeCode(e.target.value)}
          >
            {types.map((t) => (
              <option key={t.code} value={t.code} disabled={!!t.disabledReason}>
                {t.name}
                {t.disabledReason ? ` — ${t.disabledReason}` : ""}
              </option>
            ))}
          </Select>
          {type?.description && <p className="mt-1 text-xs text-muted">{type.description}</p>}
        </Field>
        <Field
          label="Tanggal transaksi (aktual)"
          htmlFor="transactionDate"
          required
          error={err.transactionDate}
          hint={`Periode berjalan: ${openPeriod.label}. Tanggal input dicatat otomatis oleh sistem.`}
        >
          <Input
            id="transactionDate"
            name="transactionDate"
            type="date"
            value={date}
            max={maxDate}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </Field>
      </div>

      {backDated && (
        <div className="rounded-md border border-warning/30 bg-warning-soft p-4">
          <p className="text-sm font-medium text-warning">Tanggal berada pada periode yang sudah dikunci</p>
          <p className="mt-1 text-xs text-foreground/80">
            Transaksi hanya dapat dicatat melalui Permohonan Koreksi yang telah disetujui. Entri akan dilaporkan pada
            LAPAN periode berjalan sebagai &ldquo;Koreksi periode sebelumnya&rdquo;.
          </p>
          <Field label="Permohonan koreksi" htmlFor="correctionRequestId" className="mt-3" required>
            <Select
              id="correctionRequestId"
              name="correctionRequestId"
              value={correctionId}
              onChange={(e) => setCorrectionId(e.target.value)}
            >
              <option value="">— pilih permohonan koreksi yang disetujui —</option>
              {corrections
                .filter((c) => date >= c.periodStart && date <= c.periodEnd)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
      )}

      <Field label="Uraian transaksi" htmlFor="description" required error={err.description}>
        <Textarea
          id="description"
          name="description"
          rows={2}
          defaultValue={v.description}
          placeholder="mis. Pelunasan kredit a.n. …"
        />
      </Field>

      {type && (
        <fieldset className="rounded-md border border-border p-4">
          <legend className="px-1 text-xs font-semibold text-muted uppercase">Nilai transaksi</legend>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {type.inputSchema.map((f) => {
              const name = `in_${f.key}`;
              if (f.kind === "account") {
                return (
                  <Field key={f.key} label={f.label} htmlFor={name} required={f.required} error={err[f.key]}>
                    <Select id={name} name={name} defaultValue={v[name] ?? f.accountCodes?.[0]}>
                      {(f.accountCodes ?? Object.keys(accounts)).map((code) => (
                        <option key={code} value={code}>
                          {accounts[code] ?? code}
                        </option>
                      ))}
                    </Select>
                  </Field>
                );
              }
              if (f.kind === "money") {
                const parsed = amounts[f.key] ? parseMoneyInput(amounts[f.key]) : null;
                return (
                  <Field
                    key={f.key}
                    label={f.label}
                    htmlFor={name}
                    required={f.required}
                    error={err[f.key]}
                    hint={parsed ? formatRupiah(parsed) : (f.help ?? "Rupiah, mis. 1.250.000,50")}
                  >
                    <Input
                      id={name}
                      name={name}
                      inputMode="decimal"
                      className="tabular text-right"
                      defaultValue={v[name]}
                      onChange={(e) => setAmounts((a) => ({ ...a, [f.key]: e.target.value }))}
                      aria-invalid={!!err[f.key]}
                    />
                  </Field>
                );
              }
              return (
                <Field key={f.key} label={f.label} htmlFor={name} required={f.required} error={err[f.key]}>
                  <Input id={name} name={name} defaultValue={v[name]} />
                </Field>
              );
            })}
          </div>
        </fieldset>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Jenis pihak lawan" htmlFor="counterpartyType">
          <Select
            key={typeCode}
            id="counterpartyType"
            name="counterpartyType"
            defaultValue={v.counterpartyType ?? type?.defaultCounterpartyType ?? ""}
          >
            <option value="">—</option>
            {Object.entries(COUNTERPARTY_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Nama pihak lawan"
          htmlFor="counterpartyName"
          required={type?.requiresCounterparty}
          error={err.counterpartyName}
        >
          <Input id="counterpartyName" name="counterpartyName" defaultValue={v.counterpartyName} />
        </Field>
        <Field label="Rujukan aset/kewajiban" htmlFor="assetRef" hint="Kode aset, nomor rekening kredit, dsb.">
          <Input id="assetRef" name="assetRef" defaultValue={v.assetRef} />
        </Field>
        <Field label="Rujukan bukti" htmlFor="evidenceRef" hint="Nomor BKM/BKK, risalah lelang, akta, dsb.">
          <Input id="evidenceRef" name="evidenceRef" defaultValue={v.evidenceRef} />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <SubmitButton variant="secondary" name="intent" value="draft">
          Simpan draft
        </SubmitButton>
        <SubmitButton name="intent" value="submit">
          Simpan & ajukan verifikasi
        </SubmitButton>
      </div>
    </form>
  );
}
