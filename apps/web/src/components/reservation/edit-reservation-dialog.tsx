import { errorMessage, isApiError } from "@/lib/error-message";
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
import { CONSENT_OPTIONS, ConsentSelect } from "@/components/reservation/consent-select";
import { isTooLong, LimitedTextarea } from "@/components/limited-textarea";
import { DietaryFields, useDietaryForm } from "@/components/dietary/dietary-fields";
import { DietarySummary } from "@/components/dietary/dietary-summary";
import { ConflictNotice, StoredNow } from "@/components/reservation/conflict-notice";
import { useCanRecordDietary } from "@/hooks/use-can-record-dietary";
import { useReservationConflict } from "@/hooks/use-reservation-conflict";
import { useT } from "@/i18n";
import { api, COMMENTARY_MAX, type Consent, type Reservation } from "@/lib/api";
import { dietaryChange, draftFrom, isEmptyDietary } from "@/lib/dietary";
import { rememberReservation } from "@/lib/reservation-cache";

interface EditValues {
  consent: Consent;
  rating: string;
  commentary: string;
}

const NO_RATING = "none";
/** The statuses whose details the engine takes. A deletion of allergies and diets it takes on every status. */
const EDITABLE = ["booked", "seated", "attended"];

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
    getValues,
    setValue,
    formState: { isSubmitting },
  } = useForm<EditValues>({ defaultValues: toValues(reservation) });

  const canRecordDietary = useCanRecordDietary(venueId);
  const dietary = useDietaryForm();
  const resetDietary = dietary.reset;
  const { base, conflict, reread, clear, gone } = useReservationConflict(venueId, reservation);

  const stored = toValues(base);
  const opened = toValues(reservation);
  const closed = base !== null && !EDITABLE.includes(base.status);
  const withdrawing = Boolean(dietary.stored) && isEmptyDietary(dietary.draft);
  // A field is marked when what is stored is no longer what the dialog opened with, and saving would replace it.
  const consentTaken = stored.consent !== opened.consent && watch("consent") !== stored.consent;
  const ratingTaken = stored.rating !== opened.rating && watch("rating") !== stored.rating;
  const noteTaken =
    stored.commentary.trim() !== opened.commentary.trim() && watch("commentary").trim() !== stored.commentary.trim();
  const dietaryTaken =
    dietaryChange(draftFrom(reservation?.dietary), base?.dietary).kind !== "unchanged" &&
    dietaryChange(dietary.draft, base?.dietary).kind !== "unchanged";

  /** Fields nobody touched take what is stored now, and the others keep what was typed. */
  function rebase(from: Reservation, to: Reservation) {
    const before = toValues(from);
    const after = toValues(to);
    const typed = getValues();
    if (typed.consent === before.consent) setValue("consent", after.consent);
    if (typed.rating === before.rating) setValue("rating", after.rating);
    if (typed.commentary.trim() === before.commentary.trim()) setValue("commentary", after.commentary);
    dietary.rebase(to.dietary);
  }

  useEffect(() => {
    reset(toValues(reservation));
    resetDietary(reservation?.dietary);
  }, [reservation, reset, resetDietary]);

  async function onSubmit(values: EditValues) {
    if (!reservation || !base) return;
    const recorded = canRecordDietary ? dietary.take() : {};
    if (!recorded) return;
    if (!closed && isTooLong(values.commentary, COMMENTARY_MAX)) {
      setFocus("commentary");
      return;
    }
    // Only what differs from what is stored, as the dialog last read it: a field sent as it was would undo another
    // person's save.
    const commentary = values.commentary.trim();
    const changes = {
      ...(!closed && values.consent !== stored.consent && { guest: { consent: values.consent } }),
      ...(!closed &&
        values.rating !== stored.rating && { rating: values.rating === NO_RATING ? null : Number(values.rating) }),
      ...(!closed && commentary !== stored.commentary.trim() && { commentary }),
      ...recorded,
    };
    // The API refuses an empty body. Nothing is written, so close without saying anything was saved.
    if (Object.keys(changes).length === 0) {
      onOpenChange(false);
      return;
    }
    // A deletion of health data carries no version: it must not be refused because the booking changed.
    const withdrawal = changes.dietary === null && Object.keys(changes).length === 1;
    clear();
    try {
      const saved = await api.modifyReservation(
        venueId,
        reservation.id,
        withdrawal ? changes : { ...changes, version: base.version },
      );
      rememberReservation(queryClient, venueId, saved);
      // The floor card keeps what it read for a while, and must not show the old allergies.
      void queryClient.invalidateQueries({ queryKey: ["reservation", venueId] });
      await queryClient.invalidateQueries({ queryKey: ["agenda", venueId] });
      toast.success(t("reservation.edit.done"));
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      if (isApiError(err, "reservation_changed")) await onChanged(base, changes.dietary === null);
      else if (isApiError(err, "reservation_not_found")) gone();
      else toast.error(errorMessage(err, t("reservation.edit.failed")));
    }
  }

  async function onChanged(from: Reservation, deletesDietary: boolean) {
    let withdrawn = false;
    // The refused body held the deletion along with other changes. The deletion goes again, alone and unversioned.
    if (deletesDietary) {
      try {
        rememberReservation(queryClient, venueId, await api.modifyReservation(venueId, from.id, { dietary: null }));
        withdrawn = true;
      } catch (err) {
        toast.error(errorMessage(err, t("dietary.deleteFailed")));
      }
    }
    const { fresh, stillShown } = await reread({ withdrawn });
    if (!stillShown) {
      if (withdrawn) toast.success(t("dietary.deleted"));
      toast.error(t("reservation.conflict.unsaved"));
    } else if (typeof fresh !== "string") {
      rebase(from, fresh);
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
                <ConsentSelect
                  id="edit-consent"
                  value={field.value}
                  onChange={field.onChange}
                  describedBy={consentTaken ? "edit-consent-stored" : undefined}
                />
              )}
            />
            {consentTaken && (
              <StoredNow
                id="edit-consent-stored"
                value={CONSENT_OPTIONS.find((o) => o.value === stored.consent)?.label ?? ""}
              />
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-rating">{t("reservation.edit.rating")}</Label>
            <Controller
              name="rating"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id="edit-rating"
                    className="w-full"
                    aria-describedby={ratingTaken ? "edit-rating-stored" : undefined}
                  >
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
            {ratingTaken && (
              <StoredNow
                id="edit-rating-stored"
                value={stored.rating === NO_RATING ? t("reservation.edit.noRating") : stored.rating}
              />
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-commentary">{t("reservation.note")}</Label>
            <LimitedTextarea
              id="edit-commentary"
              text={watch("commentary")}
              limit={COMMENTARY_MAX}
              hint={t(canRecordDietary ? "reservation.noteHintDietary" : "reservation.noteHint", { max: COMMENTARY_MAX })}
              placeholder={t("reservation.notePlaceholder")}
              aria-describedby={noteTaken ? "edit-commentary-stored" : undefined}
              {...register("commentary")}
            />
            {noteTaken && (
              <StoredNow id="edit-commentary-stored" value={stored.commentary || t("reservation.conflict.noNote")} />
            )}
          </div>

          <ConflictNotice
            conflict={conflict}
            status={base?.status}
            openedStatus={reservation?.status}
            closed={closed}
          />

          {/* Under the message, not by the fields: on a phone, Save must not be reached without passing it. */}
          {canRecordDietary &&
            dietaryTaken &&
            (base?.dietary ? (
              <div className="space-y-1">
                <p className="text-sm font-medium">{t("reservation.conflict.dietaryStored")}</p>
                <DietarySummary dietary={base.dietary} />
              </div>
            ) : (
              <p className="text-sm font-medium">{t("reservation.conflict.dietaryDeleted")}</p>
            ))}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting || conflict?.kind === "gone" || (closed && !withdrawing)}>
              {isSubmitting ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
