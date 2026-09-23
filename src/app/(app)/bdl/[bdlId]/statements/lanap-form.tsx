"use client";

import { useActionState } from "react";
import { Field, Input } from "@/components/ui/form";
import { SubmitButton, ActionMessage } from "@/components/ui/action-form";
import { saveLanapAction } from "../actions";

export function LanapForm({
  bdlId,
  asOfDate,
  accounts,
  amounts,
}: {
  bdlId: string;
  asOfDate: string;
  accounts: { code: string; name: string; group: string }[];
  amounts: Record<string, string>;
}) {
  const [state, action] = useActionState(saveLanapAction, null);
  const v = state?.values ?? {};
  const groups = [...new Set(accounts.map((a) => a.group))];
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="bdlId" value={bdlId} />
      <Field
        label="Tanggal posisi LANAP"
        htmlFor="asOfDate"
        required
        hint="Periode buku besar pertama dimulai sehari setelah tanggal ini."
      >
        <Input
          id="asOfDate"
          name="asOfDate"
          type="date"
          defaultValue={v.asOfDate ?? asOfDate}
          required
          className="max-w-48"
        />
      </Field>
      {groups.map((g) => (
        <fieldset key={g} className="rounded-md border border-border p-4">
          <legend className="px-1 text-xs font-semibold text-muted uppercase">{g}</legend>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {accounts
              .filter((a) => a.group === g)
              .map((a) => (
                <Field key={a.code} label={a.name} htmlFor={`acc_${a.code}`}>
                  <Input
                    id={`acc_${a.code}`}
                    name={`acc_${a.code}`}
                    inputMode="decimal"
                    className="tabular text-right"
                    defaultValue={v[`acc_${a.code}`] ?? amounts[a.code] ?? ""}
                    placeholder="0"
                  />
                </Field>
              ))}
          </div>
        </fieldset>
      ))}
      <div className="flex items-center justify-end gap-2">
        <SubmitButton variant="secondary" name="intent" value="draft">
          Simpan draft
        </SubmitButton>
        <SubmitButton name="intent" value="submit">
          Simpan & ajukan persetujuan
        </SubmitButton>
      </div>
      <ActionMessage state={state} />
    </form>
  );
}
