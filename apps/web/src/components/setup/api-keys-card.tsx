import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useVenueKeys } from "@/hooks/use-venue-keys";
import { api } from "@/lib/api";
import { CreateKeyDialog } from "./create-key-dialog";

export function ApiKeysCard({ venueId }: { venueId: string }) {
  const queryClient = useQueryClient();
  const { data, isPending } = useVenueKeys(venueId);
  const [open, setOpen] = useState(false);
  const keys = data?.keys ?? [];

  const revoke = useMutation({
    mutationFn: (hash: string) => api.revokeVenueKey(venueId, hash),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["keys", venueId] });
      toast.success("Key revoked");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not revoke."),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>API keys</CardTitle>
          <CardDescription>
            Keys for platforms and AI agents to access this venue.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <PlusIcon className="size-4" /> New key
        </Button>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : keys.length === 0 ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <KeyRoundIcon className="size-4" /> No keys yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Principal</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.hash}>
                  <TableCell className="font-medium">{k.principal}</TableCell>
                  <TableCell>
                    <Badge variant={k.role === "write" ? "default" : "secondary"}>
                      {k.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => revoke.mutate(k.hash)}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <CreateKeyDialog venueId={venueId} open={open} onOpenChange={setOpen} />
    </Card>
  );
}
