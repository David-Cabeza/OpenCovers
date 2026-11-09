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
import { useTables } from "@/hooks/use-tables";
import { api } from "@/lib/api";

interface FormValues {
  partySize: number;
  name: string;
  contact: string;
}

interface NewReservationDialogProps {
  venueId: string;
  date: string;
  time: string;
  partySize: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewReservationDialog({
  venueId,
  date,
  time,
  partySize,
  open,
  onOpenChange,
}: NewReservationDialogProps) {
  const queryClient = useQueryClient();
  const { data } = useTables(venueId);
  const tables = data?.tables ?? [];
  const [selected, setSelected] = useState<string[]>([]);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { partySize, name: "", contact: "" },
  });

  const watchedPartySize = Number(watch("partySize")) || 0;

  const totalSeats = useMemo(
    () =>
      tables
        .filter((t) => selected.includes(t.id))
        .reduce((sum, t) => sum + t.seats, 0),
    [tables, selected],
  );

  useEffect(() => {
    if (open) {
      reset({ partySize, name: "", contact: "" });
      setSelected([]);
    }
  }, [open, partySize, reset]);

  function toggleTable(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function onSubmit(values: FormValues) {
    if (selected.length === 0) {
      toast.error("Select at least one table.");
      return;
    }
    if (values.partySize > totalSeats) {
      toast.error("The party is larger than the selected tables.");
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
      });
      await queryClient.invalidateQueries({ queryKey: ["agenda", venueId] });
      await queryClient.invalidateQueries({ queryKey: ["availability", venueId] });
      toast.success("Reservation created");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the reservation.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New reservation</DialogTitle>
          <DialogDescription>
            {date} at {time}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="party-size">Party size</Label>
            <Input
              id="party-size"
              type="number"
              min={1}
              {...register("partySize", {
                required: "Party size is required.",
                min: { value: 1, message: "At least one guest." },
              })}
            />
            {errors.partySize && (
              <p className="text-sm text-destructive">{errors.partySize.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Tables</Label>
            {tables.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This venue has no tables yet.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tables.map((t) => (
                  <Button
                    key={t.id}
                    type="button"
                    variant={selected.includes(t.id) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleTable(t.id)}
                  >
                    {t.name} · {t.seats}
                  </Button>
                ))}
              </div>
            )}
            <p
              className={
                watchedPartySize > totalSeats && selected.length > 0
                  ? "text-sm text-destructive"
                  : "text-sm text-muted-foreground"
              }
            >
              {totalSeats} seats selected for {watchedPartySize} guests.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="guest-name">Guest name</Label>
              <Input id="guest-name" placeholder="Jane Doe" {...register("name")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="guest-contact">Contact</Label>
              <Input
                id="guest-contact"
                placeholder="jane@example.com"
                {...register("contact")}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating…" : "Create reservation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
