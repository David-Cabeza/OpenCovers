import { useState } from "react";
import { CalendarXIcon, MinusIcon, PlusIcon } from "lucide-react";
import { cn } from "cn";
import { DayNav } from "@/components/day-nav";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAvailability } from "@/hooks/use-availability";
import { longDate, todayIso } from "@/lib/date";
import type { AvailabilitySlot } from "@/lib/api";
import { NewReservationDialog } from "@/components/reservation/new-reservation-dialog";

export function AvailabilityView({ venueId }: { venueId: string }) {
  const [date, setDate] = useState(todayIso());
  const [partySize, setPartySize] = useState(2);
  const [slot, setSlot] = useState<{ time: string } | null>(null);
  const { data, isPending } = useAvailability(venueId, date, partySize);

  const availability = data?.availability ?? {};
  const services = Object.entries(availability);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Availability"
        description={
          <>
            <span className="first-letter:uppercase">{longDate(date)}</span> · Pick a free time to
            book a table for {partySize} {partySize === 1 ? "guest" : "guests"}.
          </>
        }
        actions={
          <>
            <DayNav date={date} onChange={setDate} />
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                aria-label="Fewer guests"
                disabled={partySize <= 1}
                onClick={() => setPartySize((n) => Math.max(1, n - 1))}
              >
                <MinusIcon />
              </Button>
              <Input
                type="number"
                min={1}
                value={partySize}
                onChange={(e) => setPartySize(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
                className="w-16 text-center tabular-nums"
                aria-label="Party size"
              />
              <Button
                variant="outline"
                size="icon"
                aria-label="More guests"
                onClick={() => setPartySize((n) => n + 1)}
              >
                <PlusIcon />
              </Button>
            </div>
          </>
        }
      />

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : services.length === 0 ? (
        <EmptyState
          icon={CalendarXIcon}
          title="No services configured"
          description="Add services under Settings to see free tables."
        />
      ) : (
        <div className="space-y-6">
          {services.map(([service, slots]) => (
            <ServiceSlots
              key={service}
              service={service}
              slots={slots}
              onSelect={(time) => setSlot({ time })}
            />
          ))}
        </div>
      )}

      <NewReservationDialog
        venueId={venueId}
        date={date}
        time={slot?.time ?? ""}
        partySize={partySize}
        open={Boolean(slot)}
        onOpenChange={(open) => !open && setSlot(null)}
      />
    </div>
  );
}

function ServiceSlots({
  service,
  slots,
  onSelect,
}: {
  service: string;
  slots: AvailabilitySlot[];
  onSelect: (time: string) => void;
}) {
  const free = slots.filter((s) => s.available).length;
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h3 className="font-display text-lg first-letter:uppercase">{service}</h3>
        <span className="text-sm text-muted-foreground tabular-nums">
          {free} of {slots.length} free
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2 rounded-xl border bg-card p-4">
        {slots.map((slot) => (
          <Button
            key={slot.time}
            type="button"
            variant="outline"
            disabled={!slot.available}
            onClick={() => onSelect(slot.time)}
            className={cn(
              "h-10 tabular-nums",
              slot.available
                ? "border-primary/30 text-primary hover:border-primary hover:bg-accent"
                : "border-transparent bg-muted/60 text-muted-foreground line-through",
            )}
          >
            {slot.time}
          </Button>
        ))}
      </div>
    </section>
  );
}
