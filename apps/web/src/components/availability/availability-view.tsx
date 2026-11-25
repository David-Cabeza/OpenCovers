import { useState } from "react";
import { CalendarXIcon, MinusIcon, PlusIcon } from "lucide-react";
import { DayNav } from "@/components/day-nav";
import { EmptyState } from "@/components/empty-state";
import { LoadError } from "@/components/load-error";
import { canEditSetup, useNavigation } from "@/components/layout/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAvailability } from "@/hooks/use-availability";
import { useT } from "@/i18n";
import { longDate } from "@/lib/date";
import { useDayParam } from "@/lib/day-param";
import type { AvailabilitySlot } from "@/lib/api";
import { SlotExplanation } from "@/components/availability/slot-explanation";
import { NewReservationDialog } from "@/components/reservation/new-reservation-dialog";

export function AvailabilityView({ venueId }: { venueId: string }) {
  const t = useT();
  const nav = useNavigation();
  const [date, setDate] = useDayParam();
  const [partySize, setPartySize] = useState(2);
  const [slot, setSlot] = useState<{ time: string } | null>(null);
  const { data, isPending, isError, error, isRefetching, refetch } = useAvailability(venueId, date, partySize);

  const availability = data?.availability ?? {};
  const services = Object.entries(availability);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("availability.title")}
        description={
          <>
            <span className="first-letter:uppercase">{longDate(date)}</span> · {t("availability.subtitle", { count: partySize })}
          </>
        }
        actions={
          <>
            <DayNav date={date} onChange={setDate} />
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                aria-label={t("availability.fewerGuests")}
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
                aria-label={t("availability.partySize")}
              />
              <Button
                variant="outline"
                size="icon"
                aria-label={t("availability.moreGuests")}
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
      ) : isError && !data ? (
        <LoadError what={t("availability.loadWhat")} error={error} retrying={isRefetching} onRetry={() => void refetch()} />
      ) : services.length === 0 ? (
        <EmptyState
          icon={CalendarXIcon}
          title={t("availability.empty.title")}
          description={t("availability.empty.description")}
          action={
            nav && canEditSetup(nav.role) ? (
              <Button className="mt-2" onClick={() => nav.goTo("setup", "services")}>
                {t("availability.empty.action")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          {services.map(([service, slots]) => (
            <ServiceSlots
              key={service}
              service={service}
              venueId={venueId}
              date={date}
              partySize={partySize}
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
  venueId,
  date,
  partySize,
  slots,
  onSelect,
}: {
  service: string;
  venueId: string;
  date: string;
  partySize: number;
  slots: AvailabilitySlot[];
  onSelect: (time: string) => void;
}) {
  const t = useT();
  const free = slots.filter((s) => s.available).length;
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="font-display text-lg first-letter:uppercase">{service}</h2>
        <span className="text-sm text-muted-foreground tabular-nums">
          {t("availability.freeOf", { free, total: slots.length })}
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2 rounded-xl border bg-card p-4">
        {slots.map((slot) =>
          slot.available ? (
            <Button
              key={slot.time}
              type="button"
              variant="outline"
              onClick={() => onSelect(slot.time)}
              className="h-10 coarse:h-11 border-primary/30 tabular-nums text-primary hover:border-primary hover:bg-accent"
            >
              {slot.time}
            </Button>
          ) : (
            <SlotExplanation
              key={slot.time}
              venueId={venueId}
              date={date}
              time={slot.time}
              partySize={partySize}
              onPickNearest={onSelect}
            />
          ),
        )}
      </div>
    </section>
  );
}
