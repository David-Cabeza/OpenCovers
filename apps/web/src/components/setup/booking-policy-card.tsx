import { errorMessage, isApiError } from "@/lib/error-message";
import { useT } from "@/i18n";
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
import { LoadError } from "@/components/load-error";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useVenueConfig } from "@/hooks/use-venue-config";
import { api, type Role } from "@/lib/api";
import {
  MAX_ACTIVE_PER_GUEST_MAX,
  MAX_ADVANCE_DAYS_MAX,
  parseForm,
  toForm,
  type BookingPolicyForm,
  type FormErrors,
} from "@/lib/booking-policy";

const EMPTY_FORM: BookingPolicyForm = {
  maxAdvanceDays: "",
  maxActivePerGuestPerDay: "",
  blockedDates: "",
};

export function BookingPolicyCard({ venueId, role }: { venueId: string; role?: Role }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data, isPending, isError, error: loadError, isRefetching, refetch } = useVenueConfig(venueId);
  const [form, setForm] = useState<BookingPolicyForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const canEdit = role === undefined || role === "admin";

  useEffect(() => {
    if (data) {
      setForm(
        toForm({
          maxAdvanceDays: data.maxAdvanceDays ?? null,
          maxActivePerGuestPerDay: data.maxActivePerGuestPerDay ?? null,
          blockedDates: data.blockedDates ?? [],
        }),
      );
      setErrors({});
    }
  }, [data]);

  const save = useMutation({
    mutationFn: (policy: Extract<ReturnType<typeof parseForm>, { ok: true }>["policy"]) =>
      api.setConfig(venueId, policy),
    onSuccess: (config) => {
      queryClient.setQueryData(["config", venueId], config);
      toast.success(t("setup.policy.saved"));
    },
    onError: (err) => {
      toast.error(
        isApiError(err, "forbidden")
          ? t("setup.policy.forbidden")
          : errorMessage(err, t("setup.policy.saveFailed")),
      );
    },
  });

  function submit() {
    const result = parseForm(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    save.mutate(result.policy);
  }

  function field(key: keyof BookingPolicyForm) {
    return {
      value: form[key],
      disabled: !canEdit,
      "aria-invalid": errors[key] ? true : undefined,
      "aria-describedby": errors[key] ? `${key}-error` : undefined,
    };
  }

  function error(key: keyof BookingPolicyForm) {
    return errors[key] ? (
      <p id={`${key}-error`} role="alert" className="text-sm text-destructive">
        {errors[key]}
      </p>
    ) : null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("setup.policy.title")}</CardTitle>
        <CardDescription>{t("setup.policy.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : isError && !data ? (
          <LoadError compact what={t("setup.policy.loadWhat")} error={loadError} retrying={isRefetching} onRetry={() => void refetch()} />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="max-advance-days">{t("setup.policy.advanceDays")}</Label>
                <Input
                  id="max-advance-days"
                  type="text"
                  inputMode="numeric"
                  placeholder={t("setup.policy.noLimit")}
                  {...field("maxAdvanceDays")}
                  onChange={(e) => setForm({ ...form, maxAdvanceDays: e.target.value })}
                />
                {error("maxAdvanceDays")}
                <p className="text-sm text-muted-foreground">
                  {t("setup.policy.advanceHelp", { max: MAX_ADVANCE_DAYS_MAX })}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="max-active-per-guest">{t("setup.policy.perGuest")}</Label>
                <Input
                  id="max-active-per-guest"
                  type="text"
                  inputMode="numeric"
                  placeholder={t("setup.policy.noLimit")}
                  {...field("maxActivePerGuestPerDay")}
                  onChange={(e) => setForm({ ...form, maxActivePerGuestPerDay: e.target.value })}
                />
                {error("maxActivePerGuestPerDay")}
                <p className="text-sm text-muted-foreground">
                  {t("setup.policy.perGuestHelp", { max: MAX_ACTIVE_PER_GUEST_MAX })}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="blocked-dates">{t("setup.policy.blockedDates")}</Label>
              <Textarea
                id="blocked-dates"
                rows={5}
                className="font-mono"
                placeholder={"2026-12-25\n2026-12-31..2027-01-02"} // i18n-ok
                {...field("blockedDates")}
                onChange={(e) => setForm({ ...form, blockedDates: e.target.value })}
              />
              {error("blockedDates")}
              <p className="text-sm text-muted-foreground">
                {t("setup.policy.blockedHelp")}
              </p>
            </div>

            {canEdit ? (
              <Button onClick={submit} disabled={save.isPending}>
                {save.isPending ? t("common.saving") : t("setup.policy.save")}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">{t("setup.policy.adminOnly")}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
