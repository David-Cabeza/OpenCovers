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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConsentSelect } from "@/components/reservation/consent-select";
import { isTooLong, LimitedTextarea } from "@/components/limited-textarea";
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
  startOnDietary,
  onSaved,
  onCloseAutoFocus,
}: {
  venueId: string;
  reservation: Reservation | null;
  onOpenChange: (open: boolean) => void;
  /** Opens with the allergy and diet fields out and focused. */
  startOnDietary?: boolean;
  onSaved?: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const {
    handleSubmit,
    reset,
    control,
    register,
    watch,
    setFocus,
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
    if (isTooLong(values.commentary, COMMENTARY_MAX)) {
      setFocus("commentary");
      return;
    }
    // Only what differs from what the dialog opened with: a field sent as it was would undo another person's save.
    const opened = toValues(reservation);
    const commentary = values.commentary.trim();
    const changes = {
      ...(values.consent !== opened.consent && { guest: { consent: values.consent } }),
      ...(values.rating !== opened.rating && { rating: values.rating === NO_RATING ? null : Number(values.rating) }),
      ...(commentary !== opened.commentary.trim() && { commentary }),
      ...recorded,
    };
    // The API refuses an empty body. Nothing is written, so close without saying anything was saved.
    if (Object.keys(changes).length === 0) {
      onOpenChange(false);
      return;
    }
    try {
      await api.modifyReservation(venueId, reservation.id, changes);
      // The floor card keeps what it read for a while, and must not show the old allergies.
      void queryClient.invalidateQueries({ queryKey: ["reservation", venueId] });
      await queryClient.invalidateQueries({ queryKey: ["agenda", venueId] });
      toast.success(t("reservation.edit.done"));
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, t("reservation.edit.failed")));
    }
  }

  return (
    <Dialog open={reservation !== null} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t(canRecordDietary ? "reservation.edit.titleDietary" : "reservation.edit.title")}</DialogTitle>
          <DialogDescription>
            {reservation?.guest.name
              ? t("reservation.edit.description", { name: reservation.guest.name })
              : t("reservation.edit.descriptionUnnamed")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {canRecordDietary && <DietaryFields form={dietary} startOpen={startOnDietary} />}

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
            <LimitedTextarea
              id="edit-commentary"
              text={watch("commentary")}
              limit={COMMENTARY_MAX}
              hint={t(canRecordDietary ? "reservation.noteHintDietary" : "reservation.noteHint", { max: COMMENTARY_MAX })}
              placeholder={t("reservation.notePlaceholder")}
              {...register("commentary")}
            />
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
