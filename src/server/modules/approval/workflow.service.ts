import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Executor, Tx } from "@/server/db/client";
import { withTx } from "@/server/db/tx";
import {
  approvalChainSteps,
  approvalChainTemplates,
  approvalMatrixRules,
  approvalRequestSteps,
  approvalRequests,
  bdl,
  documentTypes,
  documents,
  users,
} from "@/server/db/schema";
import { audit } from "@/server/audit/audit";
import { DomainError, NotFoundError } from "@/server/errors";
import { ForbiddenError, can, hasRoleFor, type AuthContext } from "@/server/rbac/authorize";
import { ROLE_LABELS, type Role } from "@/server/rbac/permissions";
import { todayWib, type IsoDate } from "@/lib/dates";
import type { MoneyString } from "@/lib/money";
import { getChainTemplate, getMatrixRules, getParameters } from "../config/effective";
import { loadBdl, bdlTarget } from "../bdl/access";
import { loadDocument, recordEvent, type DocumentRow } from "../documents/service";
import { MatrixResolutionError, resolveMatrixRule, type MatrixRule } from "./matrix-resolver";
import { onApprovalCompleted, onApprovalReturned } from "./outcomes";

export const GATE_KAP_AUDIT = "KAP_AUDIT_ATTACHED";

/**
 * Resolves the approval chain for a document from the approval matrix in force on the
 * reference date and starts a request. The rule/template ids and the facts used are
 * snapshotted on the request so the decision path is reproducible for auditors.
 */
export async function submitForApproval(
  tx: Tx,
  ctx: AuthContext,
  input: { documentId: string; documentAmount?: MoneyString | null; referenceDate?: IsoDate },
) {
  const doc = await loadDocument(tx, input.documentId);
  const b = await loadBdl(tx, doc.bdlId);
  const [pending] = await tx
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(and(eq(approvalRequests.documentId, doc.id), eq(approvalRequests.status, "PENDING")));
  if (pending) throw new DomainError("Dokumen ini sudah dalam proses persetujuan");

  // Rules are bound to the regulation in force when the document was created, not today's.
  const asOf = input.referenceDate ?? todayWib(doc.createdAt);
  const rules = await getMatrixRules(tx, doc.documentTypeCode, asOf);
  const params = await getParameters(tx, asOf);
  const facts = {
    documentTypeCode: doc.documentTypeCode,
    grade: b.grade,
    bankType: b.bankType,
    hasSeparatistCreditor: b.hasSeparatistCreditor,
    insuredDeposits: b.insuredDepositsAmount,
    documentAmount: input.documentAmount ?? null,
  };
  let resolved;
  try {
    resolved = resolveMatrixRule(rules as MatrixRule[], facts, params);
  } catch (e) {
    if (e instanceof MatrixResolutionError) throw new DomainError(e.message);
    throw e;
  }
  const { template, steps } = await getChainTemplate(tx, resolved.rule.chainTemplateCode, asOf);
  if (steps.length === 0) throw new DomainError(`Template ${template.code} tidak memiliki langkah`);

  const now = new Date();
  const [req] = await tx
    .insert(approvalRequests)
    .values({
      documentId: doc.id,
      documentVersionNo: doc.currentVersionNo,
      matrixRuleId: resolved.rule.id,
      chainTemplateId: template.id,
      resolutionContext: {
        asOf,
        facts,
        parameters: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v])),
        rule: { code: resolved.rule.code, version: resolved.rule.version, specificity: resolved.specificity },
        template: { code: template.code, version: template.version },
        requiresKapAudit: resolved.rule.requiresKapAudit,
      },
      currentStepOrder: steps[0].stepOrder,
      submittedBy: ctx.user.id,
    })
    .returning();
  await tx.insert(approvalRequestSteps).values(
    steps.map((s, i) => ({
      requestId: req.id,
      stepOrder: s.stepOrder,
      label: s.label,
      requiredRole: s.requiredRole,
      scope: s.scope,
      isGate: s.isGate,
      gateCode: s.gateCode,
      status: i === 0 ? ("PENDING" as const) : ("WAITING" as const),
      activatedAt: i === 0 ? now : null,
      dueAt: i === 0 ? new Date(now.getTime() + s.slaDays * 86_400_000) : null,
    })),
  );
  await tx.update(documents).set({ status: "IN_REVIEW", updatedAt: now }).where(eq(documents.id, doc.id));
  await audit(tx, ctx, {
    action: "approval.submit",
    entityType: "approval_request",
    entityId: req.id,
    bdlId: doc.bdlId,
    after: { documentId: doc.id, version: doc.currentVersionNo, rule: resolved.rule.code, template: template.code },
  });
  await recordEvent(tx, ctx, {
    bdlId: doc.bdlId,
    eventType: "APPROVAL_SUBMITTED",
    title: `${doc.title} diajukan untuk persetujuan (${template.name})`,
    refEntityType: "document",
    refEntityId: doc.id,
  });
  return req;
}

