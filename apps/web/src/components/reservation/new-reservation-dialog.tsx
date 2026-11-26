import { errorMessage } from "@/lib/error-message";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAgenda } from "@/hooks/use-agenda";
import { useTables } from "@/hooks/use-tables";
import { useT } from "@/i18n";
import { ApiError, api, COMMENTARY_MAX } from "@/lib/api";
import { longDate } from "@/lib/date";

/** The API holds a table this long when the venue sets no turn time; it does not expose the venue's own. */
const HELD_MINUTES = 120;

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

interface FormValues {
  partySize: number;
  name: string;
  contact: string;
  commentary: string;
}

interface NewReservationDialogProps {
  venueId: string;
  date: string;
  time: string;
  partySize: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Show a time field, for callers that open the dialog without a chosen slot. */
  timeEditable?: boolean;
}

export function NewReservationDialog({
  venueId,
  date,
  time: initialTime,
  partySize,
  open,
  onOpenChange,
  timeEditable = false,
}: NewReservationDialogProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data } = useTables(venueId);
  const tables = data?.tables ?? [];
  const { data: agenda } = useAgenda(venueId, date);
  const [selected, setSelected] = useState<string[]>([]);
  const [time, setTime] = useState(initialTime);
  const [tableError, setTableError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { partySize, name: "", contact: "", commentary: "" },
  });

  const watchedPartySize = Number(watch("partySize")) || 0;

  const totalSeats = useMemo(
    () =>
      tables
        .filter((t) => selected.includes(t.id))
        .reduce((sum, t) => sum + t.seats, 0),
    [tables, selected],
  );

  // Tables held by a booked or seated reservation whose hold overlaps the chosen time, with the guest's name.
  const busy = useMemo(() => {
    const map = new Map<string, string>();
    const at = minutesOf(time);
    for (const r of agenda?.reservations ?? []) {
      if (r.status !== "booked" && r.status !== "seated") continue;
      if (Math.abs(minutesOf(r.time) - at) >= HELD_MINUTES) continue;
      for (const id of r.tables ?? []) map.set(id, r.guest.name ?? "");
    }
    return map;
  }, [agenda, time]);

  useEffect(() => {
    setSelected((prev) => (prev.some((id) => busy.has(id)) ? prev.filter((id) => !busy.has(id)) : prev));
  }, [busy]);

  useEffect(() => {
    if (open) {
      reset({ partySize, name: "", contact: "", commentary: "" });
      setSelected([]);
      setTableError(null);
    }
  }, [open, partySize, reset]);

  useEffect(() => {
    if (open) setTime(initialTime);
  }, [open, initialTime]);

  function toggleTable(id: string) {
    if (busy.has(id)) return;
    setTableError(null);
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function onSubmit(values: FormValues) {
    if (selected.length === 0) {
      setTableError(t("reservation.selectTable"));
      return;
    }
    if (values.partySize > totalSeats) {
      setTableError(t("reservation.partyTooLarge"));
      return;
    }
    try {
      await api.createReservation(venueId, {
        date,
        time,
        partySize: values.partySize,
        tables: selected,
        guest: {
          name: values.name || undefined,
          contact: values.contact || undefined,
        },
        commentary: values.commentary.trim() || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["agenda", venueId] });
      await queryClient.invalidateQueries({ queryKey: ["availability", venueId] });
      toast.success(t("reservation.new.done"));
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "slot_taken") {
        setTableError(errorMessage(err, t("reservation.new.failed")));
        void queryClient.invalidateQueries({ queryKey: ["agenda", venueId] });
        return;
      }
      toast.error(errorMessage(err, t("reservation.new.failed")));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("reservation.new.title")}</DialogTitle>
          <DialogDescription>
            {t("reservation.new.description", { date: longDate(date), time })}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {timeEditable && (
            <div className="space-y-2">
              <Label htmlFor="reservation-time">{t("floor.time")}</Label>
              <Input
                id="reservation-time"
                type="time"
                required
                value={time}
                onChange={(e) => {
                  setTime(e.target.value);
                  setTableError(null);
                }}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="party-size">{t("reservation.partySize")}</Label>
            <Input
              id="party-size"
              type="number"
              min={1}
              {...register("partySize", {
                valueAsNumber: true,
                required: t("reservation.partySizeRequired"),
                min: { value: 1, message: t("reservation.atLeastOne") },
              })}
            />
            {errors.partySize && (
              <p className="text-sm text-destructive">{errors.partySize.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label id="new-reservation-tables-label">{t("reservation.tables")}</Label>
            {tables.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("reservation.noTables")}
              </p>
            ) : (
              <div
                role="group"
                aria-labelledby="new-reservation-tables-label"
                aria-invalid={tableError ? true : undefined}
                aria-describedby={tableError ? "new-reservation-tables-error" : undefined}
                className="flex flex-wrap gap-2"
              >
                {tables.map((tbl) => {
                  const isBusy = busy.has(tbl.id);
                  const why = [t("reservation.tableBusy"), busy.get(tbl.id)].filter(Boolean).join(" · ");
                  return (
                    <Button
                      key={tbl.id}
                      type="button"
                      variant={selected.includes(tbl.id) ? "default" : "outline"}
                      size="sm"
                      aria-pressed={selected.includes(tbl.id)}
                      aria-disabled={isBusy || undefined}
                      aria-describedby={isBusy ? `new-reservation-busy-${tbl.id}` : undefined}
                      className={isBusy ? "h-auto flex-col gap-0 py-1 cursor-not-allowed border-dashed bg-muted text-muted-foreground" : undefined}
                      onClick={() => toggleTable(tbl.id)}
                    >
                      {tbl.name} · {tbl.seats}
                      {isBusy && (
                        <span id={`new-reservation-busy-${tbl.id}`} className="text-xs font-normal">
                          {why}
                        </span>
                      )}
                    </Button>
                  );
                })}
              </div>
            )}
            {tableError && (
              <p id="new-reservation-tables-error" role="alert" className="text-sm text-destructive">
                {tableError}
              </p>
            )}
            <p
              className={
                watchedPartySize > totalSeats && selected.length > 0
                  ? "text-sm text-destructive"
                  : "text-sm text-muted-foreground"
              }
            >
              {t("reservation.selected", {
                seats: t("common.seats", { count: totalSeats }),
                guests: t("common.guests", { count: watchedPartySize }),
              })}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="guest-name">{t("reservation.guestName")}</Label>
              <Input id="guest-name" placeholder={t("reservation.guestNamePlaceholder")} {...register("name")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="guest-contact">{t("reservation.contact")}</Label>
              <Input
                id="guest-contact"
                placeholder="jane@example.com" // i18n-ok
                {...register("contact")}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reservation-commentary">{t("reservation.note")}</Label>
            <Textarea
              id="reservation-commentary"
              maxLength={COMMENTARY_MAX}
              placeholder={t("reservation.notePlaceholder")}
              {...register("commentary")}
            />
            <p className="text-sm text-muted-foreground">
              {t("reservation.noteHint", { max: COMMENTARY_MAX })}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t("reservation.new.creating") : t("reservation.new.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
