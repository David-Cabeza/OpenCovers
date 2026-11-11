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
import { api, type Table } from "@/lib/api";

interface TableFormValues {
  id: string;
  name: string;
  seats: number;
  zone: string;
  shape: string;
}

interface TableFormDialogProps {
  venueId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Table | null;
}

export function TableFormDialog({
  venueId,
  open,
  onOpenChange,
  initial,
}: TableFormDialogProps) {
  const queryClient = useQueryClient();
  const editing = Boolean(initial);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TableFormValues>();

  useEffect(() => {
    if (open) {
      reset({
        id: initial?.id ?? "",
        name: initial?.name ?? "",
        seats: initial?.seats ?? 2,
        zone: initial?.zone ?? "",
        shape: initial?.shape ?? "round",
      });
    }
  }, [open, initial, reset]);

  async function onSubmit(values: TableFormValues) {
    try {
      await api.upsertTable(venueId, {
        id: editing ? (initial as Table).id : values.id,
        name: values.name,
        seats: values.seats,
        zone: values.zone || undefined,
        shape: values.shape,
      });
      await queryClient.invalidateQueries({ queryKey: ["tables", venueId] });
      await queryClient.invalidateQueries({ queryKey: ["availability", venueId] });
      toast.success(editing ? "Table updated" : "Table added");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the table.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit table" : "Add table"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update the table's name, seats, and zone."
              : "Add a table to your venue's floor plan."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="table-id">ID</Label>
              <Input
                id="table-id"
                placeholder="t1"
                disabled={editing}
                {...register("id", { required: "ID is required." })}
              />
              {errors.id && (
                <p className="text-sm text-destructive">{errors.id.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="table-name">Name</Label>
              <Input
                id="table-name"
                placeholder="Table 1"
                {...register("name", { required: "Name is required." })}
              />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="table-seats">Seats</Label>
              <Input
                id="table-seats"
                type="number"
                min={1}
                {...register("seats", {
                  required: "Seats is required.",
                  valueAsNumber: true,
                  min: { value: 1, message: "At least one seat." },
                })}
              />
              {errors.seats && (
                <p className="text-sm text-destructive">{errors.seats.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="table-shape">Shape</Label>
              <select
                id="table-shape"
                {...register("shape")}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="round">Round</option>
                <option value="square">Square</option>
                <option value="rectangle">Rectangle</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="table-zone">Zone</Label>
            <Input id="table-zone" placeholder="Main / Terrace" {...register("zone")} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : editing ? "Save changes" : "Add table"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
