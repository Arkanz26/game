import type { getApprovalTrail } from "@/server/modules/approval/workflow.service";
import { Card, CardHeader } from "@/components/ui/card";
import { StepStatus } from "./status";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS, type Role } from "@/server/rbac/permissions";
import { formatWaktu } from "@/lib/dates";

type Trail = Awaited<ReturnType<typeof getApprovalTrail>>;

/** Approval history incl. the matrix rule & chain template version applied (for auditors). */
export function ApprovalTrail({ trail }: { trail: Trail }) {
  if (trail.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Jejak persetujuan" description="Aturan matriks & versi template yang berlaku saat pengajuan" />
      <div className="divide-y divide-border">
        {trail.map(({ request, rule, template, steps }) => {
          const ctx = request.resolutionContext as { asOf?: string; requiresKapAudit?: boolean };
          return (
            <div key={request.id} className="px-5 py-4">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <Badge
                  tone={
                    request.status === "APPROVED" ? "success" : request.status === "RETURNED" ? "danger" : "warning"
                  }
                >
                  {request.status === "APPROVED"
                    ? "Disetujui"
                    : request.status === "RETURNED"
                      ? "Dikembalikan"
                      : "Berjalan"}
                </Badge>
                <span className="text-muted">
                  Versi dokumen v{request.documentVersionNo} · diajukan {formatWaktu(request.submittedAt)}
                </span>
              </div>
              <p className="mb-3 text-xs text-muted">
                Aturan{" "}
                <span className="font-mono text-foreground">
                  {rule.code} v{rule.version}
                </span>{" "}
                ({rule.description}) → template{" "}
                <span className="font-mono text-foreground">
                  {template.code} v{template.version}
                </span>
                {ctx.asOf && <> · tanggal acuan regulasi {ctx.asOf}</>}
                {ctx.requiresKapAudit && <> · wajib audit KAP</>}
              </p>
              <ol className="space-y-2">
                {steps.map(({ step, actorName }) => (
                  <li key={step.id} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                    <div>
                      <span className="mr-2 text-muted">{step.stepOrder}.</span>
                      {step.label}{" "}
                      <span className="text-xs text-muted">({ROLE_LABELS[step.requiredRole as Role]})</span>
                      {step.actedAt && (
                        <div className="ml-5 text-xs text-muted">
                          {actorName} · {formatWaktu(step.actedAt)}
                          {step.comment && <> — &ldquo;{step.comment}&rdquo;</>}
                        </div>
                      )}
                    </div>
                    <StepStatus status={step.status} />
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
