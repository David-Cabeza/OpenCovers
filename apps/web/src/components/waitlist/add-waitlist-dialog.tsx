import { errorMessage } from "@/lib/error-message";
import { useEffect } from "react";
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
import { useT } from "@/i18n";
import { api } from "@/lib/api";

interface AddWaitlistValues {
  partySize: number;
  name: string;
  contact: string;
}

export function AddWaitlistDialog({
  venueId,
  open,
  onOpenChange,
}: {
  venueId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AddWaitlistValues>({ defaultValues: { partySize: 2, name: "", contact: "" } });

  useEffect(() => {
    if (open) reset({ partySize: 2, name: "", contact: "" });
  }, [open, reset]);

  async function onSubmit(values: AddWaitlistValues) {
    try {
      await api.addWaitlist(venueId, {
        partySize: values.partySize,
        guest: {
          name: values.name || undefined,
          contact: values.contact || undefined,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["waitlist", venueId] });
      toast.success(t("waitlist.add.added"));
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, t("waitlist.add.failed")));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("waitlist.add.title")}</DialogTitle>
          <DialogDescription>
            {t("waitlist.add.description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wl-party">{t("waitlist.add.partySize")}</Label>
            <Input
              id="wl-party"
              type="number"
              min={1}
              {...register("partySize", {
                required: t("waitlist.add.partySizeRequired"),
                valueAsNumber: true,
                min: { value: 1, message: t("waitlist.add.partySizeMin") },
              })}
            />
            {errors.partySize && (
              <p className="text-sm text-destructive">{errors.partySize.message}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="wl-name">{t("waitlist.add.name")}</Label>
              <Input id="wl-name" placeholder={t("waitlist.add.namePlaceholder")} {...register("name")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wl-contact">{t("waitlist.add.contact")}</Label>
              <Input
                id="wl-contact"
                placeholder="jane@example.com" // i18n-ok
                {...register("contact")}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t("waitlist.add.adding") : t("waitlist.add.title")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
