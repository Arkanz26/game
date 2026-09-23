import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { documentVersions, users } from "@/server/db/schema";
import { requireAuth } from "@/server/auth/request";
import { audit } from "@/server/audit/audit";
import { loadDocument } from "@/server/modules/documents/service";
import { loadBdl } from "@/server/modules/bdl/access";
import { getApprovalTrail } from "@/server/modules/approval/workflow.service";
import type { LapanSnapshot } from "@/server/modules/reporting/lapan.service";
import { can } from "@/server/rbac/authorize";
import { NotFoundError } from "@/server/errors";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { LapanView } from "@/components/silika/lapan-view";
import { ApprovalTrail } from "@/components/silika/approval-trail";
import { DocumentStatus } from "@/components/silika/status";
import { Money } from "@/components/silika/money";
import { ACCOUNT_CLASS_LABELS } from "@/lib/labels";
import { formatTanggal, formatWaktu } from "@/lib/dates";

export const metadata: Metadata = { title: "Dokumen" };

type StatementContent = {
  kind: "LANAP" | "LANIR";
  asOfDate: string;
  accounts: { code: string; name: string; accountClass: string; amount: string }[];
  totals: { assets: string; liabilities: string; netAssets: string };
};
type CorrectionContent = { kind: "KOREKSI_PERIODE"; reason: string; targetPeriod: { start: string; end: string } };

export default async function DocumentPage({ params, searchParams }: PageProps<"/documents/[documentId]">) {
  const { documentId } = await params;
  const sp = await searchParams;
  const ctx = await requireAuth();
  const doc = await loadDocument(db, documentId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const bdl = await loadBdl(db, doc.bdlId);
  // Document-level access currently follows BDL scope (document_access_grants add finer control later).
  if (!can(ctx, "lapan.read", { bdlId: bdl.id, divisionId: bdl.divisionId })) notFound();

  const versions = await db
    .select({ v: documentVersions, author: users.name })
    .from(documentVersions)
    .innerJoin(users, eq(users.id, documentVersions.createdBy))
    .where(eq(documentVersions.documentId, doc.id))
    .orderBy(desc(documentVersions.versionNo));
  const requested = Number(sp.v);
  const shown =
    versions.find((x) => x.v.versionNo === requested) ??
    versions.find((x) => x.v.versionNo === doc.currentVersionNo) ??
    versions[0];
  const trail = await getApprovalTrail(db, doc.id);
  await audit(db, ctx, {
    action: "document.view",
    entityType: "document",
    entityId: doc.id,
    bdlId: bdl.id,
    after: { version: shown?.v.versionNo },
  });
  const content = shown?.v.contentJson as { kind?: string } | null;

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { href: "/dashboard", label: "Dashboard" },
          { href: `/bdl/${bdl.id}`, label: bdl.code },
        ]}
        title={doc.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <DocumentStatus status={doc.status} /> <span>{bdl.name}</span>
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-4">
        <div className="space-y-5 xl:col-span-3">
          {content?.kind === "LAPAN" && (
            <LapanView
              result={(content as LapanSnapshot).result}
              openingLabel={`dasar LANAP ${formatTanggal((content as LapanSnapshot).baseline.asOfDate)}`}
              closingLabel={formatTanggal((content as LapanSnapshot).period.end)}
            />
          )}
          {(content?.kind === "LANAP" || content?.kind === "LANIR") && (
            <StatementView content={content as StatementContent} />
          )}
          {content?.kind === "KOREKSI_PERIODE" && (
            <Card>
              <CardHeader title="Permohonan koreksi periode terkunci" />
              <CardBody>
                <DefinitionList
                  items={[
                    [
                      "Periode yang dikoreksi",
                      `${formatTanggal((content as CorrectionContent).targetPeriod.start)} s.d. ${formatTanggal((content as CorrectionContent).targetPeriod.end)}`,
                    ],
                    ["Alasan", (content as CorrectionContent).reason],
                  ]}
                />
              </CardBody>
            </Card>
          )}
          <ApprovalTrail trail={trail} />
        </div>
        <Card>
          <CardHeader title="Versi dokumen" description="Setiap versi immutable & ter-hash" />
          <ul className="divide-y divide-border text-sm">
            {versions.map(({ v, author }) => (
              <li key={v.id} className="px-4 py-2.5">
                <Link
                  href={`/documents/${doc.id}?v=${v.versionNo}`}
                  className={
                    v.versionNo === shown?.v.versionNo ? "font-semibold text-primary" : "text-primary hover:underline"
                  }
                >
                  Versi {v.versionNo}
                </Link>
                <div className="text-xs text-muted">
                  {formatWaktu(v.createdAt)} · {author}
                </div>
                <div className="text-xs text-muted">{v.changeNote}</div>
                <div className="font-mono text-[10px] break-all text-muted/80">{v.sha256}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

function StatementView({ content }: { content: StatementContent }) {
  return (
    <Card>
      <CardHeader title={`${content.kind} per ${formatTanggal(content.asOfDate)}`} />
      <Table>
        <thead>
          <tr>
            <Th>Akun</Th>
            <Th>Kelompok</Th>
            <Th align="right">Saldo</Th>
          </tr>
        </thead>
        <tbody>
          {content.accounts
            .filter((a) => a.amount !== "0.00")
            .map((a) => (
              <tr key={a.code}>
                <Td>{a.name}</Td>
                <Td className="text-xs text-muted">{ACCOUNT_CLASS_LABELS[a.accountClass]}</Td>
                <Td align="right">
                  <Money value={a.amount} />
                </Td>
              </tr>
            ))}
          <tr className="bg-surface-muted/60 font-semibold">
            <Td colSpan={2}>Total aset (neto PPAP)</Td>
            <Td align="right">
              <Money value={content.totals.assets} />
            </Td>
          </tr>
          <tr className="bg-surface-muted/60 font-semibold">
            <Td colSpan={2}>Total kewajiban</Td>
            <Td align="right">
              <Money value={content.totals.liabilities} />
            </Td>
          </tr>
          <tr className="bg-primary-soft font-semibold">
            <Td colSpan={2}>Aset neto</Td>
            <Td align="right">
              <Money value={content.totals.netAssets} />
            </Td>
          </tr>
        </tbody>
      </Table>
    </Card>
  );
}
