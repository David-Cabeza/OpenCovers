import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FloorCanvas } from "@/components/floor/floor-canvas";
import { useTables } from "@/hooks/use-tables";
import { api } from "@/lib/api";

export function FloorEditor({ venueId }: { venueId: string }) {
  const queryClient = useQueryClient();
  const { data, isPending } = useTables(venueId);
  const tables = data?.tables ?? [];

  const position = useMutation({
    mutationFn: ({ tableId, x, y }: { tableId: string; x: number; y: number }) =>
      api.setTablePosition(venueId, tableId, x, y),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tables", venueId] });
      void queryClient.invalidateQueries({ queryKey: ["floor", venueId] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Floor layout</CardTitle>
        <CardDescription>
          Drag tables to arrange your dining room.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-[480px] w-full" />
        ) : tables.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add tables first, then arrange them here.
          </p>
        ) : (
          <FloorCanvas
            tables={tables}
            mode="edit"
            onPosition={(tableId, x, y) => position.mutate({ tableId, x, y })}
          />
        )}
      </CardContent>
    </Card>
  );
}
