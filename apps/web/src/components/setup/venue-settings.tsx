import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useVenueConfig } from "@/hooks/use-venue-config";
import { api, ApiError } from "@/lib/api";

export function VenueSettings({ venueId }: { venueId: string }) {
  const queryClient = useQueryClient();
  const { data, isPending } = useVenueConfig(venueId);
  const [enabled, setEnabled] = useState(false);
  const [noticeAddress, setNoticeAddress] = useState("");

  useEffect(() => {
    if (data) {
      setEnabled(data.enabled);
      setNoticeAddress(data.noticeAddress);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => api.setConfig(venueId, { enabled, noticeAddress }),
    onSuccess: (config) => {
      queryClient.setQueryData(["config", venueId], config);
      toast.success("Settings saved");
    },
    onError: (err) => {
      const message =
        err instanceof ApiError && err.code === "notice_address_required"
          ? "Add a notice address before enabling reservations."
          : err instanceof Error
            ? err.message
            : "Could not save the settings.";
      toast.error(message);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Venue</CardTitle>
        <CardDescription>
          Whether this venue accepts reservations, and where legal notices go.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="enabled">Accepting reservations</Label>
                <p className="text-sm text-muted-foreground">
                  Turn this on to let platforms and agents book.
                </p>
              </div>
              <Switch
                id="enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notice-address">Notice address</Label>
              <Input
                id="notice-address"
                type="email"
                placeholder="owner@example.com"
                value={noticeAddress}
                onChange={(e) => setNoticeAddress(e.target.value)}
              />
              <p className="text-sm text-muted-foreground">
                Required before enabling. Used for legal and STOP notices.
              </p>
            </div>

            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save settings"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
