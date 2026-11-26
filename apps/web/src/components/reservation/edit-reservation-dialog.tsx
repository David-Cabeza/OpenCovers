import { errorMessage } from "@/lib/error-message";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConsentSelect } from "@/components/reservation/consent-select";
import { DietaryFields, useDietaryForm } from "@/components/dietary/dietary-fields";
import { useCanRecordDietary } from "@/hooks/use-can-record-dietary";
import { useT } from "@/i18n";
import { api, COMMENTARY_MAX, type Consent, type Reservation } from "@/lib/api";

interface EditValues {
  consent: Consent;
  rating: string;
  commentary: string;
}

const NO_RATING = "none";

function toValues(reservation: Reservation | null): EditValues {
  return {
    consent: reservation?.guest.consent ?? "unknown",
    rating: reservation?.rating ? String(reservation.rating) : NO_RATING,
    commentary: reservation?.commentary ?? "",
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
  const t = useT();
  const queryClient = useQueryClient();
  const {
    handleSubmit,
    reset,
    control,
    register,
    formState: { isSubmitting },
  } = useForm<EditValues>({ defaultValues: toValues(reservation) });

  const canRecordDietary = useCanRecordDietary(venueId);
  const dietary = useDietaryForm();
  const resetDietary = dietary.reset;

  useEffect(() => {
    reset(toValues(reservation));
    resetDietary(reservation?.dietary);
  }, [reservation, reset, resetDietary]);

  async function onSubmit(values: EditValues) {
    if (!reservation) return;
    const recorded = canRecordDietary ? dietary.take() : {};
    if (!recorded) return;
    try {
      await api.modifyReservation(venueId, reservation.id, {
        guest: { consent: values.consent },
        rating: values.rating === NO_RATING ? null : Number(values.rating),
        commentary: values.commentary.trim(),
        ...recorded,
      });
      // The floor card keeps what it read for a while, and must not show the old allergies.
      void queryClient.invalidateQueries({ queryKey: ["reservation", venueId] });
      await queryClient.invalidateQueries({ queryKey: ["agenda", venueId] });
      toast.success(t("reservation.edit.done"));
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, t("reservation.edit.failed")));
    }
  }

  return (
    <Dialog open={reservation !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(canRecordDietary ? "reservation.edit.titleDietary" : "reservation.edit.title")}</DialogTitle>
          <DialogDescription>
            {reservation?.guest.name
              ? t("reservation.edit.description", { name: reservation.guest.name })
              : t("reservation.edit.descriptionUnnamed")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {canRecordDietary && <DietaryFields form={dietary} />}

          <div className="space-y-2">
            <Label htmlFor="edit-consent">{t("reservation.contactConsent")}</Label>
            <Controller
              name="consent"
              control={control}
              render={({ field }) => (
                <ConsentSelect id="edit-consent" value={field.value} onChange={field.onChange} />
              )}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-rating">{t("reservation.edit.rating")}</Label>
            <Controller
              name="rating"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="edit-rating" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_RATING}>{t("reservation.edit.noRating")}</SelectItem>
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

          <div className="space-y-2">
            <Label htmlFor="edit-commentary">{t("reservation.note")}</Label>
            <Textarea
              id="edit-commentary"
              maxLength={COMMENTARY_MAX}
              placeholder={t("reservation.notePlaceholder")}
              {...register("commentary")}
            />
            <p className="text-sm text-muted-foreground">
              {t(canRecordDietary ? "reservation.noteHintDietary" : "reservation.noteHint", { max: COMMENTARY_MAX })}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
