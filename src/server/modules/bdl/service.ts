import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Executor } from "@/server/db/client";
import {
  approvalRequestSteps,
  approvalRequests,
  bdl,
  bdlEvents,
  bdlStageHistory,
  divisions,
  documents,
  ledgerEntries,
  ledgerPeriods,
  liquidationTeamMembers,
  users,
} from "@/server/db/schema";
import { audit } from "@/server/audit/audit";
import { bdlScope, type AuthContext } from "@/server/rbac/authorize";
import { requireBdl } from "./access";

export { STAGE_LABELS, STAGE_ORDER } from "@/lib/labels";

function scopeCondition(ctx: AuthContext): SQL | null | false {
  const scope = bdlScope(ctx, "bdl.read");
  if (scope.kind === "none") return false;
  if (scope.kind === "all") return null;
  const parts: SQL[] = [];
  if (scope.divisionIds.length) parts.push(inArray(bdl.divisionId, scope.divisionIds));
  if (scope.bdlIds.length) parts.push(inArray(bdl.id, scope.bdlIds));
  return parts.length ? or(...parts)! : false;
}

export type CaseListFilter = { q?: string; grade?: string; stage?: string; divisionId?: string };

/** Case list for the dashboard, automatically restricted to the user's scope. */
export async function listCases(exec: Executor, ctx: AuthContext, filter: CaseListFilter = {}) {
  const scope = scopeCondition(ctx);
  if (scope === false) return [];
  const conds: SQL[] = [];
  if (scope) conds.push(scope);
  if (filter.q)
    conds.push(sql`(${bdl.name} ilike ${"%" + filter.q + "%"} or ${bdl.code} ilike ${"%" + filter.q + "%"})`);
  if (filter.grade) conds.push(sql`${bdl.grade}::text = ${filter.grade}`);
  if (filter.stage) conds.push(sql`${bdl.lifecycleStage}::text = ${filter.stage}`);
  if (filter.divisionId) conds.push(eq(bdl.divisionId, filter.divisionId));

  const cases = await exec
    .select({ bdl, divisionName: divisions.name, divisionCode: divisions.code })
    .from(bdl)
    .innerJoin(divisions, eq(divisions.id, bdl.divisionId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(bdl.code));
  if (cases.length === 0) return [];
  const ids = cases.map((c) => c.bdl.id);

  const [tl, openPeriods, entryCounts, lapanDocs, pendingApprovals] = await Promise.all([
    exec
      .select({
        bdlId: liquidationTeamMembers.bdlId,
        fullName: liquidationTeamMembers.fullName,
        position: liquidationTeamMembers.position,
      })
      .from(liquidationTeamMembers)
      .where(and(inArray(liquidationTeamMembers.bdlId, ids), isNull(liquidationTeamMembers.endedAt))),
    exec
      .select()
      .from(ledgerPeriods)
      .where(and(inArray(ledgerPeriods.bdlId, ids), eq(ledgerPeriods.status, "OPEN"))),
    exec
      .select({ bdlId: ledgerEntries.bdlId, status: ledgerEntries.status, n: sql<number>`count(*)::int` })
      .from(ledgerEntries)
      .where(and(inArray(ledgerEntries.bdlId, ids), inArray(ledgerEntries.status, ["DRAFT", "SUBMITTED"])))
      .groupBy(ledgerEntries.bdlId, ledgerEntries.status),
    exec
      .select({
        bdlId: documents.bdlId,
        status: documents.status,
        periodEnd: ledgerPeriods.periodEnd,
        title: documents.title,
      })
      .from(documents)
      .innerJoin(ledgerPeriods, eq(ledgerPeriods.lapanDocumentId, documents.id))
      .where(inArray(documents.bdlId, ids))
      .orderBy(desc(ledgerPeriods.periodEnd)),
    exec
      .select({
        bdlId: documents.bdlId,
        activatedAt: approvalRequestSteps.activatedAt,
        label: approvalRequestSteps.label,
        title: documents.title,
      })
      .from(approvalRequestSteps)
      .innerJoin(approvalRequests, eq(approvalRequests.id, approvalRequestSteps.requestId))
      .innerJoin(documents, eq(documents.id, approvalRequests.documentId))
      .where(and(inArray(documents.bdlId, ids), eq(approvalRequestSteps.status, "PENDING")))
      .orderBy(asc(approvalRequestSteps.activatedAt)),
  ]);

  return cases.map(({ bdl: b, divisionName, divisionCode }) => {
    const count = (s: string) => entryCounts.find((e) => e.bdlId === b.id && e.status === s)?.n ?? 0;
    const lastLapan = lapanDocs.find((d) => d.bdlId === b.id) ?? null;
    const pending = pendingApprovals.filter((p) => p.bdlId === b.id);
    return {
      ...b,
      divisionName,
      divisionCode,
      activeTl: tl.filter((t) => t.bdlId === b.id).sort((x) => (x.position === "KETUA" ? -1 : 1)),
      openPeriod: openPeriods.find((p) => p.bdlId === b.id) ?? null,
      submittedEntries: count("SUBMITTED"),
      draftEntries: count("DRAFT"),
      lastLapan,
      oldestPendingApproval: pending[0] ?? null,
      pendingApprovalCount: pending.length,
    };
  });
}

export type CaseListRow = Awaited<ReturnType<typeof listCases>>[number];

/** Case header + profile; logs the read of confidential case data. */
export async function getCase(exec: Executor, ctx: AuthContext, bdlId: string) {
  const b = await requireBdl(exec, ctx, "bdl.read", bdlId);
  const [division] = await exec.select().from(divisions).where(eq(divisions.id, b.divisionId));
  await audit(exec, ctx, { action: "bdl.view", entityType: "bdl", entityId: b.id, bdlId: b.id });
  return { bdl: b, division };
}

export async function getCaseOverview(exec: Executor, bdlId: string) {
  const [stages, team, events, pics] = await Promise.all([
    exec.select().from(bdlStageHistory).where(eq(bdlStageHistory.bdlId, bdlId)).orderBy(asc(bdlStageHistory.enteredAt)),
    exec
      .select()
      .from(liquidationTeamMembers)
      .where(eq(liquidationTeamMembers.bdlId, bdlId))
      .orderBy(asc(liquidationTeamMembers.appointedAt)),
    exec
      .select({ event: bdlEvents, actorName: users.name })
      .from(bdlEvents)
      .leftJoin(users, eq(users.id, bdlEvents.actorId))
      .where(eq(bdlEvents.bdlId, bdlId))
      .orderBy(desc(bdlEvents.occurredAt))
      .limit(15),
    exec
      .select({ name: users.name, email: users.email })
      .from(users)
      .innerJoin(sql`user_role_assignments ura`, sql`ura.user_id = ${users.id}`)
      .where(
        sql`ura.bdl_id = ${bdlId} and ura.role = 'PIC_GLIB' and (ura.valid_to is null or ura.valid_to >= current_date)`,
      ),
  ]);
  return { stages, team, events, pics };
}
