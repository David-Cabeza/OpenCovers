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
import { api, ApiError, type Role } from "@/lib/api";

export const OVERBOOKING_MAX = 1000;

function parseCeiling(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return n <= OVERBOOKING_MAX ? n : null;
}

export function VenueSettings({ venueId, role }: { venueId: string; role?: Role }) {
  const queryClient = useQueryClient();
  const { data, isPending } = useVenueConfig(venueId);
  const [enabled, setEnabled] = useState(false);
  const [noticeAddress, setNoticeAddress] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [resendConfigured, setResendConfigured] = useState(false);
  const [fromEmail, setFromEmail] = useState("");
  const [resendApiKey, setResendApiKey] = useState("");
  const [slotIntervalMinutes, setSlotIntervalMinutes] = useState("15");
  const [leadTimeMinutes, setLeadTimeMinutes] = useState("0");
  const [lastSeatingOffsetMinutes, setLastSeatingOffsetMinutes] = useState("0");
  const [overbookingCeiling, setOverbookingCeiling] = useState("0");
  const canEditCeiling = role === undefined || role === "admin";

  useEffect(() => {
    if (data) {
      setEnabled(data.enabled);
      setNoticeAddress(data.noticeAddress);
      setNotificationsEnabled(data.notificationsEnabled);
      setResendConfigured(data.resendConfigured);
      setFromEmail(data.fromEmail);
      setResendApiKey("");
      setSlotIntervalMinutes(String(data.slotIntervalMinutes));
      setLeadTimeMinutes(String(data.leadTimeMinutes));
      setLastSeatingOffsetMinutes(String(data.lastSeatingOffsetMinutes));
      setOverbookingCeiling(String(data.overbookingCeiling ?? 0));
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const ceiling = parseCeiling(overbookingCeiling);
      if (ceiling === null) throw new Error("overbooking_ceiling_invalid");
      return api.setConfig(venueId, {
        enabled,
        noticeAddress,
        notificationsEnabled,
        fromEmail,
        resendApiKey: resendApiKey !== "" ? resendApiKey : undefined,
        slotIntervalMinutes: Number(slotIntervalMinutes) || 0,
        leadTimeMinutes: Number(leadTimeMinutes) || 0,
        lastSeatingOffsetMinutes: Number(lastSeatingOffsetMinutes) || 0,
        overbookingCeiling: ceiling,
      });
    },
    onSuccess: (config) => {
      queryClient.setQueryData(["config", venueId], config);
      setResendConfigured(config.resendConfigured);
      setResendApiKey("");
      toast.success("Settings saved");
    },
    onError: (err) => {
      const message =
        err instanceof ApiError && err.code === "notice_address_required"
          ? "Add a notice address before enabling reservations."
          : err instanceof ApiError && err.code === "forbidden"
            ? "Only an admin can change venue settings."
            : err instanceof Error && err.message === "overbooking_ceiling_invalid"
              ? `The overbooking ceiling must be a whole number from 0 to ${OVERBOOKING_MAX}.`
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
          Reservations, notifications, and the booking rules for this venue.
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

            <div className="space-y-4 border-t pt-6">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="notifications">Email confirmations</Label>
                  <p className="text-sm text-muted-foreground">
                    Send confirmations, cancellations, and booking notices by email.
                  </p>
                </div>
                <Switch
                  id="notifications"
                  checked={notificationsEnabled}
                  onCheckedChange={setNotificationsEnabled}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="from-email">From address</Label>
                  <Input
                    id="from-email"
                    type="email"
                    placeholder="reservas@tu-restaurante.com"
                    value={fromEmail}
                    onChange={(e) => setFromEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="resend-key">Resend API key</Label>
                  <Input
                    id="resend-key"
                    type="password"
                    placeholder={resendConfigured ? "•••••• configured" : "re_..."}
                    value={resendApiKey}
                    onChange={(e) => setResendApiKey(e.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    Each venue uses its own Resend account. The key is never shown
                    back; leave blank to keep the current one.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4 border-t pt-6">
              <div>
                <h4 className="font-medium">Booking rules</h4>
                <p className="text-sm text-muted-foreground">
                  How the engine accepts bookings. Times are in minutes.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="slot-interval">Slot interval</Label>
                  <Input
                    id="slot-interval"
                    type="number"
                    min={5}
                    value={slotIntervalMinutes}
                    onChange={(e) => setSlotIntervalMinutes(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lead-time">Lead time</Label>
                  <Input
                    id="lead-time"
                    type="number"
                    min={0}
                    value={leadTimeMinutes}
                    onChange={(e) => setLeadTimeMinutes(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="last-seating">Last seating offset</Label>
                  <Input
                    id="last-seating"
                    type="number"
                    min={0}
                    value={lastSeatingOffsetMinutes}
                    onChange={(e) => setLastSeatingOffsetMinutes(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4 border-t pt-6">
              <div>
                <h4 className="font-medium">Overbooking</h4>
                <p className="text-sm text-muted-foreground">
                  Take a few covers beyond what your tables seat, with a hard limit.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="overbooking-ceiling">Overbooking ceiling</Label>
                <Input
                  id="overbooking-ceiling"
                  type="number"
                  min={0}
                  max={OVERBOOKING_MAX}
                  step={1}
                  className="w-40"
                  disabled={!canEditCeiling}
                  value={overbookingCeiling}
                  onChange={(e) => setOverbookingCeiling(e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  The most guests the venue accepts without a table at the same time. 0
                  turns overbooking off. Overbooked guests need a table assigned before
                  they can be seated. Only an admin can change this.
                </p>
              </div>
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
