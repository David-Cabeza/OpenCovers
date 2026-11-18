import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarPlusIcon,
  MoreHorizontalIcon,
  UsersIcon,
} from "lucide-react";
import { cn } from "cn";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { DayNav } from "@/components/day-nav";
import { PageHeader } from "@/components/layout/page-header";
import { Stat } from "@/components/stat";
import { StatusBadge } from "./status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { AssignTablesDialog } from "@/components/reservation/assign-tables-dialog";
import { CancelReservationDialog } from "@/components/reservation/cancel-reservation-dialog";
import { EditReservationDialog } from "@/components/reservation/edit-reservation-dialog";
import { WalkInDialog } from "@/components/reservation/walk-in-dialog";
import { EmptyState } from "@/components/empty-state";
import { useAgenda } from "@/hooks/use-agenda";
import { useTables } from "@/hooks/use-tables";
import { api, type Reservation } from "@/lib/api";
import { longDate, todayIso } from "@/lib/date";
import { errorMessage, isApiError } from "@/lib/error-message";
import { guestInitials } from "@/lib/format";

type RowAction =
  | { kind: "status"; label: string; status: string }
  | { kind: "cancel"; label: string };

function rowActions(status: string): RowAction[] {
  switch (status) {
    case "booked":
      return [
        { kind: "status", label: "Seat", status: "seated" },
        { kind: "status", label: "No-show", status: "no_show" },
        { kind: "cancel", label: "Cancel" },
      ];
    case "seated":
      return [
        { kind: "status", label: "Mark attended", status: "attended" },
        { kind: "cancel", label: "Cancel" },
      ];
    default:
      return [];
  }
}

function groupByService(reservations: Reservation[]) {
  const groups: { service: string; items: Reservation[] }[] = [];
  for (const r of reservations) {
    const group = groups.find((g) => g.service === r.service);
    if (group) group.items.push(r);
    else groups.push({ service: r.service, items: [r] });
  }
  return groups;
}

