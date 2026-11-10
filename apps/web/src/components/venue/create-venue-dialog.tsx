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
import { browserTimeZone, TIMEZONES } from "@/lib/timezones";

interface CreateVenueValues {
  name: string;
  timezone: string;
}

export function CreateVenueDialog({ triggerLabel = "New venue" }: { triggerLabel?: string }) {
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
      toast.success("Venue created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the venue.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{triggerLabel}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a venue</DialogTitle>
          <DialogDescription>
            Add your restaurant to start taking reservations.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="venue-name">Name</Label>
            <Input
              id="venue-name"
              placeholder="Casa Lola"
              {...register("name", { required: "Name is required." })}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Timezone</Label>
            <Controller
              name="timezone"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a timezone" />
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
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating…" : "Create venue"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
