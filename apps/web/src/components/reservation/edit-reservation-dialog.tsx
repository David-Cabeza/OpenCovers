import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConsentSelect } from "@/components/reservation/consent-select";
import { api, type Consent, type Reservation } from "@/lib/api";

interface EditValues {
  consent: Consent;
  rating: string;
}

const NO_RATING = "none";

function toValues(reservation: Reservation | null): EditValues {
  return {
    consent: reservation?.guest.consent ?? "unknown",
    rating: reservation?.rating ? String(reservation.rating) : NO_RATING,
  };
}

export function EditReservationDialog({
  venueId,
  reservation,
  onOpenChange,
}: {
  venueId: string;
  reservation: Reservation | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const {
    handleSubmit,
    reset,
    control,
    formState: { isSubmitting },
  } = useForm<EditValues>({ defaultValues: toValues(reservation) });

  useEffect(() => {
    reset(toValues(reservation));
  }, [reservation, reset]);

  async function onSubmit(values: EditValues) {
    if (!reservation) return;
    try {
      await api.modifyReservation(venueId, reservation.id, {
        guest: { consent: values.consent },
        rating: values.rating === NO_RATING ? null : Number(values.rating),
      });
      await queryClient.invalidateQueries({ queryKey: ["agenda", venueId] });
      toast.success("Reservation updated");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the reservation.");
    }
  }

  return (
    <Dialog open={reservation !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Consent and rating</DialogTitle>
          <DialogDescription>
            {reservation?.guest.name
              ? `Update the details recorded for ${reservation.guest.name}.`
              : "Update the details recorded for this reservation."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>Contact consent</Label>
            <Controller
              name="consent"
              control={control}
              render={({ field }) => (
                <ConsentSelect value={field.value} onChange={field.onChange} />
              )}
            />
          </div>

          <div className="space-y-2">
            <Label>Rating</Label>
            <Controller
              name="rating"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_RATING}>No rating</SelectItem>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
