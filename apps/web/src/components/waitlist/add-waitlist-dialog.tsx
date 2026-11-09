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
      toast.success("Added to the waitlist");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add to the waitlist.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to waitlist</DialogTitle>
          <DialogDescription>
            Hold a table for a guest until one frees up.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wl-party">Party size</Label>
            <Input
              id="wl-party"
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
              <Label htmlFor="wl-name">Guest name</Label>
              <Input id="wl-name" placeholder="Jane Doe" {...register("name")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wl-contact">Contact</Label>
              <Input id="wl-contact" placeholder="jane@example.com" {...register("contact")} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Adding…" : "Add to waitlist"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
