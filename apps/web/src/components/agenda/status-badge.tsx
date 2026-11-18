import type { PillTone } from "@/components/pill";
import { Pill } from "@/components/pill";

const STATUS: Record<string, { label: string; tone: PillTone }> = {
  booked: { label: "Booked", tone: "info" },
  seated: { label: "Seated", tone: "success" },
  attended: { label: "Attended", tone: "muted" },
  no_show: { label: "No-show", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

export function statusLabel(status: string): string {
  return STATUS[status]?.label ?? status;
}

/** Reservation status as a colored pill with a dot, so the state reads before the label does. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = STATUS[status] ?? STATUS.attended;
  return (
    <Pill tone={s.tone} dot className={className}>
      {statusLabel(status)}
    </Pill>
  );
}
