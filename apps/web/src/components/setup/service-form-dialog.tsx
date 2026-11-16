import { errorMessage } from "@/lib/error-message";
import { useEffect, useState } from "react";
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
import { api, type Service } from "@/lib/api";
import { ALL_WEEKDAYS, WEEKDAYS } from "@/lib/weekdays";

interface ServiceFormValues {
  name: string;
  openStart: string;
  openEnd: string;
}

interface ServiceFormDialogProps {
  venueId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Service | null;
}

export function ServiceFormDialog({
  venueId,
  open,
  onOpenChange,
  initial,
}: ServiceFormDialogProps) {
  const queryClient = useQueryClient();
  const editing = Boolean(initial);
  const [days, setDays] = useState<number[]>(ALL_WEEKDAYS);
  const [daysError, setDaysError] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ServiceFormValues>();

  useEffect(() => {
    if (open) {
      setDays(initial?.days?.length ? initial.days : ALL_WEEKDAYS);
      setDaysError(false);
      reset({
        name: initial?.name ?? "",
        openStart: initial?.openStart ?? "12:00",
        openEnd: initial?.openEnd ?? "16:00",
      });
    }
  }, [open, initial, reset]);

  function toggleDay(day: number, on: boolean) {
    setDaysError(false);
    setDays((current) =>
      on ? [...new Set([...current, day])].sort((a, b) => a - b) : current.filter((d) => d !== day),
    );
  }

  async function onSubmit(values: ServiceFormValues) {
    if (days.length === 0) {
      setDaysError(true);
      return;
    }
    try {
      await api.upsertService(venueId, {
        name: editing ? (initial as Service).name : values.name,
        openStart: values.openStart,
        openEnd: values.openEnd,
        days,
      });
      await queryClient.invalidateQueries({ queryKey: ["services", venueId] });
      await queryClient.invalidateQueries({ queryKey: ["availability", venueId] });
      toast.success(editing ? "Service updated" : "Service added");
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, "Could not save the service."));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit service" : "Add service"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update the service's hours and days."
              : "Add a service such as lunch or dinner."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="service-name">Name</Label>
            <Input
              id="service-name"
              placeholder="dinner"
              disabled={editing}
              {...register("name", { required: "Name is required." })}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="service-open">Opens</Label>
              <Input
                id="service-open"
                type="time"
                {...register("openStart", { required: "Opening time is required." })}
              />
              {errors.openStart && (
                <p className="text-sm text-destructive">{errors.openStart.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="service-close">Closes</Label>
              <Input
                id="service-close"
                type="time"
                {...register("openEnd", { required: "Closing time is required." })}
              />
              {errors.openEnd && (
                <p className="text-sm text-destructive">{errors.openEnd.message}</p>
              )}
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Days</legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => (
                <label
                  key={d.value}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm has-[:checked]:bg-primary has-[:checked]:text-primary-foreground"
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    aria-label={d.long}
                    checked={days.includes(d.value)}
                    onChange={(e) => toggleDay(d.value, e.target.checked)}
                  />
                  {d.short}
                </label>
              ))}
            </div>
            {daysError && (
              <p role="alert" className="text-sm text-destructive">
                Pick at least one day.
              </p>
            )}
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : editing ? "Save changes" : "Add service"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
