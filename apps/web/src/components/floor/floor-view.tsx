import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArmchairIcon } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { WalkInDialog } from "@/components/reservation/walk-in-dialog";
import { FloorCanvas } from "@/components/floor/floor-canvas";
import { useFloor } from "@/hooks/use-floor";
import { useFloorItems } from "@/hooks/use-floor-items";
import { api, type FloorTable } from "@/lib/api";
import { nowTime, todayIso } from "@/lib/date";

export function FloorView({ venueId }: { venueId: string }) {
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState(nowTime());
  const [seatTable, setSeatTable] = useState<FloorTable | null>(null);
  const queryClient = useQueryClient();
  const { data, isPending } = useFloor(venueId, date, time);
  const { data: itemsData } = useFloorItems(venueId);

  const tables = data?.tables ?? [];
  const items = itemsData?.items ?? [];

  const move = useMutation({
    mutationFn: ({ reservationId, targetTableId }: { reservationId: string; targetTableId: string }) =>
      api.modifyReservation(venueId, reservationId, { tables: [targetTableId] }),
    onSuccess: () => {
      toast.success("Reservation moved");
      void queryClient.invalidateQueries({ queryKey: ["floor", venueId] });
      void queryClient.invalidateQueries({ queryKey: ["agenda", venueId] });
      void queryClient.invalidateQueries({ queryKey: ["availability", venueId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not move."),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Floor plan</h2>
          <p className="text-sm text-muted-foreground">
            Drag a reservation to a free table, or click a free table to seat a walk-in.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-fit"
          />
          <Input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-fit"
          />
          <Button
            variant="outline"
            onClick={() => {
              setDate(todayIso());
              setTime(nowTime());
            }}
          >
            Now
          </Button>
        </div>
      </div>

      {isPending ? (
        <Skeleton className="h-[480px] w-full" />
      ) : tables.length === 0 ? (
        <EmptyState
          icon={ArmchairIcon}
          title="No tables yet"
          description="Add tables under Settings, then arrange them on the floor plan."
        />
      ) : (
        <FloorCanvas
          tables={tables}
          items={items}
          mode="view"
          onSeat={(tableId) => {
            const table = tables.find((t) => t.id === tableId);
            if (table) setSeatTable(table);
          }}
          onMove={(reservationId, targetTableId) =>
            move.mutate({ reservationId, targetTableId })
          }
        />
      )}

      <WalkInDialog
        venueId={venueId}
        open={seatTable !== null}
        onOpenChange={(open) => !open && setSeatTable(null)}
        tableId={seatTable?.id}
        tableName={seatTable?.name}
      />
    </div>
  );
}
