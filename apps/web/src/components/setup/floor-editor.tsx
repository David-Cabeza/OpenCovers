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
import { Skeleton } from "@/components/ui/skeleton";
import { FloorCanvas } from "@/components/floor/floor-canvas";
import { useTables } from "@/hooks/use-tables";
import { useFloorItems } from "@/hooks/use-floor-items";
import { api } from "@/lib/api";
import { FLOOR_ITEM_TYPES } from "@/lib/floor-item-types";

export function FloorEditor({ venueId }: { venueId: string }) {
  const queryClient = useQueryClient();
  const { data: tablesData, isPending } = useTables(venueId);
  const { data: itemsData } = useFloorItems(venueId);
  const tables = tablesData?.tables ?? [];
  const items = itemsData?.items ?? [];

  const positionTable = useMutation({
    mutationFn: ({ tableId, x, y }: { tableId: string; x: number; y: number }) =>
      api.setTablePosition(venueId, tableId, x, y),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tables", venueId] });
      void queryClient.invalidateQueries({ queryKey: ["floor", venueId] });
    },
  });

  const positionItem = useMutation({
    mutationFn: ({ itemId, x, y }: { itemId: string; x: number; y: number }) =>
      api.setFloorItemPosition(venueId, itemId, x, y),
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
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not add element."),
  });

  const deleteItem = useMutation({
    mutationFn: (itemId: string) => api.deleteFloorItem(venueId, itemId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["floor-items", venueId] });
    },
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>Floor layout</CardTitle>
          <CardDescription>
            Drag tables and room elements to arrange your dining room.
          </CardDescription>
        </div>
        <Select
          onValueChange={(type) => {
            const cfg = FLOOR_ITEM_TYPES[type];
            if (cfg) addItem.mutate({ type, label: cfg.label, width: cfg.width, height: cfg.height });
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Add element" />
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
          <Skeleton className="h-[480px] w-full" />
        ) : (
          <FloorCanvas
            tables={tables}
            items={items}
            mode="edit"
            onPosition={(tableId, x, y) => positionTable.mutate({ tableId, x, y })}
            onItemPosition={(itemId, x, y) => positionItem.mutate({ itemId, x, y })}
            onDeleteItem={(itemId) => deleteItem.mutate(itemId)}
          />
        )}
      </CardContent>
    </Card>
  );
}
