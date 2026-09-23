"use server";

import { redirect } from "next/navigation";
import { formString, formValues, runAction, type ActionState } from "@/server/actions";
import {
  createEntry,
  deleteDraftEntry,
  rejectEntry,
  reverseEntry,
  submitEntry,
  verifyEntry,
  withdrawEntry,
  type CounterpartyType,
} from "@/server/modules/ledger/entry.service";
import { lockPeriod } from "@/server/modules/ledger/period.service";
import { requestCorrection } from "@/server/modules/ledger/correction.service";
import { generateLapan, submitLapan } from "@/server/modules/reporting/lapan.service";
import { issueLanir, saveLanapDraft, submitLanap } from "@/server/modules/reporting/statement.service";
import { DomainError } from "@/server/errors";

const INPUT_PREFIX = "in_";

export async function createEntryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const bdlId = formString(fd, "bdlId");
  const rawInputs: Record<string, string> = {};
  for (const [k, v] of fd.entries())
    if (k.startsWith(INPUT_PREFIX) && typeof v === "string") rawInputs[k.slice(INPUT_PREFIX.length)] = v;
  const state = await runAction(
    async (ctx) => {
      const entry = await createEntry(ctx, {
        bdlId,
        transactionTypeCode: formString(fd, "transactionTypeCode"),
        transactionDate: formString(fd, "transactionDate"),
        description: formString(fd, "description"),
        counterpartyType: (formString(fd, "counterpartyType") || null) as CounterpartyType | null,
        counterpartyName: formString(fd, "counterpartyName"),
        assetRef: formString(fd, "assetRef"),
        evidenceRef: formString(fd, "evidenceRef"),
        correctionRequestId: formString(fd, "correctionRequestId") || null,
        rawInputs,
        submit: formString(fd, "intent") === "submit",
      });
      return `Entri #${entry.entryNo} tersimpan`;
    },
    { values: formValues(fd) },
  );
  if (state?.ok) redirect(`/bdl/${bdlId}/ledger`);
  return state;
}

/** Single-entry workflow transitions. */
export async function entryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const entryId = formString(fd, "entryId");
  const op = formString(fd, "op");
  return runAction(async (ctx) => {
    switch (op) {
      case "submit":
        await submitEntry(ctx, entryId);
        return "Entri diajukan untuk verifikasi";
      case "withdraw":
        await withdrawEntry(ctx, entryId);
        return "Entri ditarik kembali ke draft";
      case "delete":
        await deleteDraftEntry(ctx, entryId);
        return "Draft dihapus";
      case "verify":
        await verifyEntry(ctx, entryId);
        return "Entri terverifikasi dan diposting";
      case "reject":
        await rejectEntry(ctx, entryId, formString(fd, "reason"));
        return "Entri ditolak";
      case "reverse": {
        const rev = await reverseEntry(ctx, entryId, {
          reason: formString(fd, "reason"),
          correctionRequestId: formString(fd, "correctionRequestId") || null,
        });
        return `Reversal #${rev.entryNo} dibuat dan menunggu verifikasi`;
      }
      default:
        throw new DomainError("Operasi tidak dikenal");
    }
  });
}

export async function bulkVerifyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ids = fd.getAll("entryIds").filter((v): v is string => typeof v === "string");
  return runAction(async (ctx) => {
    if (ids.length === 0) throw new DomainError("Pilih minimal satu entri");
    // Each entry is verified in its own transaction so one failure does not hide the others.
    const failures: string[] = [];
    for (const id of ids) {
      try {
        await verifyEntry(ctx, id);
      } catch (e) {
        failures.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (failures.length)
      throw new DomainError(
        `${ids.length - failures.length} terverifikasi; ${failures.length} gagal: ${failures.join("; ")}`,
      );
    return `${ids.length} entri terverifikasi`;
  });
}

export async function periodAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const periodId = formString(fd, "periodId");
  const op = formString(fd, "op");
  return runAction(async (ctx) => {
    switch (op) {
      case "lock":
        await lockPeriod(ctx, periodId);
        return "Periode dikunci; periode berikutnya dibuka";
      case "generate": {
        const r = await generateLapan(ctx, periodId);
        return `LAPAN versi ${r.versionNo} disusun dari buku besar`;
      }
      case "submit":
        await submitLapan(ctx, periodId);
        return "LAPAN diajukan ke rantai persetujuan";
      case "lanir":
        await issueLanir(ctx, periodId);
        return "LANIR diterbitkan dan diajukan untuk persetujuan";
      case "correction":
        await requestCorrection(ctx, { targetPeriodId: periodId, reason: formString(fd, "reason") });
        return "Permohonan koreksi diajukan";
      default:
        throw new DomainError("Operasi tidak dikenal");
    }
  });
}

export async function saveLanapAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const amounts: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("acc_") && typeof v === "string") amounts[k.slice(4)] = v;
  const submit = formString(fd, "intent") === "submit";
  return runAction(
    async (ctx) => {
      const s = await saveLanapDraft(ctx, {
        bdlId: formString(fd, "bdlId"),
        asOfDate: formString(fd, "asOfDate"),
        amounts,
      });
      if (submit) {
        await submitLanap(ctx, s.id);
        return "LANAP diajukan ke rantai persetujuan";
      }
      return "Draft LANAP tersimpan";
    },
    { values: formValues(fd) },
  );
}