export type Decision = "APPROVE" | "RETURN";

export async function actOnStep(
  ctx: AuthContext,
  stepId: string,
  input: { decision: Decision; comment?: string; gateEvidence?: string },
): Promise<void> {
  await withTx(ctx, async (tx) => {
    const [step] = await tx.select().from(approvalRequestSteps).where(eq(approvalRequestSteps.id, stepId));
    if (!step) throw new NotFoundError("Langkah persetujuan");
    const [req] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, step.requestId)).for("update");
    if (req.status !== "PENDING" || step.status !== "PENDING" || req.currentStepOrder !== step.stepOrder) {
      throw new DomainError("Langkah ini tidak sedang menunggu tindakan");
    }
    const doc = await loadDocument(tx, req.documentId);
    const b = await loadBdl(tx, doc.bdlId);
    if (!hasRoleFor(ctx, step.requiredRole as Role, bdlTarget(b), { requireGlobal: step.scope === "GLOBAL" })) {
      throw new ForbiddenError(`Langkah ini memerlukan peran ${ROLE_LABELS[step.requiredRole as Role]}`);
    }
    // Segregation of duties: the submitter cannot sign off a hierarchical step and nobody signs twice.
    if (!step.isGate && req.submittedBy === ctx.user.id) {
      throw new DomainError("Pengaju dokumen tidak dapat menyetujui dokumennya sendiri");
    }
    const others = await tx
      .select()
      .from(approvalRequestSteps)
      .where(eq(approvalRequestSteps.requestId, req.id))
      .orderBy(asc(approvalRequestSteps.stepOrder));
    if (others.some((s) => s.id !== step.id && s.actedBy === ctx.user.id && s.status === "APPROVED" && !s.isGate)) {
      throw new DomainError("Anda sudah menyetujui langkah lain pada permohonan ini");
    }

    const comment = input.comment?.trim() || null;
    const now = new Date();
    if (input.decision === "RETURN") {
      if (!comment) throw new DomainError("Catatan wajib diisi saat mengembalikan dokumen");
      await tx
        .update(approvalRequestSteps)
        .set({ status: "RETURNED", actedBy: ctx.user.id, actedAt: now, comment })
        .where(eq(approvalRequestSteps.id, step.id));
      await tx
        .update(approvalRequestSteps)
        .set({ status: "SKIPPED" })
        .where(and(eq(approvalRequestSteps.requestId, req.id), eq(approvalRequestSteps.status, "WAITING")));
      await tx
        .update(approvalRequests)
        .set({ status: "RETURNED", completedAt: now, currentStepOrder: null })
        .where(eq(approvalRequests.id, req.id));
      await tx.update(documents).set({ status: "REJECTED", updatedAt: now }).where(eq(documents.id, doc.id));
      await onApprovalReturned(tx, ctx, doc);
      await audit(tx, ctx, {
        action: "approval.return",
        entityType: "approval_request",
        entityId: req.id,
        bdlId: doc.bdlId,
        after: { step: step.stepOrder, comment },
      });
      await recordEvent(tx, ctx, {
        bdlId: doc.bdlId,
        eventType: "APPROVAL_RETURNED",
        title: `${doc.title} dikembalikan pada tahap ${step.label}`,
        refEntityType: "document",
        refEntityId: doc.id,
      });
      return;
    }

    let stepComment = comment;
    if (step.isGate && step.gateCode === GATE_KAP_AUDIT) {
      const evidence = input.gateEvidence?.trim();
      if (!evidence) throw new DomainError("Nomor/rujukan laporan audit KAP wajib diisi");
      stepComment = [`Laporan audit KAP: ${evidence}`, comment].filter(Boolean).join(" — ");
      await tx
        .update(documents)
        .set({ metadata: { ...doc.metadata, kapAuditRef: evidence } })
        .where(eq(documents.id, doc.id));
    }
    await tx
      .update(approvalRequestSteps)
      .set({ status: "APPROVED", actedBy: ctx.user.id, actedAt: now, comment: stepComment })
      .where(eq(approvalRequestSteps.id, step.id));

    const next = others.find((s) => s.stepOrder > step.stepOrder && s.status === "WAITING");
    if (next) {
      const [tplStep] = await tx
        .select({ slaDays: approvalChainSteps.slaDays })
        .from(approvalChainSteps)
        .where(
          and(eq(approvalChainSteps.templateId, req.chainTemplateId), eq(approvalChainSteps.stepOrder, next.stepOrder)),
        );
      const slaDays = tplStep?.slaDays ?? 5;
      await tx
        .update(approvalRequestSteps)
        .set({ status: "PENDING", activatedAt: now, dueAt: new Date(now.getTime() + slaDays * 86_400_000) })
        .where(eq(approvalRequestSteps.id, next.id));
      await tx
        .update(approvalRequests)
        .set({ currentStepOrder: next.stepOrder })
        .where(eq(approvalRequests.id, req.id));
      await audit(tx, ctx, {
        action: "approval.approve_step",
        entityType: "approval_request",
        entityId: req.id,
        bdlId: doc.bdlId,
        after: { step: step.stepOrder, next: next.stepOrder, comment: stepComment },
      });
      return;
    }

    const [type] = await tx.select().from(documentTypes).where(eq(documentTypes.code, doc.documentTypeCode));
    await tx
      .update(approvalRequests)
      .set({ status: "APPROVED", completedAt: now, currentStepOrder: null })
      .where(eq(approvalRequests.id, req.id));
    await tx
      .update(documents)
      .set({ status: type.locksOnApproval ? "LOCKED" : "APPROVED", updatedAt: now })
      .where(eq(documents.id, doc.id));
    await audit(tx, ctx, {
      action: "approval.complete",
      entityType: "approval_request",
      entityId: req.id,
      bdlId: doc.bdlId,
      after: { step: step.stepOrder, documentStatus: type.locksOnApproval ? "LOCKED" : "APPROVED" },
    });
    await recordEvent(tx, ctx, {
      bdlId: doc.bdlId,
      eventType: "APPROVAL_COMPLETED",
      title: `${doc.title} disetujui`,
      refEntityType: "document",
      refEntityId: doc.id,
    });
    await onApprovalCompleted(tx, ctx, doc);
  });
}

