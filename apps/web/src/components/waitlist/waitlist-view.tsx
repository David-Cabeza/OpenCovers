import { ConfirmDialog } from "@/components/confirm-dialog";
import { errorMessage } from "@/lib/error-message";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArmchairIcon, PlusIcon, Trash2Icon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Pill } from "@/components/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/stat";
import { useWaitlist } from "@/hooks/use-waitlist";
import { api, type WaitlistEntry } from "@/lib/api";
import { elapsed } from "@/lib/date";
import { guestInitials } from "@/lib/format";
import { AddWaitlistDialog } from "./add-waitlist-dialog";

export function WaitlistView({ venueId }: { venueId: string }) {
  const queryClient = useQueryClient();
  const { data, isPending } = useWaitlist(venueId);
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
      toast.success("Guest seated");
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not seat.")),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelWaitlist(venueId, id),
    onSuccess: () => {
      toast.success("Removed from the waitlist");
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not remove.")),
    onSettled: () => setRemoving(null),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Waitlist"
        description="Guests waiting for a table, longest wait first."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <PlusIcon /> Add
          </Button>
        }
      />

      {isPending ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((n) => (
              <Skeleton key={n} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-32 w-full" />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={ArmchairIcon}
          title="No one is waiting"
          description="Add a guest when the room is full and a table will open up."
        />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Parties" value={entries.length} />
            <Stat label="Guests" value={entries.reduce((n, e) => n + e.partySize, 0)} />
            <Stat label="Longest wait" value={elapsed(entries[0].createdAt)} />
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
        title={removing ? `Remove ${removing.guestName || "this guest"} from the waitlist?` : "Remove from the waitlist?"}
        description="They lose their place in the queue. Add them again if they come back."
        confirmLabel="Remove from waitlist"
        keepLabel="Keep on waitlist"
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
  return (
    <li
      data-slot="waitlist-row"
      className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/40 md:grid-cols-[2rem_minmax(0,1fr)_4rem_7rem_8rem_auto] md:gap-x-4"
    >
      <span
        aria-label={`Position ${position}`}
        className="flex size-8 items-center justify-center rounded-full bg-muted font-display text-sm tabular-nums"
      >
        {position}
      </span>
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="size-9">
          <AvatarFallback className="text-xs">{guestInitials(entry.guestName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate font-medium">{entry.guestName || "—"}</div>
          {entry.guestContact && (
            <div className="truncate text-xs text-muted-foreground">{entry.guestContact}</div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-1 md:order-last">
        <Button variant="outline" size="sm" onClick={onSeat}>
          Seat
        </Button>
        <Button variant="ghost" size="icon" aria-label="Remove from the waitlist" onClick={onRemove}>
          <Trash2Icon className="size-4" />
        </Button>
      </div>
      <div className="col-span-3 col-start-1 flex flex-wrap items-center gap-x-4 gap-y-2 pl-[calc(2rem+0.75rem)] md:contents">
        <span className="inline-flex items-center gap-1.5 text-sm tabular-nums text-muted-foreground">
          <UsersIcon className="size-4" aria-hidden="true" />
          <span className="sr-only">Party of </span>
          {entry.partySize}
        </span>
        <span className="text-sm text-muted-foreground tabular-nums">
          Waiting <span className="font-medium text-foreground">{elapsed(entry.createdAt)}</span>
        </span>
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
