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
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/error-message";
import { actorLabel, channelLabel, eventLabel, traceTime } from "@/lib/reservation-trace";
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
  const t = useT();
  const { data, isPending, isError, error, refetch } = useReservationTrace(
    venueId,
    reservation?.id ?? null,
  );

  return (
    <Dialog open={reservation !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("reservation.trace.title")}</DialogTitle>
          <DialogDescription>
            {reservation?.guest.name
              ? t("reservation.trace.descriptionNamed", { name: reservation.guest.name })
              : t("reservation.trace.description")}
          </DialogDescription>
        </DialogHeader>

        {isPending ? (
          <div className="space-y-3" role="status" aria-label={t("reservation.trace.loading")}>
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isError ? (
          <div role="alert" className="space-y-3 rounded-lg border border-destructive/30 p-4 text-sm">
            <p>{errorMessage(error, t("reservation.trace.failed"))}</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              {t("common.tryAgain")}
            </Button>
          </div>
        ) : (
          <div className="min-w-0 space-y-4">
            {data.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("reservation.trace.empty")}
              </p>
            ) : (
              <ol aria-label={t("reservation.trace.events")} className="space-y-3">
                {data.entries.map((entry) => (
                  <li key={entry.id} className="space-y-1 border-l-2 pl-3">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Pill tone={entry.tone} dot>
                        {eventLabel(entry.type).label}
                      </Pill>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {t("reservation.trace.version", { version: entry.version })}
                      </span>
                      <time
                        dateTime={entry.occurredAt}
                        className="text-xs tabular-nums text-muted-foreground"
                      >
                        {traceTime(entry.occurredAt)}
                      </time>
                    </div>
                    <p className="break-words text-sm font-medium">
                      {channelLabel(entry)}
                      {actorLabel(entry) && (
                        <span className="font-normal text-muted-foreground"> · {actorLabel(entry)}</span>
                      )}
                    </p>
                    {entry.idempotencyKey && (
                      <p className="break-all text-xs text-muted-foreground">
                        {t("reservation.trace.idempotencyKey")}{" "}
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
