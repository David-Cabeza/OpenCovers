import { Pill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useReservationTrace } from "@/hooks/use-reservation-trace";
import { errorMessage } from "@/lib/error-message";
import { traceTime } from "@/lib/reservation-trace";
import type { Reservation } from "@/lib/api";

export function ReservationTraceDialog({
  venueId,
  reservation,
  onOpenChange,
}: {
  venueId: string;
  reservation: Reservation | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isPending, isError, error, refetch } = useReservationTrace(
    venueId,
    reservation?.id ?? null,
  );

  return (
    <Dialog open={reservation !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reservation trace</DialogTitle>
          <DialogDescription>
            {reservation?.guest.name
              ? `How the booking for ${reservation.guest.name} was made and what happened to it.`
              : "How this booking was made and what happened to it."}
          </DialogDescription>
        </DialogHeader>

        {isPending ? (
          <div className="space-y-3" role="status" aria-label="Loading the trace">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isError ? (
          <div role="alert" className="space-y-3 rounded-lg border border-destructive/30 p-4 text-sm">
            <p>{errorMessage(error, "Could not load the trace.")}</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-lg bg-muted/50 p-3 text-sm">
              <dt className="text-muted-foreground">Came from</dt>
              <dd className="font-medium">{data.sourceLabel}</dd>
              <dt className="text-muted-foreground">Made by</dt>
              <dd className="min-w-0 truncate font-medium">{data.actorLabel}</dd>
            </dl>

            {data.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No events are kept for this booking. They are removed after the retention period.
              </p>
            ) : (
              <ol aria-label="Events" className="space-y-3">
                {data.entries.map((entry) => (
                  <li key={entry.id} className="space-y-1 border-l-2 pl-3">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Pill tone={entry.tone} dot>
                        {entry.label}
                      </Pill>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        Version {entry.version}
                      </span>
                      <time
                        dateTime={entry.occurredAt}
                        className="text-xs tabular-nums text-muted-foreground"
                      >
                        {traceTime(entry.occurredAt)}
                      </time>
                    </div>
                    {entry.idempotencyKey && (
                      <p className="truncate text-xs text-muted-foreground">
                        Idempotency key{" "}
                        <code className="font-mono text-foreground">{entry.idempotencyKey}</code>
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
