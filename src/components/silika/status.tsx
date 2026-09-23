import { Badge, type Tone } from "@/components/ui/badge";
import { STAGE_LABELS } from "@/lib/labels";

const ENTRY: Record<string, [string, Tone]> = {
  DRAFT: ["Draft", "neutral"],
  SUBMITTED: ["Menunggu verifikasi", "warning"],
  VERIFIED: ["Terverifikasi", "success"],
  REJECTED: ["Ditolak", "danger"],
};
const PERIOD: Record<string, [string, Tone]> = {
  OPEN: ["Terbuka", "info"],
  LOCKED: ["Terkunci", "warning"],
  APPROVED: ["LAPAN disetujui", "success"],
};
const DOCUMENT: Record<string, [string, Tone]> = {
  DRAFT: ["Draft", "neutral"],
  IN_REVIEW: ["Dalam persetujuan", "warning"],
  APPROVED: ["Disetujui", "success"],
  REJECTED: ["Dikembalikan", "danger"],
  LOCKED: ["Disetujui & dikunci", "success"],
  SUPERSEDED: ["Digantikan", "neutral"],
};
const STATEMENT: Record<string, [string, Tone]> = {
  DRAFT: ["Draft", "neutral"],
  IN_REVIEW: ["Dalam persetujuan", "warning"],
  LOCKED: ["Dikunci", "success"],
};
const STEP: Record<string, [string, Tone]> = {
  WAITING: ["Menunggu giliran", "neutral"],
  PENDING: ["Menunggu tindakan", "warning"],
  APPROVED: ["Disetujui", "success"],
  RETURNED: ["Dikembalikan", "danger"],
  SKIPPED: ["Tidak diproses", "neutral"],
};
const CORRECTION: Record<string, [string, Tone]> = {
  DRAFT: ["Draft", "neutral"],
  IN_REVIEW: ["Dalam persetujuan", "warning"],
  APPROVED: ["Disetujui", "success"],
  RETURNED: ["Dikembalikan", "danger"],
  USED: ["Selesai", "neutral"],
};
const KIND: Record<string, [string, Tone]> = {
  NORMAL: ["Normal", "neutral"],
  CORRECTION: ["Koreksi", "primary"],
  REVERSAL: ["Reversal", "primary"],
};

function make(map: Record<string, [string, Tone]>) {
  return function StatusBadge({ status }: { status: string }) {
    const [label, tone] = map[status] ?? [status, "neutral"];
    return <Badge tone={tone}>{label}</Badge>;
  };
}

export const EntryStatus = make(ENTRY);
export const PeriodStatus = make(PERIOD);
export const DocumentStatus = make(DOCUMENT);
export const StatementStatus = make(STATEMENT);
export const StepStatus = make(STEP);
export const CorrectionStatus = make(CORRECTION);
export const EntryKind = make(KIND);

export function GradeBadge({ grade }: { grade: string }) {
  const tone: Tone = grade === "A" ? "success" : grade === "B" ? "warning" : "danger";
  return <Badge tone={tone}>Grade {grade}</Badge>;
}

export function StageBadge({ stage }: { stage: string }) {
  return <Badge tone="primary">{STAGE_LABELS[stage] ?? stage}</Badge>;
}

export function BankTypeBadge({ bankClass, bankType }: { bankClass: string; bankType: string }) {
  return (
    <Badge tone={bankType === "SYARIAH" ? "success" : "info"}>
      {bankClass} · {bankType === "SYARIAH" ? "Syariah" : "Konvensional"}
    </Badge>
  );
}
