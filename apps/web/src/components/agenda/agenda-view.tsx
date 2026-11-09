import { useState } from "react";
import { CalendarPlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { useAgenda } from "@/hooks/use-agenda";
import { todayIso } from "@/lib/date";
import type { Reservation } from "@/lib/api";

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  booked: "default",
  seated: "secondary",
  attended: "outline",
  no_show: "destructive",
  cancelled: "destructive",
};

export function AgendaView({ venueId }: { venueId: string }) {
  const [date, setDate] = useState(todayIso());
  const { data, isPending } = useAgenda(venueId, date);
  const reservations = data?.reservations ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Agenda</h2>
          <p className="text-sm text-muted-foreground">
            Reservations for the selected day.
          </p>
        </div>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-fit"
        />
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {reservations.map((r) => (
                <ReservationRow key={r.id} reservation={r} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function ReservationRow({ reservation }: { reservation: Reservation }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{reservation.time}</TableCell>
      <TableCell>{reservation.guest.name ?? "—"}</TableCell>
      <TableCell>{reservation.partySize}</TableCell>
      <TableCell>
        <Badge variant={statusVariant[reservation.status] ?? "outline"}>
          {reservation.status}
        </Badge>
      </TableCell>
    </TableRow>
  );
}
