import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DietarySummary } from "@/components/dietary/dietary-summary";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useTables } from "@/hooks/use-tables";
import { api, type Reservation } from "@/lib/api";
import { useT } from "@/i18n";
import { errorMessage, isApiError } from "@/lib/error-message";
import { ConflictNotice, StoredNow } from "@/components/reservation/conflict-notice";
import { useReservationConflict } from "@/hooks/use-reservation-conflict";
import { rememberReservation, sameTables } from "@/lib/reservation-cache";

/** The statuses whose tables the engine changes. */
const ASSIGNABLE = ["booked", "seated"];

export function AssignTablesDialog({
  venueId,
  reservation,
  onOpenChange,
}: {
  venueId: string;
  reservation: Reservation | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data } = useTables(venueId);
  const tables = data?.tables ?? [];
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const { base, conflict, reread, clear, gone } = useReservationConflict(venueId, reservation);
  const closed = base !== null && !ASSIGNABLE.includes(base.status);
  const tablesTaken = !sameTables(base?.tables, reservation?.tables) && !sameTables(selected, base?.tables);

  useEffect(() => {
    setSelected(reservation?.tables ?? []);
  }, [reservation]);

  const totalSeats = useMemo(
    () =>
      tables
        .filter((t) => selected.includes(t.id))
        .reduce((sum, t) => sum + t.seats, 0),
    [tables, selected],
  );

  const partySize = base?.partySize ?? 0;
  const tooSmall = selected.length > 0 && partySize > totalSeats;

  function toggleTable(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function onSave() {
    if (!reservation || !base) return;
    if (selected.length === 0 || tooSmall) return;
    // The same tables, in any order, are no change: sending them would undo another person's move.
    if (sameTables(selected, base.tables)) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    clear();
    try {
      const saved = await api.modifyReservation(venueId, reservation.id, { tables: selected, version: base.version });
      rememberReservation(queryClient, venueId, saved);
      await queryClient.invalidateQueries({ queryKey: ["agenda", venueId] });
      await queryClient.invalidateQueries({ queryKey: ["availability", venueId] });
      toast.success(t("reservation.assign.done"));
      onOpenChange(false);
    } catch (err) {
      if (isApiError(err, "reservation_changed")) {
        const { fresh, stillShown } = await reread();
        if (!stillShown) toast.error(t("reservation.conflict.unsaved"));
        // A selection nobody touched follows what is stored now.
        else if (typeof fresh !== "string") {
          setSelected((prev) => (sameTables(prev, base.tables) ? (fresh.tables ?? []) : prev));
        }
      } else if (isApiError(err, "reservation_not_found")) gone();
      else if (isApiError(err, "party_size_too_large")) {
        // Seats can change while the dialog is open: read them again, so the dialog shows what the engine counted.
        await queryClient.invalidateQueries({ queryKey: ["tables", venueId] });
        toast.error(t("reservation.assign.refusedSeats"), { duration: 10_000 });
      } else toast.error(errorMessage(err, t("reservation.assign.failed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={reservation !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("reservation.assign.title")}</DialogTitle>
          <DialogDescription>
            {base
              ? base.guest.name
                ? t("reservation.assign.summaryNamed", { time: base.time, count: base.partySize, name: base.guest.name })
                : t("reservation.assign.summary", { time: base.time, count: base.partySize })
              : ""}
          </DialogDescription>
        </DialogHeader>

        {base?.dietary && <DietarySummary dietary={base.dietary} />}

        <div className="space-y-2">
          <Label id="assign-tables-label">{t("reservation.tables")}</Label>
          {tables.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("reservation.noTables")}</p>
          ) : (
            <div role="group" aria-labelledby="assign-tables-label" className="flex flex-wrap gap-2">
              {tables.map((tbl) => (
                <Button
                  key={tbl.id}
                  type="button"
                  variant={selected.includes(tbl.id) ? "default" : "outline"}
                  size="sm"
                  aria-pressed={selected.includes(tbl.id)}
                  onClick={() => toggleTable(tbl.id)}
                >
                  {tbl.name} · {tbl.seats}
                </Button>
              ))}
            </div>
          )}
          <p className={tooSmall ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
            {t("reservation.selected", {
              seats: t("common.seats", { count: totalSeats }),
              guests: t("common.guests", { count: partySize }),
            })}
          </p>
          {tooSmall && (
            <p role="alert" className="text-sm text-destructive">
              {t("reservation.partyTooLarge")}
            </p>
          )}
          {tablesTaken && (
            <StoredNow
              value={
                (base?.tables ?? []).map((id) => tables.find((x) => x.id === id)?.name ?? id).join(", ") ||
                t("reservation.conflict.noTables")
              }
            />
          )}
        </div>

        <ConflictNotice
          conflict={conflict}
          status={base?.status}
          openedStatus={reservation?.status}
          closed={closed}
        />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
          <Button type="button" disabled={saving || selected.length === 0 || tooSmall || closed || conflict?.kind === "gone"} onClick={() => void onSave()}>
            {saving ? t("common.saving") : t("reservation.assign.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
