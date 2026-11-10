import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArmchairIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { WalkInDialog } from "@/components/reservation/walk-in-dialog";
import { useFloor } from "@/hooks/use-floor";
import { api, type FloorTable } from "@/lib/api";
import { nowTime, todayIso } from "@/lib/date";

export function FloorView({ venueId }: { venueId: string }) {
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState(nowTime());
  const [seatTable, setSeatTable] = useState<FloorTable | null>(null);
  const [dragged, setDragged] = useState<{ reservationId: string; tableId: string } | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data, isPending } = useFloor(venueId, date, time);

  const tables = data?.tables ?? [];

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

  const zones = useMemo(() => {
    const map = new Map<string, FloorTable[]>();
    for (const t of tables) {
      const key = t.zone || "No zone";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return [...map.entries()];
  }, [tables]);

  function dropOn(target: FloorTable) {
    if (!dragged || dragged.tableId === target.id) {
      setDragged(null);
      setDragOverId(null);
      return;
    }
    move.mutate({ reservationId: dragged.reservationId, targetTableId: target.id });
    setDragged(null);
    setDragOverId(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Floor plan</h2>
          <p className="text-sm text-muted-foreground">
            Drag a reservation to a free table to move it. Click a free table to seat a walk-in.
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
        <Skeleton className="h-64 w-full" />
      ) : tables.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <ArmchairIcon className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No tables yet. Add them under Setup.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {zones.map(([zone, zoneTables]) => (
            <div key={zone} className="space-y-3">
              <h3 className="font-medium">{zone}</h3>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
                {zoneTables.map((t) => (
                  <TableCard
                    key={t.id}
                    table={t}
                    isDragOver={dragOverId === t.id}
                    onSeat={() => setSeatTable(t)}
                    onDragStart={() => setDragged({ reservationId: t.reservationId!, tableId: t.id })}
                    onDragEnd={() => setDragged(null)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverId(t.id);
                    }}
                    onDragLeave={() => setDragOverId(null)}
                    onDrop={() => dropOn(t)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
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

function TableCard({
  table,
  isDragOver,
  onSeat,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  table: FloorTable;
  isDragOver: boolean;
  onSeat: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: () => void;
}) {
  if (table.occupied) {
    return (
      <div
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className="flex cursor-grab flex-col rounded-lg border border-primary bg-primary/10 p-3 active:cursor-grabbing"
        title="Drag to a free table to move"
      >
        <div className="flex items-center justify-between gap-1">
          <span className="font-medium">{table.name}</span>
          <span className="text-xs text-muted-foreground">{table.seats} seats</span>
        </div>
        <div className="mt-1 truncate text-sm font-medium">
          {table.guestName || "—"}
        </div>
        <div className="text-xs text-muted-foreground">
          {table.partySize ?? "?"} guests
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onSeat}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-3 text-center transition-colors hover:border-primary hover:bg-accent ${
        isDragOver ? "border-primary bg-accent" : ""
      }`}
    >
      <ArmchairIcon className="size-5 text-muted-foreground" />
      <span className="font-medium">{table.name}</span>
      <span className="text-xs text-muted-foreground">{table.seats} seats</span>
    </button>
  );
}
