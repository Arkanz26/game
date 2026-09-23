"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function NavLink({ href, children, badge }: { href: string; children: React.ReactNode; badge?: number }) {
  const pathname = usePathname();
  const active =
    pathname === href || pathname.startsWith(`${href}/`) || (href === "/dashboard" && pathname.startsWith("/bdl"));
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center justify-between rounded-md px-3 py-1.5",
        active ? "bg-white/15 font-semibold" : "text-white/85 hover:bg-white/10",
      )}
    >
      {children}
      {badge !== undefined && (
        <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">{badge}</span>
      )}
    </Link>
  );
}
