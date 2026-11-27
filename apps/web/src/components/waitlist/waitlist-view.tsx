import { ConfirmDialog } from "@/components/confirm-dialog";
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { ArmchairIcon, PlusIcon, Trash2Icon, UsersIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/layout/page-header";
import { Pill } from "@/components/pill";
import { StaleNotice } from "@/components/stale-notice";
import { EditReservationDialog } from "@/components/reservation/edit-reservation-dialog";
import { Loading, Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/stat";
import { useCanRecordDietary } from "@/hooks/use-can-record-dietary";
import { useDietaryShortcut } from "@/hooks/use-dietary-shortcut";
import { useStaleMessage } from "@/hooks/use-stale-message";
import { useVenueToday } from "@/hooks/use-venue-today";
import { useWaitlist } from "@/hooks/use-waitlist";
import { useT } from "@/i18n";
import { api, type WaitlistEntry } from "@/lib/api";
import { elapsed, longDate } from "@/lib/date";
import { errorMessage, isApiError } from "@/lib/error-message";
import { guestInitials } from "@/lib/format";
import { AddWaitlistDialog } from "./add-waitlist-dialog";

/** How long a row that a refresh just moved ignores Seat and Remove. */
const MOVED_HOLD_MS = 1000;

export function WaitlistView({ venueId }: { venueId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  // A seat is a walk-in now, so the API seats only entries for the venue's today, and those with no date.
  const { today, readToday } = useVenueToday(venueId);
  // "" is the default list: today and the entries with no date. A date shows the entries guests asked for that day.
  const [filterDate, setFilterDate] = useState("");
  const waitlist = useWaitlist(venueId, filterDate || undefined, { live: true });
  const { data, isPending, isError, error, isRefetching, refetch } = waitlist;
  const staleMessage = useStaleMessage([waitlist]);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<WaitlistEntry | null>(null);
  // The last booking seated from here. A toast would be gone before a busy host gets to it, so the shortcut to its
  // allergies stays on the page until it is used or dismissed.
  const [seated, setSeated] = useState<{ id: string; venueId: string; name: string } | null>(null);
  const canRecordDietary = useCanRecordDietary(venueId);
  const shortcut = useDietaryShortcut(venueId);
  const addButton = useRef<HTMLButtonElement>(null);
  const saved = useRef(false);
  const list = useRef<HTMLOListElement>(null);
  // The place in the list of the row the remove confirmation was opened from.
  const removingFrom = useRef({ id: "", index: 0 });
  // The place of a row that left the list with the keyboard focus in it.
  const focusLeftAt = useRef<number | null>(null);
  // Where the focus of such a row was put when no row was left.
  const parked = useRef<HTMLElement | null>(null);
  // First come, first seated: the queue is shown oldest first.
  const entries = [...(data?.entries ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // A press aimed at one party must not land on the one a refresh has just put in its place.
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  const takenHere = useRef(new Set<string>());
  const shown = useRef<{ list: string; ids: string[] }>({ list: "", ids: [] });
  const listKey = `${venueId} ${filterDate}`;
  useLayoutEffect(() => {
    const before = shown.current;
    const ids = entries.map((e) => e.id);
    shown.current = { list: listKey, ids };
    if (before.list !== listKey) return;
    // Rows that close up after the user's own seat or removal are expected to move.
    const was = before.ids.filter((id) => !takenHere.current.has(id));
    const moved = ids.filter((id, i) => (was.includes(id) ? was.indexOf(id) !== i : was[i] !== undefined));
    if (moved.length > 0) setHeld((now) => new Set([...now, ...moved]));
    // `entries` is rebuilt on every render and changes only with `data`.
  }, [listKey, data]);
  useEffect(() => {
    if (held.size === 0) return;
    const timer = setTimeout(() => setHeld(new Set()), MOVED_HOLD_MS);
    return () => clearTimeout(timer);
  }, [held]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["waitlist", venueId] });
    void queryClient.invalidateQueries({ queryKey: ["agenda", venueId] });
    void queryClient.invalidateQueries({ queryKey: ["availability", venueId] });
  };

  // The row that took the place of one that is gone. The row itself, not one of its buttons: those act on another party.
  const focusRowAt = (index: number) => {
    const rows = list.current?.querySelectorAll<HTMLElement>('[data-slot="waitlist-row"]');
    const row = rows?.[Math.min(index, rows.length - 1)];
    if (row) return row.focus({ preventScroll: true });
    parked.current = addButton.current;
    parked.current?.focus();
  };

  // A refresh or an action can take away the row the keyboard focus is in.
  useLayoutEffect(() => {
    const index = focusLeftAt.current;
    focusLeftAt.current = null;
    if (index !== null) focusRowAt(index);
  });

  // Someone else, or the guest, can seat or remove an entry that is still on this screen.
  const onActionError = (err: unknown, fallback: string, onlyIfWaiting: boolean) => {
    const gone = onlyIfWaiting && isApiError(err, "invalid_transition");
    toast.error(gone ? t("waitlist.noLongerWaiting") : errorMessage(err, fallback));
    invalidate();
  };

  const seat = useMutation({
    mutationFn: ({ id }: WaitlistEntry) => api.seatWaitlist(venueId, id),
    onSuccess: (reservation, entry) => {
      takenHere.current.add(entry.id);
      setSeated({ id: reservation.id, venueId: reservation.venueId, name: entry.guestName });
      toast.success(t("waitlist.seated"));
      invalidate();
    },
    onError: (err, entry) => {
      // An entry for another day is refused with the code of a gone one, while it still waits. The day may have just
      // changed, so the clock is asked again.
      if (isApiError(err, "invalid_transition") && entry.date && entry.date !== readToday()) {
        toast.error(t("waitlist.otherDay", { date: longDate(entry.date) }));
        invalidate();
        return;
      }
      onActionError(err, t("waitlist.seatFailed"), true);
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelWaitlist(venueId, id),
    onSuccess: (_, id) => {
      takenHere.current.add(id);
      toast.success(t("waitlist.removed"));
      invalidate();
    },
    onError: (err) => onActionError(err, t("waitlist.removeFailed"), true),
    onSettled: () => setRemoving(null),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("waitlist.title")}
        description={t("waitlist.subtitle")}
        actions={
          <Button ref={addButton} onClick={() => setAddOpen(true)}>
            <PlusIcon /> {t("common.add")}
          </Button>
        }
      />

      {/* The view is not remounted when the venue changes. */}
      {canRecordDietary && seated?.venueId === venueId && (
        <SeatedNotice
          key={seated.id}
          name={seated.name}
          parked={parked}
          onRecord={() => void shortcut.open(seated.id)}
          onDismiss={() => {
            setSeated(null);
            addButton.current?.focus();
          }}
        />
      )}

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

          <ol ref={list} className="divide-y overflow-hidden rounded-xl border bg-card">
            {entries.map((e, index) => (
              <WaitlistRow
                key={e.id}
                entry={e}
                position={index + 1}
                held={held.has(e.id)}
                otherDay={e.date && e.date !== today ? e.date : null}
                onSeat={() => seat.mutate(e)}
                onRemove={() => {
                  removingFrom.current = { id: e.id, index };
                  setRemoving(e);
                }}
                onFocusLeft={() => {
                  focusLeftAt.current = index;
                }}
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
        // The row may be gone, and with it the button the dialog would return focus to.
        onCloseAutoFocus={(event) => {
          const { id, index } = removingFrom.current;
          if (entries.some((e) => e.id === id)) return;
          event.preventDefault();
          focusRowAt(index);
        }}
      />
      <AddWaitlistDialog venueId={venueId} open={addOpen} onOpenChange={setAddOpen} />
      <EditReservationDialog
        venueId={venueId}
        reservation={shortcut.reservation}
        startOnDietary
        onOpenChange={(open) => !open && shortcut.close()}
        onSaved={() => {
          saved.current = true;
          setSeated(null);
        }}
        // Saving takes the notice away, and with it the button the dialog would return focus to.
        onCloseAutoFocus={(event) => {
          if (!saved.current) return;
          saved.current = false;
          event.preventDefault();
          addButton.current?.focus();
        }}
      />
      <StaleNotice message={staleMessage} />
    </div>
  );
}

function SeatedNotice({
  name,
  parked,
  onRecord,
  onDismiss,
}: {
  name: string;
  parked: RefObject<HTMLElement | null>;
  onRecord: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const textId = useId();
  const record = useRef<HTMLButtonElement>(null);

  // The seated row leaves the list, and would take the keyboard focus with it.
  useEffect(() => {
    const active = document.activeElement;
    const lost = active === document.body || active === parked.current || active?.closest('[data-slot="waitlist-row"]');
    if (lost) record.current?.focus();
  }, [parked]);

  return (
    <div data-slot="seated-notice" className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-3">
      <p id={textId} className="min-w-0 flex-1 basis-48 break-words text-sm">
        {name ? t("dietary.shortcut.seated", { name }) : t("dietary.shortcut.seatedUnnamed")}
      </p>
      <Button ref={record} variant="outline" size="sm" aria-describedby={textId} onClick={onRecord}>
        {t("dietary.shortcut.record")}
      </Button>
      <Button variant="ghost" size="icon" aria-label={t("common.close")} onClick={onDismiss}>
        <XIcon className="size-4" />
      </Button>
    </div>
  );
}

function WaitlistRow({
  entry,
  position,
  held,
  otherDay,
  onSeat,
  onRemove,
  onFocusLeft,
}: {
  entry: WaitlistEntry;
  position: number;
  held: boolean;
  /** The day the entry is for, when it is not today and so it cannot be seated. */
  otherDay: string | null;
  onSeat: () => void;
  onRemove: () => void;
  onFocusLeft: () => void;
}) {
  const t = useT();
  const row = useRef<HTMLLIElement>(null);
  const otherDayId = useId();
  const leave = useRef(onFocusLeft);
  useLayoutEffect(() => {
    leave.current = onFocusLeft;
  });
  // A layout cleanup runs while the row is still in the page, so it can tell whether the focus is in it.
  useLayoutEffect(() => {
    const node = row.current;
    return () => {
      if (node?.contains(document.activeElement)) leave.current();
    };
  }, []);

  return (
    <li
      ref={row}
      tabIndex={-1}
      data-slot="waitlist-row"
      className="focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/40 md:grid-cols-[2rem_minmax(0,1fr)_3rem_7rem_6rem_auto] md:gap-x-3 xl:grid-cols-[2rem_minmax(0,1fr)_4rem_7rem_8rem_auto] xl:gap-x-4"
    >
      <span
        aria-label={t("waitlist.position", { position })}
        className="flex size-8 items-center justify-center rounded-full bg-muted font-display text-sm tabular-nums"
      >
        {position}
      </span>
      <div className="flex min-w-0 items-center gap-3 max-sm:col-span-2">
        <Avatar className="size-9 max-sm:hidden">
          <AvatarFallback className="text-xs">{guestInitials(entry.guestName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="line-clamp-2 break-words font-medium md:line-clamp-1" title={entry.guestName || undefined}>{entry.guestName || "—"}</div>
          {entry.guestContact && (
            <div className="truncate text-xs text-muted-foreground">{entry.guestContact}</div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-1 max-sm:order-last max-sm:col-span-3 md:order-last">
        {/* Not `disabled`, which would drop the keyboard focus. */}
        <Button
          variant="outline"
          size="sm"
          aria-disabled={held || otherDay !== null || undefined}
          aria-describedby={otherDay ? otherDayId : undefined}
          className="aria-disabled:opacity-50"
          onClick={held || otherDay ? undefined : onSeat}
        >
          {t("waitlist.seat")}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("waitlist.remove")}
          aria-disabled={held || undefined}
          className="aria-disabled:opacity-50"
          onClick={held ? undefined : onRemove}
        >
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
      {/* On the page, not in a tooltip, which a touch screen never shows. Last, so it takes a line of its own. */}
      {otherDay && (
        <p
          id={otherDayId}
          data-slot="waitlist-other-day"
          className="order-last col-span-full pl-[calc(2rem+0.75rem)] text-sm text-muted-foreground"
        >
          {t("waitlist.otherDay", { date: longDate(otherDay) })}
        </p>
      )}
    </li>
  );
}
