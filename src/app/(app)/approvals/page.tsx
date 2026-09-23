import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/server/db/client";
import { requireAuth } from "@/server/auth/request";
import { listInbox, GATE_KAP_AUDIT } from "@/server/modules/approval/workflow.service";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { GradeBadge } from "@/components/silika/status";
import { ROLE_LABELS, type Role } from "@/server/rbac/permissions";
import { daysBetween, formatWaktu } from "@/lib/dates";
import { DecisionForm } from "./decision-form";

export const metadata: Metadata = { title: "Antrian Persetujuan" };

function isPastDue(due: Date | null): boolean {
  return !!due && due.getTime() < Date.now();
}

export default async function ApprovalsPage() {
  const ctx = await requireAuth();
  const inbox = await listInbox(db, ctx);
  return (
    <>
      <PageHeader
        title="Antrian Persetujuan"
        subtitle="Dokumen yang menunggu tindakan sesuai peran dan cakupan Anda, diurutkan dari yang paling lama."
      />
      <Card>
        <CardHeader title={`${inbox.length} dokumen menunggu`} />
        {inbox.length === 0 ? (
          <EmptyState title="Tidak ada dokumen yang menunggu tindakan Anda" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Dokumen</Th>
                <Th>BDL</Th>
                <Th>Tahap</Th>
                <Th>Umur</Th>
                <Th className="w-80">Keputusan</Th>
              </tr>
            </thead>
            <tbody>
              {inbox.map(({ step, request, document, bdl, submitterName }) => {
                const age = step.activatedAt ? daysBetween(step.activatedAt) : 0;
                const overdue = isPastDue(step.dueAt);
                const ctxInfo = request.resolutionContext as {
                  rule?: { code: string; version: number };
                  requiresKapAudit?: boolean;
                };
                return (
                  <tr key={step.id}>
                    <Td>
                      <Link href={`/documents/${document.id}`} className="font-medium text-primary hover:underline">
                        {document.title}
                      </Link>
                      <div className="text-xs text-muted">
                        v{request.documentVersionNo} · diajukan {submitterName} · {formatWaktu(request.submittedAt)}
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        Aturan {ctxInfo.rule?.code} v{ctxInfo.rule?.version}
                        {ctxInfo.requiresKapAudit && (
                          <Badge tone="warning" className="ml-1">
                            Wajib audit KAP
                          </Badge>
                        )}
                      </div>
                    </Td>
                    <Td>
                      <Link href={`/bdl/${bdl.id}`} className="hover:underline">
                        {bdl.code}
                      </Link>
                      <div className="text-xs text-muted">{bdl.name}</div>
                      <GradeBadge grade={bdl.grade} />
                    </Td>
                    <Td className="text-xs">
                      <div className="font-medium">
                        {step.stepOrder}. {step.label}
                      </div>
                      <div className="text-muted">{ROLE_LABELS[step.requiredRole as Role]}</div>
                    </Td>
                    <Td className="text-xs whitespace-nowrap">
                      <span className={overdue ? "font-semibold text-danger" : ""}>{age} hari</span>
                      {overdue && <div className="text-danger">lewat SLA</div>}
                    </Td>
                    <Td>
                      <DecisionForm stepId={step.id} kapGate={step.isGate && step.gateCode === GATE_KAP_AUDIT} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
