"use client";

import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Textarea } from "@/components/ui/form";
import { periodAction } from "../actions";

export function PeriodButton({
  periodId,
  op,
  label,
  confirm,
  variant = "primary",
}: {
  periodId: string;
  op: "lock" | "generate" | "submit" | "lanir";
  label: string;
  confirm?: string;
  variant?: "primary" | "secondary" | "success";
}) {
  return (
    <ActionForm action={periodAction} confirm={confirm}>
      <input type="hidden" name="periodId" value={periodId} />
      <input type="hidden" name="op" value={op} />
      <SubmitButton variant={variant} size="sm">
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

export function CorrectionRequestForm({ periodId }: { periodId: string }) {
  return (
    <ActionForm action={periodAction} resetOnSuccess confirm="Ajukan permohonan koreksi untuk periode terkunci ini?">
      <input type="hidden" name="periodId" value={periodId} />
      <input type="hidden" name="op" value="correction" />
      <Field
        label="Alasan koreksi"
        htmlFor="reason"
        required
        hint="Setelah disetujui, entri koreksi bertanggal periode ini dapat dicatat di periode berjalan."
      >
        <Textarea id="reason" name="reason" rows={2} required minLength={10} />
      </Field>
      <SubmitButton variant="secondary" size="sm" className="mt-2">
        Ajukan permohonan koreksi
      </SubmitButton>
    </ActionForm>
  );
}
