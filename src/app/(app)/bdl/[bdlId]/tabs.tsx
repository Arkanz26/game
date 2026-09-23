"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function CaseTabs({ bdlId, tabs }: { bdlId: string; tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const base = `/bdl/${bdlId}`;
  return (
    <nav className="no-print mb-5 flex gap-1 border-b border-border" aria-label="Bagian case file">
      {tabs.map((t) => {
        const href = `${base}${t.href}`;
        const active = t.href === "" ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={t.href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              active
                ? "border-primary font-semibold text-primary"
                : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
