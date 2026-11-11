import { useState } from "react";
import { CalendarXIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAvailability } from "@/hooks/use-availability";
import { todayIso } from "@/lib/date";
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
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Availability</h2>
          <p className="text-sm text-muted-foreground">
            Free tables for the selected day and party size.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-fit"
          />
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              value={partySize}
              onChange={(e) => setPartySize(Number(e.target.value) || 1)}
              className="w-24"
              aria-label="Party size"
            />
            <span className="text-sm text-muted-foreground">guests</span>
          </div>
        </div>
      </div>

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
  return (
    <div className="space-y-3">
      <h3 className="font-medium capitalize">{service}</h3>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
        {slots.map((slot) => (
          <Button
            key={slot.time}
            type="button"
            variant={slot.available ? "outline" : "ghost"}
            disabled={!slot.available}
            onClick={() => onSelect(slot.time)}
            className="h-9"
          >
            {slot.time}
          </Button>
        ))}
      </div>
    </div>
  );
}
