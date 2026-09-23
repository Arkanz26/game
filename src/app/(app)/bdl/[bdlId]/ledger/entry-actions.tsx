"use client";

import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { bulkVerifyAction, entryAction } from "../actions";

/** Compact per-row workflow buttons. */
export function RowActions({
  entryId,
  canSubmit,
  canWithdraw,
  canDelete,
  canVerify,
}: {
  entryId: string;
  canSubmit: boolean;
  canWithdraw: boolean;
  canDelete: boolean;
  canVerify: boolean;
}) {
  const btn = (
    op: string,
    label: string,
    variant: "primary" | "secondary" | "danger" | "success" | "ghost",
    confirm?: string,
  ) => (
    <ActionForm action={entryAction} confirm={confirm} className="inline-block">
      <input type="hidden" name="entryId" value={entryId} />
      <input type="hidden" name="op" value={op} />
      <SubmitButton size="sm" variant={variant}>
        {label}
      </SubmitButton>
    </ActionForm>
  );
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {canSubmit && btn("submit", "Ajukan", "primary")}
      {canWithdraw && btn("withdraw", "Tarik", "secondary")}
      {canDelete && btn("delete", "Hapus", "ghost", "Hapus draft entri ini?")}
      {canVerify &&
        btn("verify", "Verifikasi", "success", "Verifikasi entri ini? Entri terverifikasi tidak dapat diubah.")}
    </div>
  );
}

/** Form element referenced (via the `form` attribute) by row checkboxes, avoiding nested forms. */
export function BulkVerifyForm({ formId, count }: { formId: string; count: number }) {
  return (
    <ActionForm
      id={formId}
      action={bulkVerifyAction}
      confirm="Verifikasi seluruh entri yang dipilih?"
      className="flex items-center gap-2"
    >
      <SubmitButton size="sm" variant="success">
        Verifikasi terpilih ({count} menunggu)
      </SubmitButton>
    </ActionForm>
  );
}
