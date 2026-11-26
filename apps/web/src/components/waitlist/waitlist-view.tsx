import { ConfirmDialog } from "@/components/confirm-dialog";
import { errorMessage } from "@/lib/error-message";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { ArmchairIcon, PlusIcon, Trash2Icon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/layout/page-header";
import { Pill } from "@/components/pill";
import { Loading, Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/stat";
import { useWaitlist } from "@/hooks/use-waitlist";
import { useT } from "@/i18n";
import { api, type WaitlistEntry } from "@/lib/api";
import { elapsed, longDate } from "@/lib/date";
import { guestInitials } from "@/lib/format";
import { AddWaitlistDialog } from "./add-waitlist-dialog";

export function WaitlistView({ venueId }: { venueId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  // "" is the default list: today and the entries with no date. A date shows the entries guests asked for that day.
  const [filterDate, setFilterDate] = useState("");
  const { data, isPending, isError, error, isRefetching, refetch } = useWaitlist(venueId, filterDate || undefined);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<WaitlistEntry | null>(null);
  // First come, first seated: the queue is shown oldest first.
  const entries = [...(data?.entries ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["waitlist", venueId] });
    void queryClient.invalidateQueries({ queryKey: ["agenda", venueId] });
    void queryClient.invalidateQueries({ queryKey: ["availability", venueId] });
  };

  const seat = useMutation({
    mutationFn: (id: string) => api.seatWaitlist(venueId, id),
    onSuccess: () => {
      toast.success(t("waitlist.seated"));
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err, t("waitlist.seatFailed"))),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelWaitlist(venueId, id),
    onSuccess: () => {
      toast.success(t("waitlist.removed"));
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err, t("waitlist.removeFailed"))),
    onSettled: () => setRemoving(null),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("waitlist.title")}
        description={t("waitlist.subtitle")}
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <PlusIcon /> {t("common.add")}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          aria-label={t("waitlist.filter.date")}
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          className="w-fit"
        />
        {filterDate && (
          <Button variant="ghost" onClick={() => setFilterDate("")}>
            {t("waitlist.filter.clear")}
          </Button>
        )}
      </div>

      {isPending ? (
        <Loading className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((n) => (
              <Skeleton key={n} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-32 w-full" />
        </Loading>
      ) : isError && !data ? (
        <LoadError what={t("waitlist.loadWhat")} error={error} retrying={isRefetching} onRetry={() => void refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={ArmchairIcon}
          title={t("waitlist.empty.title")}
          description={t("waitlist.empty.description")}
        />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label={t("waitlist.stat.parties")} value={entries.length} />
            <Stat label={t("waitlist.stat.guests")} value={entries.reduce((n, e) => n + e.partySize, 0)} />
            <Stat label={t("waitlist.stat.longestWait")} value={elapsed(entries[0].createdAt)} />
          </div>

          <ol className="divide-y overflow-hidden rounded-xl border bg-card">
            {entries.map((e, index) => (
              <WaitlistRow
                key={e.id}
                entry={e}
                position={index + 1}
                onSeat={() => seat.mutate(e.id)}
                onRemove={() => setRemoving(e)}
              />
            ))}
          </ol>
        </>
      )}

      <ConfirmDialog
        open={removing !== null}
        title={
          removing
            ? removing.guestName
              ? t("waitlist.removeTitleNamed", { name: removing.guestName })
              : t("waitlist.removeTitleGuest")
            : t("waitlist.removeTitle")
        }
        description={t("waitlist.removeDescription")}
        confirmLabel={t("waitlist.removeConfirm")}
        keepLabel={t("waitlist.keep")}
        pending={cancel.isPending}
        onConfirm={() => removing && cancel.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />
      <AddWaitlistDialog venueId={venueId} open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

function WaitlistRow({
  entry,
  position,
  onSeat,
  onRemove,
}: {
  entry: WaitlistEntry;
  position: number;
  onSeat: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <li
      data-slot="waitlist-row"
      className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/40 md:grid-cols-[2rem_minmax(0,1fr)_4rem_7rem_8rem_auto] md:gap-x-4"
    >
      <span
        aria-label={t("waitlist.position", { position })}
        className="flex size-8 items-center justify-center rounded-full bg-muted font-display text-sm tabular-nums"
      >
        {position}
      </span>
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="size-9">
          <AvatarFallback className="text-xs">{guestInitials(entry.guestName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="line-clamp-2 break-words font-medium md:line-clamp-1" title={entry.guestName || undefined}>{entry.guestName || "—"}</div>
          {entry.guestContact && (
            <div className="truncate text-xs text-muted-foreground">{entry.guestContact}</div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-1 md:order-last">
        <Button variant="outline" size="sm" onClick={onSeat}>
          {t("waitlist.seat")}
        </Button>
        <Button variant="ghost" size="icon" aria-label={t("waitlist.remove")} onClick={onRemove}>
          <Trash2Icon className="size-4" />
        </Button>
      </div>
      <div className="col-span-3 col-start-1 flex flex-wrap items-center gap-x-4 gap-y-2 pl-[calc(2rem+0.75rem)] md:contents">
        <span className="inline-flex items-center gap-1.5 text-sm tabular-nums text-muted-foreground">
          <UsersIcon className="size-4" aria-hidden="true" />
          <span className="sr-only">{t("common.partyOf", { count: entry.partySize })}</span>
          <span aria-hidden="true">{entry.partySize}</span>
        </span>
        <span className="text-sm text-muted-foreground tabular-nums">
          {t("waitlist.waiting")} <span className="font-medium text-foreground">{elapsed(entry.createdAt)}</span>
        </span>
        {entry.date && (
          <span data-slot="waitlist-date" className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{longDate(entry.date)}</span>
            {entry.windowStart && entry.windowEnd ? ` · ${entry.windowStart}–${entry.windowEnd}` : ""}
          </span>
        )}
        {entry.source === "widget" && <Pill tone="muted">{t("waitlist.source.widget")}</Pill>}
        {entry.zone ? (
          <Pill tone="muted">{entry.zone}</Pill>
        ) : (
          <span aria-hidden="true" className="hidden text-muted-foreground md:inline">
            —
          </span>
        )}
      </div>
    </li>
  );
}
