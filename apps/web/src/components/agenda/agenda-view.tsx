import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarPlusIcon, MoreHorizontalIcon } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EditReservationDialog } from "@/components/reservation/edit-reservation-dialog";
import { WalkInDialog } from "@/components/reservation/walk-in-dialog";
import { EmptyState } from "@/components/empty-state";
import { useAgenda } from "@/hooks/use-agenda";
import { api, type Reservation } from "@/lib/api";
import { todayIso } from "@/lib/date";
import { guestInitials } from "@/lib/format";

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  booked: "default",
  seated: "secondary",
  attended: "outline",
  no_show: "destructive",
  cancelled: "destructive",
};

const statusLabel: Record<string, string> = {
  booked: "Booked",
  seated: "Seated",
  attended: "Attended",
  no_show: "No-show",
  cancelled: "Cancelled",
};

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

export function AgendaView({ venueId }: { venueId: string }) {
  const [date, setDate] = useState(todayIso());
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [editing, setEditing] = useState<Reservation | null>(null);
  const queryClient = useQueryClient();
  const { data, isPending } = useAgenda(venueId, date);
  const reservations = data?.reservations ?? [];

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
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not cancel."),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.setStatus(venueId, id, status),
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not update."),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Agenda</h2>
          <p className="text-sm text-muted-foreground">
            Reservations for the selected day.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setWalkInOpen(true)}>
            Walk-in
          </Button>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-fit"
          />
        </div>
      </div>

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : reservations.length === 0 ? (
        <EmptyState
          icon={CalendarPlusIcon}
          title="No reservations"
          description="Nothing booked for this day yet."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Guest</TableHead>
                <TableHead>Party</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {reservations.map((r) => (
                <ReservationRow
                  key={r.id}
                  reservation={r}
                  onCancel={() => cancel.mutate(r.id)}
                  onStatus={(status) => setStatus.mutate({ id: r.id, status })}
                  onEdit={() => setEditing(r)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <WalkInDialog venueId={venueId} open={walkInOpen} onOpenChange={setWalkInOpen} />
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
  onCancel,
  onStatus,
  onEdit,
}: {
  reservation: Reservation;
  onCancel: () => void;
  onStatus: (status: string) => void;
  onEdit: () => void;
}) {
  const actions = rowActions(reservation.status);
  const canEdit = ["booked", "seated", "attended"].includes(reservation.status);

  return (
    <TableRow>
      <TableCell className="font-medium tabular-nums">{reservation.time}</TableCell>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar className="size-8">
            <AvatarFallback className="text-xs">
              {guestInitials(reservation.guest.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate font-medium">
              {reservation.guest.name || "—"}
            </div>
            {reservation.guest.contact && (
              <div className="truncate text-xs text-muted-foreground">
                {reservation.guest.contact}
              </div>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell>{reservation.partySize}</TableCell>
      <TableCell>
        <Badge variant={statusVariant[reservation.status] ?? "outline"}>
          {statusLabel[reservation.status] ?? reservation.status}
        </Badge>
      </TableCell>
      <TableCell>
        {(actions.length > 0 || canEdit) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreHorizontalIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {actions.map((action) => (
                <DropdownMenuItem
                  key={action.label}
                  onSelect={() =>
                    action.kind === "cancel"
                      ? onCancel()
                      : onStatus(action.status)
                  }
                >
                  {action.label}
                </DropdownMenuItem>
              ))}
              {canEdit && (
                <DropdownMenuItem onSelect={onEdit}>Edit consent and rating</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  );
}
