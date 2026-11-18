import { errorMessage } from "@/lib/error-message";
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
import { FloorSkinToggle } from "@/components/floor/floor-skin-toggle";
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

  const occupied = tables.filter((t) => t.occupied).length;
  const free = tables.length - occupied;
  const seatedCovers = tables.reduce((n, t) => n + (t.occupied ? (t.partySize ?? 0) : 0), 0);

  const move = useMutation({
    mutationFn: ({ reservationId, targetTableId }: { reservationId: string; targetTableId: string }) =>
      api.modifyReservation(venueId, reservationId, { tables: [targetTableId] }),
    onSuccess: () => {
      toast.success("Reservation moved");
      void queryClient.invalidateQueries({ queryKey: ["floor", venueId] });
      void queryClient.invalidateQueries({ queryKey: ["agenda", venueId] });
      void queryClient.invalidateQueries({ queryKey: ["availability", venueId] });
    },
    onError: (err) => toast.error(errorMessage(err, "Could not move.")),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h2 className="font-display text-3xl">Floor plan</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Drag a reservation to a free table, or click a free table to seat a walk-in.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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

      {tables.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <Legend tone="free" label="Free" value={free} />
          <Legend tone="occupied" label="Occupied" value={occupied} />
          <span className="text-muted-foreground tabular-nums">{seatedCovers} guests at tables</span>
          <span className="ml-auto">
            <FloorSkinToggle />
          </span>
        </div>
      )}

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

function Legend({ tone, label, value }: { tone: "free" | "occupied"; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className={
          tone === "occupied"
            ? "size-3 rounded-full border-2 border-success bg-success-soft"
            : "size-3 rounded-full border-2 border-border bg-card"
        }
      />
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground tabular-nums">{value}</span>
    </span>
  );
}
