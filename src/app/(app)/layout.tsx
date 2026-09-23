import Link from "next/link";
import { requireAuth } from "@/server/auth/request";
import { db } from "@/server/db/client";
import { listInbox } from "@/server/modules/approval/workflow.service";
import { can, roles } from "@/server/rbac/authorize";
import { ROLE_LABELS } from "@/server/rbac/permissions";
import { logoutAction } from "../(auth)/login/actions";
import { NavLink } from "./nav-link";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireAuth();
  const inbox = await listInbox(db, ctx);
  const myRoles = roles(ctx);
  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 flex h-screen w-60 shrink-0 flex-col overflow-y-auto bg-primary text-white">
        <div className="border-b border-white/10 px-5 py-4">
          <Link href="/dashboard" className="block text-lg font-bold tracking-tight">
            SILIKA
          </Link>
          <div className="text-[11px] text-white/60">Sistem Informasi Likuidasi Bank</div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3 py-4 text-sm" aria-label="Navigasi utama">
          {can(ctx, "bdl.read") && <NavLink href="/dashboard">Dashboard Kasus</NavLink>}
          {can(ctx, "approval.act") && (
            <NavLink href="/approvals" badge={inbox.length || undefined}>
              Antrian Persetujuan
            </NavLink>
          )}
          <div className="px-3 pt-5 pb-1 text-[11px] font-semibold tracking-wider text-white/40 uppercase">
            Segera hadir
          </div>
          {["Repository Dokumen", "TL Governance", "Regulasi", "Drafting ND/KADK"].map((label) => (
            <span key={label} className="block cursor-default rounded-md px-3 py-1.5 text-white/40">
              {label}
            </span>
          ))}
        </nav>
        <div className="border-t border-white/10 px-5 py-4 text-xs">
          <div className="font-semibold">{ctx.user.name}</div>
          <div className="text-white/60">{myRoles.map((r) => ROLE_LABELS[r]).join(", ") || "Tanpa peran"}</div>
          <form action={logoutAction} className="mt-3">
            <button
              type="submit"
              className="rounded border border-white/25 px-2.5 py-1 text-white/85 hover:bg-white/10"
            >
              Keluar
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-6">{children}</main>
    </div>
  );
}
