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
    if (selected.length === 0) {
      toast.error("Select at least one table.");
      return;
    }
    if (tooSmall) {
      toast.error("The party is larger than the selected tables.");
      return;
    }
    setSaving(true);
    try {
      await api.modifyReservation(venueId, reservation.id, { tables: selected });
      await queryClient.invalidateQueries({ queryKey: ["agenda", venueId] });
      await queryClient.invalidateQueries({ queryKey: ["availability", venueId] });
      toast.success("Tables assigned");
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, "Could not assign the tables."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={reservation !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign tables</DialogTitle>
          <DialogDescription>
            {reservation
              ? `${reservation.time}, party of ${reservation.partySize}${
                  reservation.guest.name ? ` for ${reservation.guest.name}` : ""
                }.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>Tables</Label>
          {tables.length === 0 ? (
            <p className="text-sm text-muted-foreground">This venue has no tables yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tables.map((t) => (
                <Button
                  key={t.id}
                  type="button"
                  variant={selected.includes(t.id) ? "default" : "outline"}
                  size="sm"
                  aria-pressed={selected.includes(t.id)}
                  onClick={() => toggleTable(t.id)}
                >
                  {t.name} · {t.seats}
                </Button>
              ))}
            </div>
          )}
          <p className={tooSmall ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
            {totalSeats} seats selected for {partySize} guests.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={() => void onSave()}>
            {saving ? "Saving…" : "Save tables"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
