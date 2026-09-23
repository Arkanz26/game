import { requireAuth } from "@/server/auth/request";
import { can } from "@/server/rbac/authorize";
import { PageHeader } from "@/components/ui/page-header";
import { BankTypeBadge, GradeBadge, StageBadge } from "@/components/silika/status";
import { Badge } from "@/components/ui/badge";
import { CaseTabs } from "./tabs";
import { loadCaseOr404 } from "./load-case";

export default async function CaseLayout({ children, params }: LayoutProps<"/bdl/[bdlId]">) {
  const { bdlId } = await params;
  const ctx = await requireAuth();
  const { bdl, division } = await loadCaseOr404(ctx, bdlId);
  const target = { bdlId: bdl.id, divisionId: bdl.divisionId };
  const tabs = [
    { href: "", label: "Ringkasan" },
    ...(can(ctx, "ledger.read", target) ? [{ href: "/ledger", label: "Buku Besar Transaksi" }] : []),
    ...(can(ctx, "lapan.read", target)
      ? [
          { href: "/periods", label: "Periode & LAPAN" },
          { href: "/statements", label: "LANAP / LANIR" },
        ]
      : []),
  ];
  return (
    <>
      <PageHeader
        breadcrumbs={[{ href: "/dashboard", label: "Dashboard" }]}
        title={
          <span>
            <span className="text-muted">{bdl.code}</span> · {bdl.name}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <GradeBadge grade={bdl.grade} />
            <BankTypeBadge bankClass={bdl.bankClass} bankType={bdl.bankType} />
            <StageBadge stage={bdl.lifecycleStage} />
            {bdl.hasSeparatistCreditor && <Badge>Ada kreditur separatis</Badge>}
            <span className="ml-1 text-xs">{division.name}</span>
          </span>
        }
      />
      <CaseTabs bdlId={bdl.id} tabs={tabs} />
      {children}
    </>
  );
}
