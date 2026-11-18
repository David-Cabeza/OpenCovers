import type { ReactNode } from "react";
import { cn } from "cn";

/** One number with its label, for the summary strip at the top of a view. */
export function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4",
        tone === "warning" && "border-transparent bg-warning-soft text-warning",
        tone === "danger" && "border-transparent bg-danger-soft text-destructive",
      )}
    >
      <div className={cn("text-sm", tone === "default" ? "text-muted-foreground" : "opacity-90")}>
        {label}
      </div>
      <div className="mt-1 font-display text-3xl whitespace-nowrap tabular-nums sm:text-4xl">{value}</div>
    </div>
  );
}
