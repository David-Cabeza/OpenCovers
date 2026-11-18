import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

/**
 * An unavailable time slot. It stays muted but is clickable: a click opens a popover that asks
 * the API why the time cannot be booked and offers the nearest free times.
 */
export function SlotExplanation({
  venueId,
  date,
  time,
  partySize,
  onPickNearest,
}: {
  venueId: string;
  date: string;
  time: string;
  partySize: number;
  onPickNearest: (time: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data, isPending, isError } = useQuery({
    queryKey: ["availability-explain", venueId, date, time, partySize],
    queryFn: () => api.explainAvailability(venueId, date, time, partySize),
    enabled: open,
    staleTime: 15_000,
    retry: false,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* An anchor, not a trigger: the controlled state alone decides when it opens. */}
      <PopoverAnchor asChild>
        <Button
          type="button"
          variant="outline"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="h-10 border-transparent bg-muted/60 tabular-nums text-muted-foreground line-through"
        >
          {time}
        </Button>
      </PopoverAnchor>
      <PopoverContent aria-label={`Why ${time} is not available`} className="space-y-2">
        <p className="text-sm font-medium">Why {time} is not available</p>
        {isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">Could not load the explanation.</p>
        ) : (
          <>
            <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
              {data.reasons.map((r, i) => (
                <li key={`${r.code}-${i}`}>{r.message}</li>
              ))}
            </ul>
            {data.nearest.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <p className="text-xs font-medium text-muted-foreground">Nearest free times</p>
                <div className="flex flex-wrap gap-1.5">
                  {data.nearest.map((t) => (
                    <Button
                      key={t}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="tabular-nums"
                      onClick={() => {
                        setOpen(false);
                        onPickNearest(t);
                      }}
                    >
                      {t}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
