import { Pill } from "@/components/pill";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FloorTable } from "@/lib/api";

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
  const party = source?.partySize ?? 0;
  const targets = tables
    .filter((t) => !t.occupied && t.id !== source?.id)
    .sort((a, b) => Number(a.seats < party) - Number(b.seats < party) || a.seats - b.seats);

  return (
    <Dialog open={source !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move {source?.guestName || "reservation"}</DialogTitle>
          <DialogDescription>
            Now at {source?.name}, {party || "?"} {party === 1 ? "guest" : "guests"}. Pick a free table.
          </DialogDescription>
        </DialogHeader>
        {targets.length === 0 ? (
          <p className="text-sm text-muted-foreground">There are no free tables right now.</p>
        ) : (
          <ul className="-my-1 max-h-[50vh] divide-y overflow-y-auto pr-3">
            {targets.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  disabled={pending || !source?.reservationId}
                  aria-label={`Move to ${t.name}`}
                  onClick={() => source?.reservationId && onMove(source.reservationId, t.id)}
                  className="flex w-full items-center justify-between gap-3 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50 disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{t.name}</span>
                    <span className="block text-sm text-muted-foreground">{t.zone || "No zone"}</span>
                  </span>
                  <Pill tone={t.seats < party ? "warning" : "muted"}>
                    {t.seats < party ? `${t.seats} seats, too small` : `${t.seats} ${t.seats === 1 ? "seat" : "seats"}`}
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
