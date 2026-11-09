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
import { api, type Service } from "@/lib/api";

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

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ServiceFormValues>();

  useEffect(() => {
    if (open) {
      reset({
        name: initial?.name ?? "",
        openStart: initial?.openStart ?? "12:00",
        openEnd: initial?.openEnd ?? "16:00",
      });
    }
  }, [open, initial, reset]);

  async function onSubmit(values: ServiceFormValues) {
    try {
      await api.upsertService(venueId, {
        name: editing ? (initial as Service).name : values.name,
        openStart: values.openStart,
        openEnd: values.openEnd,
      });
      await queryClient.invalidateQueries({ queryKey: ["services", venueId] });
      await queryClient.invalidateQueries({ queryKey: ["availability", venueId] });
      toast.success(editing ? "Service updated" : "Service added");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the service.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit service" : "Add service"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update the service's hours."
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
