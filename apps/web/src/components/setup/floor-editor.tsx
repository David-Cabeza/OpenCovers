import { errorMessage } from "@/lib/error-message";
import { useT } from "@/i18n";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LoadError } from "@/components/load-error";
import { Loading, Skeleton } from "@/components/ui/skeleton";
import { FloorCanvas } from "@/components/floor/floor-canvas";
import { useTables } from "@/hooks/use-tables";
import { useFloorItems } from "@/hooks/use-floor-items";
import { api } from "@/lib/api";
import { FLOOR_ITEM_TYPES } from "@/lib/floor-item-types";

export function FloorEditor({ venueId }: { venueId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: tablesData, isPending, isError, error, isRefetching, refetch } = useTables(venueId);
  const { data: itemsData } = useFloorItems(venueId);
  const tables = tablesData?.tables ?? [];
  const items = itemsData?.items ?? [];

  const positionTable = useMutation({
    mutationFn: ({ tableId, layout }: { tableId: string; layout: { x?: number; y?: number; rotation?: number } }) =>
      api.updateTableLayout(venueId, tableId, layout),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tables", venueId] });
      void queryClient.invalidateQueries({ queryKey: ["floor", venueId] });
    },
  });

  const updateItem = useMutation({
    mutationFn: ({
      itemId,
      layout,
    }: {
      itemId: string;
      layout: { x?: number; y?: number; rotation?: number; width?: number; height?: number };
    }) => api.updateFloorItemLayout(venueId, itemId, layout),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["floor-items", venueId] });
    },
  });

  const addItem = useMutation({
    mutationFn: (body: { type: string; label: string; width: number; height: number }) =>
      api.addFloorItem(venueId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["floor-items", venueId] });
    },
    onError: (err) => toast.error(errorMessage(err, t("setup.floor.addFailed"))),
  });

  const deleteItem = useMutation({
    mutationFn: (itemId: string) => api.deleteFloorItem(venueId, itemId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["floor-items", venueId] });
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <CardTitle as="h3">{t("setup.floor.title")}</CardTitle>
          <CardDescription>{t("setup.floor.description")}</CardDescription>
        </div>
        <Select
          onValueChange={(type) => {
            const cfg = FLOOR_ITEM_TYPES[type];
            if (cfg) addItem.mutate({ type, label: cfg.label, width: cfg.width, height: cfg.height });
          }}
        >
          <SelectTrigger className="w-full sm:w-[180px]" aria-label={t("setup.floor.addElement")}>
            <SelectValue placeholder={t("setup.floor.addElement")} />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(FLOOR_ITEM_TYPES).map(([type, cfg]) => (
              <SelectItem key={type} value={type}>
                {cfg.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Loading><Skeleton className="h-[480px] w-full" /></Loading>
        ) : isError && !tablesData ? (
          <LoadError compact what={t("setup.tables.loadWhat")} error={error} retrying={isRefetching} onRetry={() => void refetch()} />
        ) : (
          <FloorCanvas
            tables={tables}
            items={items}
            mode="edit"
            onTableUpdate={(tableId, layout) => positionTable.mutate({ tableId, layout })}
            onItemUpdate={(itemId, layout) => updateItem.mutate({ itemId, layout })}
            onDeleteItem={(itemId) => deleteItem.mutate(itemId)}
          />
        )}
      </CardContent>
    </Card>
  );
}
