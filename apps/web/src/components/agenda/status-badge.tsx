import { cn } from "cn";

const STATUS: Record<string, { label: string; tone: string; dot: string }> = {
  booked: { label: "Booked", tone: "bg-info-soft text-info", dot: "bg-info" },
  seated: { label: "Seated", tone: "bg-success-soft text-success", dot: "bg-success" },
  attended: { label: "Attended", tone: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
  no_show: { label: "No-show", tone: "bg-warning-soft text-warning", dot: "bg-warning" },
  cancelled: { label: "Cancelled", tone: "bg-danger-soft text-destructive", dot: "bg-destructive" },
};

export function statusLabel(status: string): string {
  return STATUS[status]?.label ?? status;
}

/** Reservation status as a colored pill with a dot, so the state reads before the label does. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = STATUS[status] ?? STATUS.attended;
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        s.tone,
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", s.dot)} />
      {statusLabel(status)}
    </span>
  );
}
