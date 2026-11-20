import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { errorMessage } from "@/lib/error-message";

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

  const partySize = reservation?.partySize ?? 0;
  const tooSmall = selected.length > 0 && partySize > totalSeats;

  function toggleTable(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function onSave() {
    if (!reservation) return;
    if (selected.length === 0 || tooSmall) return;
    setSaving(true);
    try {
      await api.modifyReservation(venueId, reservation.id, { tables: selected });
      await queryClient.invalidateQueries({ queryKey: ["agenda", venueId] });
      await queryClient.invalidateQueries({ queryKey: ["availability", venueId] });
      toast.success(t("reservation.assign.done"));
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, t("reservation.assign.failed")));
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
            {reservation
              ? reservation.guest.name
                ? t("reservation.assign.summaryNamed", {
                    time: reservation.time,
                    count: reservation.partySize,
                    name: reservation.guest.name,
                  })
                : t("reservation.assign.summary", { time: reservation.time, count: reservation.partySize })
              : ""}
          </DialogDescription>
        </DialogHeader>

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
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
          <Button type="button" disabled={saving || selected.length === 0 || tooSmall} onClick={() => void onSave()}>
            {saving ? t("common.saving") : t("reservation.assign.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
