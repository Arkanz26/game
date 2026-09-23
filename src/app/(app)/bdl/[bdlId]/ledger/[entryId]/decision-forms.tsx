"use client";

import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Select, Textarea } from "@/components/ui/form";
import { entryAction } from "../../actions";

export function EntryDecisionForms({
  entryId,
  canVerify,
  canReverse,
  ownerOps,
  corrections,
  needsCorrection,
}: {
  entryId: string;
  canVerify: boolean;
  canReverse: boolean;
  ownerOps: ("submit" | "withdraw" | "delete")[];
  corrections: { id: string; label: string }[];
  needsCorrection: boolean;
}) {
  const hidden = (op: string) => (
    <>
      <input type="hidden" name="entryId" value={entryId} />
      <input type="hidden" name="op" value={op} />
    </>
  );
  const labels = { submit: "Ajukan verifikasi", withdraw: "Tarik ke draft", delete: "Hapus draft" };
  return (
    <div className="space-y-4">
      {ownerOps.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {ownerOps.map((op) => (
            <ActionForm key={op} action={entryAction} confirm={op === "delete" ? "Hapus draft ini?" : undefined}>
              {hidden(op)}
              <SubmitButton variant={op === "submit" ? "primary" : "secondary"} size="sm">
                {labels[op]}
              </SubmitButton>
            </ActionForm>
          ))}
        </div>
      )}
      {canVerify && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ActionForm
            action={entryAction}
            confirm="Verifikasi entri ini? Posting ke buku besar bersifat final."
            className="rounded-md border border-success/30 bg-success-soft p-4"
          >
            {hidden("verify")}
            <p className="mb-3 text-sm">
              Nilai, tanggal, dan bukti telah sesuai. Verifikasi akan menghasilkan posting ke akun & pos LAPAN.
            </p>
            <SubmitButton variant="success">Verifikasi & posting</SubmitButton>
          </ActionForm>
          <ActionForm action={entryAction} className="rounded-md border border-danger/30 bg-danger-soft p-4">
            {hidden("reject")}
            <Field label="Alasan penolakan" htmlFor="reason" required>
              <Textarea id="reason" name="reason" rows={2} required />
            </Field>
            <SubmitButton variant="danger" className="mt-3">
              Tolak entri
            </SubmitButton>
          </ActionForm>
        </div>
      )}
      {canReverse && (
        <ActionForm
          action={entryAction}
          confirm="Buat entri reversal? Reversal tetap harus diverifikasi PIC."
          className="rounded-md border border-border p-4"
        >
          {hidden("reverse")}
          <p className="mb-3 text-sm font-medium">Reversal entri terverifikasi</p>
          <Field label="Alasan reversal" htmlFor="rev-reason" required>
            <Textarea id="rev-reason" name="reason" rows={2} required />
          </Field>
          {needsCorrection && (
            <Field
              label="Permohonan koreksi yang disetujui"
              htmlFor="rev-cr"
              required
              className="mt-3"
              hint="Entri berada di periode terkunci; reversal memerlukan permohonan koreksi."
            >
              <Select id="rev-cr" name="correctionRequestId">
                <option value="">— pilih —</option>
                {corrections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <SubmitButton variant="secondary" className="mt-3">
            Buat reversal
          </SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
