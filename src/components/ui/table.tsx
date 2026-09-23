import { cn } from "@/lib/cn";

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)}>{children}</table>
    </div>
  );
}

export function Th({
  children,
  className,
  align,
}: {
  children?: React.ReactNode;
  className?: string;
  align?: "right" | "center";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-border bg-surface-muted px-3 py-2 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-muted uppercase",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  align,
  colSpan,
}: {
  children?: React.ReactNode;
  className?: string;
  align?: "right" | "center";
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        "border-b border-border px-3 py-2 align-top",
        align === "right" && "tabular text-right whitespace-nowrap",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </td>
  );
}
