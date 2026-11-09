import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArmchairIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWaitlist } from "@/hooks/use-waitlist";
import { api } from "@/lib/api";
import { AddWaitlistDialog } from "./add-waitlist-dialog";

export function WaitlistView({ venueId }: { venueId: string }) {
  const queryClient = useQueryClient();
  const { data, isPending } = useWaitlist(venueId);
  const [addOpen, setAddOpen] = useState(false);
  const entries = data?.entries ?? [];

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
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not seat."),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelWaitlist(venueId, id),
    onSuccess: () => {
      toast.success("Removed from the waitlist");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not remove."),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Waitlist</h2>
          <p className="text-sm text-muted-foreground">
            Guests waiting for a table.
          </p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <PlusIcon className="size-4" /> Add
        </Button>
      </div>

      {isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <ArmchairIcon className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No one is waiting.</p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Guest</TableHead>
                <TableHead>Party</TableHead>
                <TableHead>Zone</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <div className="font-medium">{e.guestName || "—"}</div>
                    {e.guestContact && (
                      <div className="text-xs text-muted-foreground">{e.guestContact}</div>
                    )}
                  </TableCell>
                  <TableCell>{e.partySize}</TableCell>
                  <TableCell>
                    {e.zone ? <Badge variant="secondary">{e.zone}</Badge> : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => seat.mutate(e.id)}
                      >
                        Seat
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => cancel.mutate(e.id)}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AddWaitlistDialog venueId={venueId} open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
