import { errorMessage, isApiError } from "@/lib/error-message";
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
  const queryClient = useQueryClient();
  const { data, isPending } = useVenueConfig(venueId);
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
      toast.success("Booking policy saved");
    },
    onError: (err) => {
      toast.error(
        isApiError(err, "forbidden")
          ? "Only an admin can change the booking policy."
          : errorMessage(err, "Could not save the booking policy."),
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
        <CardTitle>Booking policy</CardTitle>
        <CardDescription>
          Limit how far ahead guests can book, how many bookings one guest can hold in a day,
          and which dates are closed. Changes apply to new bookings only. Existing bookings
          stay as they are.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="max-advance-days">Advance days</Label>
                <Input
                  id="max-advance-days"
                  type="text"
                  inputMode="numeric"
                  placeholder="No limit"
                  {...field("maxAdvanceDays")}
                  onChange={(e) => setForm({ ...form, maxAdvanceDays: e.target.value })}
                />
                {error("maxAdvanceDays")}
                <p className="text-sm text-muted-foreground">
                  The furthest day ahead a guest can book, 0 to {MAX_ADVANCE_DAYS_MAX}. Empty
                  turns the rule off.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="max-active-per-guest">Bookings per guest per day</Label>
                <Input
                  id="max-active-per-guest"
                  type="text"
                  inputMode="numeric"
                  placeholder="No limit"
                  {...field("maxActivePerGuestPerDay")}
                  onChange={(e) => setForm({ ...form, maxActivePerGuestPerDay: e.target.value })}
                />
                {error("maxActivePerGuestPerDay")}
                <p className="text-sm text-muted-foreground">
                  Active bookings one guest can hold on the same date, 1 to{" "}
                  {MAX_ACTIVE_PER_GUEST_MAX}. Empty turns the rule off.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="blocked-dates">Blocked dates</Label>
              <Textarea
                id="blocked-dates"
                rows={5}
                className="font-mono"
                placeholder={"2026-12-25\n2026-12-31..2027-01-02"}
                {...field("blockedDates")}
                onChange={(e) => setForm({ ...form, blockedDates: e.target.value })}
              />
              {error("blockedDates")}
              <p className="text-sm text-muted-foreground">
                One per line: a day as YYYY-MM-DD or a range as YYYY-MM-DD..YYYY-MM-DD, both
                ends included. The list is saved sorted and merged. Empty clears it.
              </p>
            </div>

            {canEdit ? (
              <Button onClick={submit} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save booking policy"}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">Only an admin can change this.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
