import { errorMessage } from "@/lib/error-message";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Pill, type PillTone } from "@/components/pill";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useVenueKeys } from "@/hooks/use-venue-keys";
import { api, type Role } from "@/lib/api";
import { CreateKeyDialog } from "./create-key-dialog";

const ROLE_TONE: Record<Role, PillTone> = { admin: "warning", write: "info", read: "muted" };

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
    onError: (err) => toast.error(errorMessage(err, "Could not revoke.")),
  });

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-4">
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
          <ul className="-my-2 divide-y">
            {keys.map((k) => (
              <li key={k.hash} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"
                  >
                    <KeyRoundIcon className="size-4" />
                  </span>
                  <span className="truncate font-medium">{k.principal}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone={ROLE_TONE[k.role] ?? "muted"}>{k.role}</Pill>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Revoke key for ${k.principal}`}
                    onClick={() => revoke.mutate(k.hash)}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <CreateKeyDialog venueId={venueId} open={open} onOpenChange={setOpen} />
    </Card>
  );
}
