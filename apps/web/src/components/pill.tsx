import type { ReactNode } from "react";
import { cn } from "cn";

export type PillTone = "info" | "success" | "warning" | "danger" | "muted";

const TONES: Record<PillTone, { pill: string; dot: string }> = {
  info: { pill: "bg-info-soft text-info", dot: "bg-info" },
  success: { pill: "bg-success-soft text-success", dot: "bg-success" },
  warning: { pill: "bg-warning-soft text-warning", dot: "bg-warning" },
  danger: { pill: "bg-danger-soft text-destructive", dot: "bg-destructive" },
  muted: { pill: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
};

/** Small rounded label whose color carries the meaning (the text still says it). */
export function Pill({
  tone,
  dot = false,
  className,
  children,
}: {
  tone: PillTone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        t.pill,
        className,
      )}
    >
      {dot && <span aria-hidden="true" className={cn("size-1.5 rounded-full", t.dot)} />}
      {children}
    </span>
  );
}
