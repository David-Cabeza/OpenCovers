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
import { WalkInDialog } from "@/components/reservation/walk-in-dialog";
import { useAgenda } from "@/hooks/use-agenda";
import { api, type Reservation } from "@/lib/api";
import { todayIso } from "@/lib/date";

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

function guestInitials(name?: string): string {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

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
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <CalendarPlusIcon className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No reservations for this day.
          </p>
        </div>
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
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <WalkInDialog venueId={venueId} open={walkInOpen} onOpenChange={setWalkInOpen} />
    </div>
  );
}

function ReservationRow({
  reservation,
  onCancel,
  onStatus,
}: {
  reservation: Reservation;
  onCancel: () => void;
  onStatus: (status: string) => void;
}) {
  const actions = rowActions(reservation.status);

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
        {actions.length > 0 && (
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
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  );
}
