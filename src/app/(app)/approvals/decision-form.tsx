"use client";

import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Input, Textarea } from "@/components/ui/form";
import { approvalAction } from "./actions";

export function DecisionForm({ stepId, kapGate }: { stepId: string; kapGate: boolean }) {
  return (
    <ActionForm action={approvalAction} className="space-y-2">
      <input type="hidden" name="stepId" value={stepId} />
      {kapGate && (
        <Input name="gateEvidence" placeholder="No. laporan audit KAP" aria-label="Nomor laporan audit KAP" required />
      )}
      <Textarea name="comment" rows={2} placeholder="Catatan (wajib bila dikembalikan)" aria-label="Catatan" />
      <div className="flex gap-2">
        <SubmitButton size="sm" variant="success" name="decision" value="APPROVE">
          {kapGate ? "Konfirmasi audit KAP" : "Setujui"}
        </SubmitButton>
        <SubmitButton size="sm" variant="secondary" name="decision" value="RETURN">
          Kembalikan
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
