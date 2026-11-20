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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConsentSelect } from "@/components/reservation/consent-select";
import { useT } from "@/i18n";
import { api, type Consent } from "@/lib/api";

interface WalkInValues {
  partySize: number;
  name: string;
  contact: string;
  consent: Consent;
}

export function WalkInDialog({
  venueId,
  open,
  onOpenChange,
  tableId,
  tableName,
}: {
  venueId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableId?: string;
  tableName?: string;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<WalkInValues>({ defaultValues: { partySize: 2, name: "", contact: "", consent: "unknown" } });

  useEffect(() => {
    if (open) reset({ partySize: 2, name: "", contact: "", consent: "unknown" });
  }, [open, reset]);

  async function onSubmit(values: WalkInValues) {
    try {
      await api.walkIn(venueId, {
        partySize: values.partySize,
        tables: tableId ? [tableId] : undefined,
        guest: {
          name: values.name || undefined,
          contact: values.contact || undefined,
          consent: values.consent,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["agenda", venueId] });
      await queryClient.invalidateQueries({ queryKey: ["availability", venueId] });
      await queryClient.invalidateQueries({ queryKey: ["floor", venueId] });
      toast.success(t("reservation.walkIn.done"));
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, t("reservation.walkIn.failed")));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tableName ? t("reservation.walkIn.titleAtTable", { table: tableName }) : t("reservation.walkIn.title")}</DialogTitle>
          <DialogDescription>
            {tableName
              ? t("reservation.walkIn.descriptionAtTable", { table: tableName })
              : t("reservation.walkIn.description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="walkin-party">{t("reservation.partySize")}</Label>
            <Input
              id="walkin-party"
              type="number"
              min={1}
              {...register("partySize", {
                required: t("reservation.partySizeRequired"),
                valueAsNumber: true,
                min: { value: 1, message: t("reservation.atLeastOne") },
              })}
            />
            {errors.partySize && (
              <p className="text-sm text-destructive">{errors.partySize.message}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="walkin-name">{t("reservation.guestName")}</Label>
              <Input id="walkin-name" placeholder={t("reservation.guestNamePlaceholder")} {...register("name")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="walkin-contact">{t("reservation.contact")}</Label>
              <Input
                id="walkin-contact"
                placeholder="jane@example.com" // i18n-ok
                {...register("contact")}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="walkin-consent">{t("reservation.contactConsent")}</Label>
            <Controller
              name="consent"
              control={control}
              render={({ field }) => (
                <ConsentSelect id="walkin-consent" value={field.value} onChange={field.onChange} />
              )}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t("reservation.walkIn.seating") : t("reservation.walkIn.seat")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
