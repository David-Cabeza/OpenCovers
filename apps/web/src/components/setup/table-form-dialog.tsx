import { errorMessage } from "@/lib/error-message";
import { useT } from "@/i18n";
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
  const t = useT();
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
      toast.success(editing ? t("setup.table.updated") : t("setup.table.added"));
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, t("setup.table.saveFailed")));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // The id is a technical key; a person adding a table starts with its name.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          document.getElementById("table-name")?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{editing ? t("setup.table.editTitle") : t("setup.table.addTitle")}</DialogTitle>
          <DialogDescription>
            {editing ? t("setup.table.editDescription") : t("setup.table.addDescription")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="table-id">{t("setup.table.id")}</Label>
              <Input
                id="table-id"
                placeholder="t1" // i18n-ok
                disabled={editing}
                {...register("id", { required: t("setup.table.idRequired") })}
              />
              {errors.id && (
                <p className="text-sm text-destructive">{errors.id.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="table-name">{t("setup.form.name")}</Label>
              <Input
                id="table-name"
                placeholder={t("setup.table.namePlaceholder")}
                {...register("name", { required: t("setup.form.nameRequired") })}
              />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="table-seats">{t("setup.table.seats")}</Label>
              <Input
                id="table-seats"
                type="number"
                min={1}
                {...register("seats", {
                  required: t("setup.table.seatsRequired"),
                  valueAsNumber: true,
                  min: { value: 1, message: t("setup.table.seatsMin") },
                })}
              />
              {errors.seats && (
                <p className="text-sm text-destructive">{errors.seats.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="table-shape">{t("setup.table.shape")}</Label>
              <select
                id="table-shape"
                {...register("shape")}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="round">{t("setup.table.shape.round")}</option>
                <option value="oval">{t("setup.table.shape.oval")}</option>
                <option value="square">{t("setup.table.shape.square")}</option>
                <option value="rectangle">{t("setup.table.shape.rectangle")}</option>
                <option value="long">{t("setup.table.shape.long")}</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="table-zone">{t("setup.table.zone")}</Label>
            <Input id="table-zone" placeholder={t("setup.table.zonePlaceholder")} {...register("zone")} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t("common.saving") : editing ? t("setup.form.saveChanges") : t("setup.tables.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