/** Steps currently waiting on this user (role + scope), oldest first. */
export async function listInbox(exec: Executor, ctx: AuthContext) {
  if (!can(ctx, "approval.act")) return [];
  const myRoles = [...new Set(ctx.assignments.map((a) => a.role))];
  const rows = await exec
    .select({
      step: approvalRequestSteps,
      request: approvalRequests,
      document: {
        id: documents.id,
        title: documents.title,
        type: documents.documentTypeCode,
        periodId: documents.periodId,
        versionNo: documents.currentVersionNo,
      },
      bdl: { id: bdl.id, code: bdl.code, name: bdl.name, divisionId: bdl.divisionId, grade: bdl.grade },
      submitterName: users.name,
    })
    .from(approvalRequestSteps)
    .innerJoin(approvalRequests, eq(approvalRequests.id, approvalRequestSteps.requestId))
    .innerJoin(documents, eq(documents.id, approvalRequests.documentId))
    .innerJoin(bdl, eq(bdl.id, documents.bdlId))
    .innerJoin(users, eq(users.id, approvalRequests.submittedBy))
    .where(and(eq(approvalRequestSteps.status, "PENDING"), inArray(approvalRequestSteps.requiredRole, myRoles)))
    .orderBy(asc(approvalRequestSteps.activatedAt));
  return rows.filter((r) =>
    hasRoleFor(
      ctx,
      r.step.requiredRole as Role,
      { bdlId: r.bdl.id, divisionId: r.bdl.divisionId },
      { requireGlobal: r.step.scope === "GLOBAL" },
    ),
  );
}

/** Approval history of a document, including which matrix rule/template version applied. */
export async function getApprovalTrail(exec: Executor, documentId: string) {
  const requests = await exec
    .select({ request: approvalRequests, rule: approvalMatrixRules, template: approvalChainTemplates })
    .from(approvalRequests)
    .innerJoin(approvalMatrixRules, eq(approvalMatrixRules.id, approvalRequests.matrixRuleId))
    .innerJoin(approvalChainTemplates, eq(approvalChainTemplates.id, approvalRequests.chainTemplateId))
    .where(eq(approvalRequests.documentId, documentId))
    .orderBy(desc(approvalRequests.submittedAt));
  if (requests.length === 0) return [];
  const steps = await exec
    .select({ step: approvalRequestSteps, actorName: users.name })
    .from(approvalRequestSteps)
    .leftJoin(users, eq(users.id, approvalRequestSteps.actedBy))
    .where(
      inArray(
        approvalRequestSteps.requestId,
        requests.map((r) => r.request.id),
      ),
    )
    .orderBy(asc(approvalRequestSteps.stepOrder));
  return requests.map((r) => ({ ...r, steps: steps.filter((s) => s.step.requestId === r.request.id) }));
}

export type { DocumentRow };
