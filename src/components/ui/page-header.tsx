import Link from "next/link";

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumbs,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: { href: string; label: string }[];
}) {
  return (
    <div className="mb-5">
      {breadcrumbs && (
        <nav aria-label="Breadcrumb" className="no-print mb-1 text-xs text-muted">
          {breadcrumbs.map((b, i) => (
            <span key={b.href}>
              {i > 0 && <span className="mx-1">/</span>}
              <Link href={b.href} className="hover:text-primary hover:underline">
                {b.label}
              </Link>
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
        </div>
        {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
