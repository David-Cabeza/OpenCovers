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
      toast.success("Guest seated");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not seat the guest.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tableName ? `Seat at ${tableName}` : "Walk-in"}</DialogTitle>
          <DialogDescription>
            {tableName
              ? `Seat a guest who just arrived at ${tableName}.`
              : "Seat a guest who just arrived. The engine assigns a table."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="walkin-party">Party size</Label>
            <Input
              id="walkin-party"
              type="number"
              min={1}
              {...register("partySize", {
                required: "Party size is required.",
                valueAsNumber: true,
                min: { value: 1, message: "At least one guest." },
              })}
            />
            {errors.partySize && (
              <p className="text-sm text-destructive">{errors.partySize.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="walkin-name">Guest name</Label>
              <Input id="walkin-name" placeholder="Jane Doe" {...register("name")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="walkin-contact">Contact</Label>
              <Input id="walkin-contact" placeholder="jane@example.com" {...register("contact")} />
            </div>
          </div>

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

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Seating…" : "Seat guest"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
