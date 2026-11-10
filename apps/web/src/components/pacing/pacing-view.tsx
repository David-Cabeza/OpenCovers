import { useState } from "react";
import { GaugeIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { usePacing } from "@/hooks/use-pacing";
import type { PacingSlot } from "@/lib/api";
import { todayIso } from "@/lib/date";

export function PacingView({ venueId }: { venueId: string }) {
  const [date, setDate] = useState(todayIso());
  const { data, isPending } = usePacing(venueId, date);

  const pacing = data?.pacing ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Pacing</h2>
          <p className="text-sm text-muted-foreground">
            Covers booked versus capacity, per time slot.
          </p>
        </div>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-fit"
        />
      </div>

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : pacing.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <GaugeIcon className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No services configured for this venue.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {pacing.map((service) => (
            <div key={service.service} className="space-y-2">
              <h3 className="font-medium capitalize">{service.service}</h3>
              <div
                className="grid gap-1"
                style={{
                  gridTemplateColumns: `repeat(${service.slots.length}, minmax(0, 1fr))`,
                }}
              >
                {service.slots.map((slot) => (
                  <SlotCell key={slot.time} slot={slot} />
                ))}
              </div>
            </div>
          ))}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <Legend color="bg-emerald-500/80" label="Low" />
            <Legend color="bg-amber-500/80" label="Medium" />
            <Legend color="bg-red-500/80" label="High" />
          </div>
        </div>
      )}
    </div>
  );
}

function SlotCell({ slot }: { slot: PacingSlot }) {
  const ratio = slot.capacity > 0 ? slot.covers / slot.capacity : 0;
  const color =
    slot.covers === 0
      ? "bg-muted text-muted-foreground"
      : ratio >= 0.8
        ? "bg-red-500/80 text-white"
        : ratio >= 0.5
          ? "bg-amber-500/80 text-white"
          : "bg-emerald-500/80 text-white";

  return (
    <div
      className={`rounded p-2 text-center ${color}`}
      title={`${slot.time} — ${slot.covers}/${slot.capacity} covers`}
    >
      <div className="text-xs font-semibold">
        {slot.covers}/{slot.capacity}
      </div>
      <div className="text-[10px] opacity-80">{slot.time}</div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block size-3 rounded ${color}`} />
      {label}
    </span>
  );
}
