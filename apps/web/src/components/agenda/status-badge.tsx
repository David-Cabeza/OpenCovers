import type { PillTone } from "@/components/pill";
import { Pill } from "@/components/pill";
import { t, useT, type MessageKey } from "@/i18n";

const STATUS: Record<string, { labelKey: MessageKey; tone: PillTone }> = {
  booked: { labelKey: "common.status.booked", tone: "info" },
  seated: { labelKey: "common.status.seated", tone: "success" },
  attended: { labelKey: "common.status.attended", tone: "muted" },
  no_show: { labelKey: "common.status.noShow", tone: "warning" },
  cancelled: { labelKey: "common.status.cancelled", tone: "danger" },
};

export function statusLabel(status: string): string {
  const entry = STATUS[status];
  return entry ? t(entry.labelKey) : status;
}

/** Reservation status as a colored pill with a dot, so the state reads before the label does. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const translate = useT();
  const s = STATUS[status] ?? STATUS.attended;
  return (
    <Pill tone={s.tone} dot className={className}>
      {STATUS[status] ? translate(s.labelKey) : status}
    </Pill>
  );
}
