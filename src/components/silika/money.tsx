import { formatRupiah, toDecimal } from "@/lib/money";
import { cn } from "@/lib/cn";

/** Right-aligned Rupiah amount; negatives in parentheses and red. */
export function Money({
  value,
  className,
  strong,
}: {
  value: string | null | undefined;
  className?: string;
  strong?: boolean;
}) {
  const neg = toDecimal(value).isNeg();
  return (
    <span className={cn("tabular whitespace-nowrap", neg && "text-danger", strong && "font-semibold", className)}>
      {formatRupiah(value)}
    </span>
  );
}
