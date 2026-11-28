import { useEffect, useRef } from "react";
import { statusLabel } from "@/components/agenda/status-badge";
import type { Conflict } from "@/hooks/use-reservation-conflict";
import { useT } from "@/i18n";

/**
 * Why a dialog did not save, next to its buttons and read out when it appears. It never holds what was recorded about
 * the guest.
 */
export function ConflictNotice({
  conflict,
  status,
  openedStatus,
  closed,
}: {
  conflict: Conflict | null;
  /** The status stored now. */
  status?: string;
  openedStatus?: string;
  /** The stored status no longer takes this dialog's changes. */
  closed: boolean;
}) {
  const t = useT();
  const alert = useRef<HTMLParagraphElement>(null);
  // What the refusal adds above can push it off a short screen. Centred, the buttons under it show too.
  useEffect(() => {
    if (conflict) alert.current?.scrollIntoView?.({ block: "center" });
  }, [conflict]);
  if (!conflict) return null;
  const now = { status: statusLabel(status ?? "") };
  let text: string;
  if (conflict.kind !== "changed") {
    text = t(`reservation.conflict.${conflict.kind}`);
  } else if (closed) {
    text = t(conflict.withdrawn ? "reservation.conflict.withdrawnClosed" : "reservation.conflict.closed", now);
  } else {
    text = t(conflict.withdrawn ? "reservation.conflict.withdrawn" : "reservation.conflict.changed");
    if (status !== openedStatus) text = `${text} ${t("reservation.conflict.status", now)}`;
  }
  return (
    <p ref={alert} role="alert" className="rounded-lg border-2 border-destructive bg-danger-soft px-3 py-2 text-sm">
      {text}
    </p>
  );
}

/** Under a field that someone else also changed: what is stored, so that saving over it is a choice. */
export function StoredNow({ id, value }: { id?: string; value: string }) {
  const t = useT();
  return (
    <p id={id} className="text-sm font-medium whitespace-pre-line [overflow-wrap:anywhere]">
      {t("reservation.conflict.storedNow", { value })}
    </p>
  );
}
