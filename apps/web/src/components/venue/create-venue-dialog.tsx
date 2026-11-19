import { errorMessage } from "@/lib/error-message";
import { useState } from "react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useT } from "@/i18n";
import { browserTimeZone, TIMEZONES } from "@/lib/timezones";

interface CreateVenueValues {
  name: string;
  timezone: string;
}

export function CreateVenueDialog({ triggerLabel }: { triggerLabel?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateVenueValues>({
    defaultValues: { name: "", timezone: browserTimeZone() },
  });

  const defaultTz = browserTimeZone();
  const options = TIMEZONES.includes(defaultTz as (typeof TIMEZONES)[number])
    ? [...TIMEZONES]
    : [...TIMEZONES, defaultTz as (typeof TIMEZONES)[number]];

  async function onSubmit(values: CreateVenueValues) {
    try {
      await api.createVenue({
        name: values.name,
        timezone: values.timezone,
      });
      await queryClient.invalidateQueries({ queryKey: ["venues"] });
      reset({ name: "", timezone: defaultTz });
      setOpen(false);
      toast.success(t("venue.create.created"));
    } catch (err) {
      toast.error(errorMessage(err, t("venue.create.failed")));
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{triggerLabel ?? t("venue.create.trigger")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("venue.create.title")}</DialogTitle>
          <DialogDescription>
            {t("venue.create.description")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="venue-name">{t("venue.create.name")}</Label>
            <Input
              id="venue-name"
              placeholder="Casa Lola" // i18n-ok
              {...register("name", { required: t("venue.create.nameRequired") })}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t("venue.create.timezone")}</Label>
            <Controller
              name="timezone"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("venue.create.timezonePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t("venue.create.submitting") : t("venue.create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
