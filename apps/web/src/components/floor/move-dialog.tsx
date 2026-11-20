import { Pill } from "@/components/pill";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n";
import type { FloorTable } from "@/lib/api";
import { guestsText } from "./guests-text";

/**
 * Move a seated reservation to a free table without dragging, which does not work on a touch screen.
 * Tables that fit the party come first. The engine decides whether a move is allowed, so a table that
 * looks too small is still offered, and a refusal shows as a message.
 */
export function MoveDialog({
  source,
  tables,
  pending,
  onMove,
  onClose,
}: {
  source: FloorTable | null;
  tables: FloorTable[];
  pending: boolean;
  onMove: (reservationId: string, targetTableId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const party = source?.partySize ?? 0;
  const targets = tables
    .filter((x) => !x.occupied && x.id !== source?.id)
    .sort((a, b) => Number(a.seats < party) - Number(b.seats < party) || a.seats - b.seats); // i18n-ok

  return (
    <Dialog open={source !== null} onOpenChange={(open) => !open && onClose()}>
      {/* Opened from a table's card, which closes; its button is not a place to send focus back to. */}
      <DialogContent onCloseAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>
            {source?.guestName
              ? t("floor.move.title", { guest: source.guestName })
              : t("floor.move.titleNoName")}
          </DialogTitle>
          <DialogDescription>
            {t("floor.move.description", { table: source?.name ?? "", guests: guestsText(party || undefined) })}
          </DialogDescription>
        </DialogHeader>
        {targets.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("floor.move.none")}</p>
        ) : (
          <ul className="-my-1 max-h-[50vh] divide-y overflow-y-auto pr-3">
            {targets.map((target) => (
              <li key={target.id}>
                <button
                  type="button"
                  disabled={pending || !source?.reservationId}
                  aria-label={t("floor.move.to", { table: target.name })}
                  onClick={() => source?.reservationId && onMove(source.reservationId, target.id)}
                  className="flex w-full items-center justify-between gap-3 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50 disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{target.name}</span>
                    <span className="block text-sm text-muted-foreground">{target.zone || t("floor.move.noZone")}</span>
                  </span>
                  <Pill tone={target.seats < party ? "warning" : "muted"}>
                    {target.seats < party
                      ? t("floor.move.tooSmall", { count: target.seats })
                      : t("common.seats", { count: target.seats })}
                  </Pill>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