export function AgendaView({ venueId }: { venueId: string }) {
  const [date, setDate] = useState(todayIso());
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [editing, setEditing] = useState<Reservation | null>(null);
  const [assigning, setAssigning] = useState<Reservation | null>(null);
  const [cancelling, setCancelling] = useState<Reservation | null>(null);
  const queryClient = useQueryClient();
  const { data, isPending } = useAgenda(venueId, date);
  const reservations = data?.reservations ?? [];
  const { data: tablesData } = useTables(venueId);
  const tableNames = new Map((tablesData?.tables ?? []).map((t) => [t.id, t.name]));

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["agenda", venueId] });
    void queryClient.invalidateQueries({ queryKey: ["availability", venueId] });
  };

  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelReservation(venueId, id),
    onSuccess: () => {
      toast.success("Reservation cancelled");
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not cancel.")),
    onSettled: () => setCancelling(null),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.setStatus(venueId, id, status),
    onSuccess: () => invalidate(),
    onError: (err, { id }) => {
      if (isApiError(err, "table_required")) {
        toast.error(errorMessage(err, "Assign a table first."));
        const reservation = reservations.find((r) => r.id === id);
        if (reservation) setAssigning(reservation);
        return;
      }
      toast.error(errorMessage(err, "Could not update."));
    },
  });

  const active = reservations.filter((r) => ["booked", "seated", "attended"].includes(r.status));
  const needTable = active.filter(
    (r) => ["booked", "seated"].includes(r.status) && (r.tables ?? []).length === 0,
  ).length;
  const groups = groupByService(reservations);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agenda"
        description={<span className="first-letter:uppercase">{longDate(date)}</span>}
        actions={
          <>
            <DayNav date={date} onChange={setDate} />
            <Button onClick={() => setWalkInOpen(true)}>Walk-in</Button>
          </>
        }
      />

      {isPending ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((n) => (
              <Skeleton key={n} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      ) : reservations.length === 0 ? (
        <EmptyState
          icon={CalendarPlusIcon}
          title="No reservations"
          description="Nothing booked for this day yet."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Reservations" value={active.length} />
            <Stat label="Covers" value={active.reduce((n, r) => n + r.partySize, 0)} />
            <Stat label="Now seated" value={active.filter((r) => r.status === "seated").length} />
            <Stat label="Needs table" value={needTable} tone={needTable > 0 ? "danger" : "default"} />
          </div>

          {groups.map((group) => (
            <section key={group.service} className="space-y-2">
              <div className="flex items-baseline justify-between gap-3 px-1">
                <h3 className="font-display text-lg first-letter:uppercase">{group.service || "Service"}</h3>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {group.items.length} {group.items.length === 1 ? "booking" : "bookings"} ·{" "}
                  {group.items.reduce((n, r) => n + r.partySize, 0)} covers
                </span>
              </div>
              <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                {group.items.map((r) => (
                  <ReservationRow
                    key={r.id}
                    reservation={r}
                    tableNames={tableNames}
                    onAssign={() => setAssigning(r)}
                    onCancel={() => setCancelling(r)}
                    onStatus={(status) => setStatus.mutate({ id: r.id, status })}
                    onEdit={() => setEditing(r)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}

      <WalkInDialog venueId={venueId} open={walkInOpen} onOpenChange={setWalkInOpen} />
      <AssignTablesDialog
        venueId={venueId}
        reservation={assigning}
        onOpenChange={(open) => {
          if (!open) setAssigning(null);
        }}
      />
      <CancelReservationDialog
        reservation={cancelling}
        pending={cancel.isPending}
        onConfirm={() => cancelling && cancel.mutate(cancelling.id)}
        onClose={() => setCancelling(null)}
      />
      <EditReservationDialog
        venueId={venueId}
        reservation={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </div>
  );
}

function ReservationRow({
  reservation,
  tableNames,
  onAssign,
  onCancel,
  onStatus,
  onEdit,
}: {
  reservation: Reservation;
  tableNames: Map<string, string>;
  onAssign: () => void;
  onCancel: () => void;
  onStatus: (status: string) => void;
  onEdit: () => void;
}) {
  const actions = rowActions(reservation.status);
  const canEdit = ["booked", "seated", "attended"].includes(reservation.status);
  const canAssign = ["booked", "seated"].includes(reservation.status);
  const tableIds = reservation.tables ?? [];

  const finished = reservation.status === "cancelled" || reservation.status === "no_show";

  return (
    <li
      data-slot="reservation-row"
      className={cn(
        "grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/40 md:grid-cols-[4rem_minmax(0,1fr)_4.5rem_9rem_8rem_2.25rem] md:gap-x-4",
        finished && "opacity-60",
      )}
    >
      <div className="font-display text-xl tabular-nums">{reservation.time}</div>
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="size-9">
          <AvatarFallback className="text-xs">{guestInitials(reservation.guest.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate font-medium">{reservation.guest.name || "—"}</div>
          {reservation.guest.contact && (
            <div className="truncate text-xs text-muted-foreground">{reservation.guest.contact}</div>
          )}
        </div>
      </div>
      {(actions.length > 0 || canEdit || canAssign) && (
        <div className="md:order-last">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Reservation actions">
                <MoreHorizontalIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {actions.map((action) => (
                <DropdownMenuItem
                  key={action.label}
                  onSelect={() =>
                    action.kind === "cancel" ? onCancel() : onStatus(action.status)
                  }
                >
                  {action.label}
                </DropdownMenuItem>
              ))}
              {canAssign && (
                <DropdownMenuItem onSelect={onAssign}>
                  {tableIds.length > 0 ? "Change tables" : "Assign tables"}
                </DropdownMenuItem>
              )}
              {canEdit && (
                <DropdownMenuItem onSelect={onEdit}>Edit consent, rating and note</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <div className="col-span-3 col-start-1 flex flex-wrap items-center gap-x-3 gap-y-2 pl-[calc(3.5rem+0.75rem)] md:contents">
        <span className="inline-flex items-center gap-1.5 text-sm tabular-nums text-muted-foreground">
          <UsersIcon className="size-4" aria-hidden="true" />
          <span className="sr-only">Party of </span>
          {reservation.partySize}
        </span>
        <span className="text-sm">
          {tableIds.length > 0 ? (
            tableIds.map((id) => tableNames.get(id) ?? id).join(", ")
          ) : canAssign ? (
            <Badge variant="outline" className="border-transparent bg-danger-soft text-destructive">
              Unassigned
            </Badge>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </span>
        <StatusBadge status={reservation.status} />
      </div>
    </li>
  );
}
