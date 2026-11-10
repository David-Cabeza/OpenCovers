import { useMemo, useState } from "react";
import { ArmchairIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { WalkInDialog } from "@/components/reservation/walk-in-dialog";
import { useFloor } from "@/hooks/use-floor";
import { nowTime, todayIso } from "@/lib/date";
import type { FloorTable } from "@/lib/api";

export function FloorView({ venueId }: { venueId: string }) {
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState(nowTime());
  const [seatTable, setSeatTable] = useState<FloorTable | null>(null);
  const { data, isPending } = useFloor(venueId, date, time);

  const tables = data?.tables ?? [];

  const zones = useMemo(() => {
    const map = new Map<string, FloorTable[]>();
    for (const t of tables) {
      const key = t.zone || "No zone";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return [...map.entries()];
  }, [tables]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Floor plan</h2>
          <p className="text-sm text-muted-foreground">
            Table occupancy for the selected time.
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
                  <TableCard key={t.id} table={t} onSeat={() => setSeatTable(t)} />
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

function TableCard({ table, onSeat }: { table: FloorTable; onSeat: () => void }) {
  if (table.occupied) {
    return (
      <div className="flex flex-col rounded-lg border border-primary bg-primary/10 p-3">
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
      className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-3 text-center transition-colors hover:border-primary hover:bg-accent"
    >
      <ArmchairIcon className="size-5 text-muted-foreground" />
      <span className="font-medium">{table.name}</span>
      <span className="text-xs text-muted-foreground">{table.seats} seats</span>
    </button>
  );
}
