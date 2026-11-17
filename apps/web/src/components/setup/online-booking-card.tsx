import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useOnlineBooking } from "@/hooks/use-online-booking";
import { useServices } from "@/hooks/use-services";
import { api } from "@/lib/api";
import { errorMessage, isApiError } from "@/lib/error-message";
import {
  LOCALES,
  embedSnippet,
  parseForm,
  toForm,
  type FormErrors,
  type OnlineBookingForm,
} from "@/lib/online-booking";
import { WEEKDAYS } from "@/lib/weekdays";

type NumberKey =
  | "minPartySize"
  | "maxPartySize"
  | "leadTimeMinutes"
  | "maxAdvanceDays"
  | "selfServiceCutoffMinutes"
  | "maxOpenBookingsPerContact";

async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.error("Could not copy. Select the text and copy it by hand.");
  }
}

export function OnlineBookingCard({ venueId }: { venueId: string }) {
  const queryClient = useQueryClient();
  const { data, isPending } = useOnlineBooking(venueId);
  const { data: serviceData } = useServices(venueId);
  const serviceNames = (serviceData?.services ?? []).map((s) => s.name);
  const [form, setForm] = useState<OnlineBookingForm | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [incomplete, setIncomplete] = useState(false);
  const [host, setHost] = useState(window.location.origin);
  const [confirmRotate, setConfirmRotate] = useState(false);

  useEffect(() => {
    if (data) {
      setForm(toForm(data));
      setErrors({});
      setIncomplete(false);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: (update: Parameters<typeof api.setOnlineBooking>[1]) =>
      api.setOnlineBooking(venueId, update),
    onSuccess: ({ warnings, ...settings }) => {
      queryClient.setQueryData(["online-booking", venueId], settings);
      setIncomplete(false);
      toast.success("Online booking saved");
      if (warnings.some((w) => w.code === "low_contrast"))
        toast.warning("The theme text color has low contrast against its background.");
    },
    onError: (err) => {
      if (isApiError(err, "online_booking_incomplete")) {
        setIncomplete(true);
        return;
      }
      toast.error(
        isApiError(err, "forbidden")
          ? "Only an admin can change online booking."
          : errorMessage(err, "Could not save online booking."),
      );
    },
  });

  const rotate = useMutation({
    mutationFn: () => api.rotateBookingKey(venueId),
    onSuccess: (settings) => {
      queryClient.setQueryData(["online-booking", venueId], settings);
      setConfirmRotate(false);
      toast.success("New booking key created. The old key no longer works.");
    },
    onError: (err) => {
      setConfirmRotate(false);
      toast.error(
        isApiError(err, "forbidden")
          ? "Only an admin can rotate the booking key."
          : errorMessage(err, "Could not rotate the booking key."),
      );
    },
  });

  function submit() {
    if (!data || !form) return;
    const result = parseForm(form, data, serviceNames);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setIncomplete(false);
    if (Object.keys(result.update).length === 0) {
      toast.success("Nothing to save");
      return;
    }
    save.mutate(result.update);
  }

  function num(key: NumberKey) {
    return {
      value: form?.[key] ?? "",
      inputMode: "numeric" as const,
      "aria-invalid": errors[key] ? true : undefined,
      "aria-describedby": errors[key] ? `ob-${key}-error` : undefined,
      onChange: (e: { target: { value: string } }) =>
        form && setForm({ ...form, [key]: e.target.value }),
    };
  }

  function error(key: keyof OnlineBookingForm) {
    return errors[key] ? (
      <p id={`ob-${key}-error`} role="alert" className="text-sm text-destructive">
        {errors[key]}
      </p>
    ) : null;
  }

  function toggleService(name: string, on: boolean) {
    if (!form) return;
    const current = form.services ?? serviceNames;
    const next = on ? [...new Set([...current, name])] : current.filter((n) => n !== name);
    setForm({ ...form, services: next });
  }

  function toggleDay(day: number, on: boolean) {
    if (!form) return;
    setForm({
      ...form,
      weekdays: on ? [...new Set([...form.weekdays, day])] : form.weekdays.filter((d) => d !== day),
    });
  }

  const key = data?.bookingKey ?? null;
  const snippet = key ? embedSnippet(host, key) : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Online booking</CardTitle>
        <CardDescription>
          Let guests book through a page of their own or an embed on your website. Online rules
          never relax your venue rules: the stricter of the two applies.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isPending || !form || !data ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="ob-enabled">Accept online bookings</Label>
                <p className="text-sm text-muted-foreground">
                  Needs the venue name and at least one service bookable online. While it is off,
                  the booking address answers as if it did not exist. Bookings already made keep
                  their links.
                </p>
              </div>
              <Switch
                id="ob-enabled"
                checked={form.enabled}
                onCheckedChange={(v) => setForm({ ...form, enabled: v })}
              />
            </div>

            {incomplete && (
              <div
                role="alert"
                className="rounded-md border border-destructive/50 p-3 text-sm text-destructive"
              >
                <p>Online booking cannot be turned on yet.</p>
                <ul className="list-disc pl-5">
                  <li>The venue needs a name.</li>
                  {serviceNames.length === 0 ? (
                    <li>Add at least one service under Services below.</li>
                  ) : (
                    <li>
                      At least one ticked service has to open on at least one ticked day. Check
                      the days each service runs on.
                    </li>
                  )}
                </ul>
              </div>
            )}

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Services bookable online</legend>
              {serviceNames.length === 0 ? (
                <p className="text-sm text-muted-foreground">No services yet.</p>
              ) : (
                <div className="flex flex-wrap gap-4">
                  {serviceNames.map((name) => (
                    <label key={name} className="flex items-center gap-2 text-sm capitalize">
                      <input
                        type="checkbox"
                        checked={form.services === null || form.services.includes(name)}
                        onChange={(e) => toggleService(name, e.target.checked)}
                      />
                      {name}
                    </label>
                  ))}
                </div>
              )}
              {error("services")}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Days bookable online</legend>
              <div className="flex flex-wrap gap-4">
                {WEEKDAYS.map((d) => (
                  <label key={d.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.weekdays.includes(d.value)}
                      onChange={(e) => toggleDay(d.value, e.target.checked)}
                    />
                    {d.short}
                  </label>
                ))}
              </div>
              {error("weekdays")}
            </fieldset>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ob-min">Smallest party</Label>
                <Input id="ob-min" {...num("minPartySize")} />
                {error("minPartySize")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob-max">Largest party</Label>
                <Input id="ob-max" {...num("maxPartySize")} />
                {error("maxPartySize")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob-lead">Lead time (minutes)</Label>
                <Input id="ob-lead" {...num("leadTimeMinutes")} />
                {error("leadTimeMinutes")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob-advance">Booking horizon (days)</Label>
                <Input id="ob-advance" placeholder="Same as the venue" {...num("maxAdvanceDays")} />
                {error("maxAdvanceDays")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob-cutoff">Guest can change until (minutes before)</Label>
                <Input id="ob-cutoff" {...num("selfServiceCutoffMinutes")} />
                {error("selfServiceCutoffMinutes")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob-open">Open online bookings per contact</Label>
                <Input id="ob-open" placeholder="No limit" {...num("maxOpenBookingsPerContact")} />
                {error("maxOpenBookingsPerContact")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob-locale">Language</Label>
                <select
                  id="ob-locale"
                  value={form.locale}
                  onChange={(e) => setForm({ ...form, locale: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                >
                  {LOCALES.map((l) => (
                    <option key={l} value={l}>
                      {l === "es" ? "Español" : "English"}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ob-origins">Websites that may embed the page</Label>
              <Textarea
                id="ob-origins"
                rows={3}
                placeholder="https://example.com"
                value={form.allowedOrigins}
                aria-invalid={errors.allowedOrigins ? true : undefined}
                aria-describedby={errors.allowedOrigins ? "ob-allowedOrigins-error" : undefined}
                onChange={(e) => setForm({ ...form, allowedOrigins: e.target.value })}
              />
              {error("allowedOrigins")}
              <p className="text-sm text-muted-foreground">
                One address per line, up to 10, as https://host. Empty means the page works only
                on its own address.
              </p>
            </div>

            <Button onClick={submit} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save online booking"}
            </Button>

            <div className="space-y-4 border-t pt-6">
              <h3 className="text-sm font-medium">Booking page and embed code</h3>
              {key ? (
                <div className="space-y-2">
                  <Label htmlFor="ob-key">Public booking key</Label>
                  <div className="flex gap-2">
                    <Input id="ob-key" readOnly value={key} className="font-mono" />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Copy key"
                      onClick={() => void copyText(key, "Key copied")}
                    >
                      <CopyIcon className="size-4" />
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    The key is public. It names your venue and is not a password.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The key is created the first time you turn online booking on.
                </p>
              )}

              <div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmRotate(true)}
                >
                  Rotate key
                </Button>
              </div>

              {data.enabled && key && (
                <div className="space-y-2">
                  <Label htmlFor="ob-host">Address of the booking page</Label>
                  <Input
                    id="ob-host"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    className="font-mono"
                  />
                  <p className="text-sm text-muted-foreground">
                    Defaults to the address you are using now. Replace it with the public address
                    where your OpenCovers installation is served. The page path is{" "}
                    <code>/w/{key}</code>.
                  </p>
                  <Label htmlFor="ob-snippet">Embed code</Label>
                  <div className="flex gap-2">
                    <Textarea
                      id="ob-snippet"
                      readOnly
                      rows={3}
                      value={snippet}
                      className="font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Copy embed code"
                      onClick={() => void copyText(snippet, "Embed code copied")}
                    >
                      <CopyIcon className="size-4" />
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    The embedding website also has to be listed above.
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={confirmRotate} onOpenChange={setConfirmRotate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rotate the booking key?</DialogTitle>
            <DialogDescription>
              The old key and every widget or link that uses it stop working immediately. There is
              no grace period. You will have to put the new key on every website that embeds your
              booking page. Bookings already made keep their links.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRotate(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={rotate.isPending}
              onClick={() => rotate.mutate()}
            >
              {rotate.isPending ? "Rotating…" : "Rotate key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
