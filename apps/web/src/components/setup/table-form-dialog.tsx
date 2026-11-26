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

// The limits of `TableUpsert` in docs/contract/openapi.yaml.
const TABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_TEXT = 80;
const MAX_SEATS = 200;

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
        // `rect` is the older name of `rectangle`; the list below has no option for it.
        shape: initial?.shape === "rect" ? "rectangle" : (initial?.shape ?? "round"),
      });
    }
  }, [open, initial, reset]);

  const invalid = (field: keyof TableFormValues) =>
    errors[field] ? { "aria-invalid": true, "aria-describedby": `table-${field}-error` } : {};

  const fieldError = (field: keyof TableFormValues) =>
    errors[field] && (
      <p id={`table-${field}-error`} className="text-sm text-destructive">
        {errors[field].message}
      </p>
    );

  const seatsRange = t("setup.table.seatsRange", { max: MAX_SEATS });

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

        {/* noValidate: the browser's own bubble would speak the browser's language, not the app's. */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="table-id">{t("setup.table.id")}</Label>
              <Input
                id="table-id"
                placeholder="t1" // i18n-ok
                disabled={editing}
                {...invalid("id")}
                // An existing id cannot be edited, and one stored before the rule must not block the form.
                {...register(
                  "id",
                  editing
                    ? {}
                    : {
                        required: t("setup.table.idRequired"),
                        pattern: { value: TABLE_ID, message: t("setup.table.idInvalid") },
                      },
                )}
              />
              {fieldError("id")}
            </div>
            <div className="space-y-2">
              <Label htmlFor="table-name">{t("setup.form.name")}</Label>
              <Input
                id="table-name"
                placeholder={t("setup.table.namePlaceholder")}
                {...invalid("name")}
                {...register("name", {
                  required: t("setup.form.nameRequired"),
                  pattern: { value: /\S/, message: t("setup.form.nameRequired") },
                  maxLength: { value: MAX_TEXT, message: t("setup.table.nameMax", { max: MAX_TEXT }) },
                })}
              />
              {fieldError("name")}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="table-seats">{t("setup.table.seats")}</Label>
              <Input
                id="table-seats"
                type="number"
                min={1}
                max={MAX_SEATS}
                {...invalid("seats")}
                {...register("seats", {
                  required: t("setup.table.seatsRequired"),
                  valueAsNumber: true,
                  min: { value: 1, message: seatsRange },
                  max: { value: MAX_SEATS, message: seatsRange },
                  validate: (value) => Number.isInteger(value) || seatsRange,
                })}
              />
              {fieldError("seats")}
            </div>
            <div className="space-y-2">
              <Label htmlFor="table-shape">{t("setup.table.shape")}</Label>
              <select
                id="table-shape"
                {...register("shape")}
                className="flex h-9 coarse:h-11 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
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
            <Input
              id="table-zone"
              placeholder={t("setup.table.zonePlaceholder")}
              {...invalid("zone")}
              {...register("zone", {
                maxLength: { value: MAX_TEXT, message: t("setup.table.zoneMax", { max: MAX_TEXT }) },
              })}
            />
            {fieldError("zone")}
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
