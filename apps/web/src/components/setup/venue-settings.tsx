import { errorMessage, isApiError } from "@/lib/error-message";
import { useT } from "@/i18n";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Group, SaveBar, StatusPanel } from "./form-parts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadError } from "@/components/load-error";
import { Skeleton } from "@/components/ui/skeleton";
import { useVenueConfig } from "@/hooks/use-venue-config";
import { api, type Role } from "@/lib/api";

export const OVERBOOKING_MAX = 1000;

function parseCeiling(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return n <= OVERBOOKING_MAX ? n : null;
}

export function VenueSettings({ venueId, role }: { venueId: string; role?: Role }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data, isPending, isError, error, isRefetching, refetch } = useVenueConfig(venueId);
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
      toast.success(t("setup.venue.saved"));
    },
    onError: (err) => {
      const message =
        err instanceof Error && err.message === "overbooking_ceiling_invalid"
          ? t("setup.venue.ceilingInvalid", { max: OVERBOOKING_MAX })
          : isApiError(err, "forbidden")
            ? t("setup.venue.forbidden")
            : errorMessage(err, t("setup.venue.saveFailed"));
      toast.error(message);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">{t("setup.venue.title")}</CardTitle>
        <CardDescription>{t("setup.venue.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : isError && !data ? (
          <LoadError compact what={t("setup.venue.loadWhat")} error={error} retrying={isRefetching} onRetry={() => void refetch()} />
        ) : (
          <>
            <Group title={t("setup.venue.reservations")} description={t("setup.venue.reservationsDescription")}>
              <StatusPanel
                id="enabled"
                label={t("setup.venue.accepting")}
                description={t("setup.venue.acceptingDescription")}
                live={data?.enabled ?? false}
                checked={enabled}
                onCheckedChange={setEnabled}
              />

              <div className="space-y-2">
                <Label htmlFor="notice-address">{t("setup.venue.noticeAddress")}</Label>
                <Input
                  id="notice-address"
                  type="email"
                  placeholder="owner@example.com" // i18n-ok
                  value={noticeAddress}
                  onChange={(e) => setNoticeAddress(e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  {t("setup.venue.noticeHelp")}
                </p>
              </div>
            </Group>

            <Group title={t("setup.venue.email")} description={t("setup.venue.emailDescription")}>
              <StatusPanel
                id="notifications"
                label={t("setup.venue.confirmations")}
                description={t("setup.venue.confirmationsDescription")}
                live={data?.notificationsEnabled ?? false}
                checked={notificationsEnabled}
                onCheckedChange={setNotificationsEnabled}
                onLabel={t("setup.status.on")}
              />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="from-email">{t("setup.venue.fromAddress")}</Label>
                  <Input
                    id="from-email"
                    type="email"
                    placeholder="reservas@tu-restaurante.com" // i18n-ok
                    value={fromEmail}
                    onChange={(e) => setFromEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="resend-key">{t("setup.venue.resendKey")}</Label>
                  <Input
                    id="resend-key"
                    type="password"
                    placeholder={resendConfigured ? t("setup.venue.resendConfigured") : "re_..."} // i18n-ok
                    value={resendApiKey}
                    onChange={(e) => setResendApiKey(e.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("setup.venue.resendHelp")}
                  </p>
                </div>
              </div>
            </Group>

            <Group title={t("setup.venue.rules")} description={t("setup.venue.rulesDescription")}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="slot-interval">{t("setup.venue.slotInterval")}</Label>
                  <Input
                    id="slot-interval"
                    type="number"
                    min={5}
                    value={slotIntervalMinutes}
                    onChange={(e) => setSlotIntervalMinutes(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lead-time">{t("setup.venue.leadTime")}</Label>
                  <Input
                    id="lead-time"
                    type="number"
                    min={0}
                    value={leadTimeMinutes}
                    onChange={(e) => setLeadTimeMinutes(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="last-seating">{t("setup.venue.lastSeating")}</Label>
                  <Input
                    id="last-seating"
                    type="number"
                    min={0}
                    value={lastSeatingOffsetMinutes}
                    onChange={(e) => setLastSeatingOffsetMinutes(e.target.value)}
                  />
                </div>
              </div>
            </Group>

            <Group title={t("setup.venue.overbooking")} description={t("setup.venue.overbookingDescription")}>
              <div className="space-y-2">
                <Label htmlFor="overbooking-ceiling">{t("setup.venue.ceiling")}</Label>
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
                  {t("setup.venue.ceilingHelp")}
                </p>
              </div>
            </Group>

            <SaveBar>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? t("common.saving") : t("setup.venue.save")}
              </Button>
            </SaveBar>
          </>
        )}
      </CardContent>
    </Card>
  );
}
