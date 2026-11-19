import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Pill } from "@/components/pill";
import { Group, SaveBar } from "./form-parts";
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
import { useVenues } from "@/hooks/use-venues";
import { api } from "@/lib/api";
import { errorMessage, isApiError } from "@/lib/error-message";
import {
  COLOR_KEYS,
  FONTS,
  FONT_STACKS,
  LOCALES,
  LOCALE_NAMES,
  DEFAULT_DARK_COLORS,
  defaultThemeForm,
  embedSnippet,
  isLogoUrl,
  parseForm,
  scriptSnippet,
  widgetOrigin,
  toForm,
  type ColorKey,
  type Font,
  type FormErrors,
  type OnlineBookingForm,
  type ThemeForm,
} from "@/lib/online-booking";
import { WEEKDAYS } from "@/lib/weekdays";

type NumberKey =
  | "minPartySize"
  | "maxPartySize"
  | "leadTimeMinutes"
  | "maxAdvanceDays"
  | "selfServiceCutoffMinutes"
  | "maxOpenBookingsPerContact";

const COLOR_LABELS: Record<ColorKey, string> = {
  primary: "Buttons",
  onPrimary: "Button text",
  background: "Background",
  surface: "Panels",
  text: "Text",
  muted: "Secondary text",
  border: "Borders",
};

const FONT_LABELS: Record<Font, string> = { system: "System", serif: "Serif", rounded: "Rounded" };

/**
 * A small likeness of the booking page. The staff app's CSP loads no image from other sites, so a valid logo
 * address shows as a placeholder here and loads only in the widget.
 */
function ThemePreview({
  theme,
  colors,
  radiusText,
  font,
  label = "Preview of the booking page",
}: {
  theme: ThemeForm;
  colors?: ThemeForm["colors"];
  /** Overrides the corner radius, as text. Empty or absent keeps the theme's. */
  radiusText?: string;
  /** Overrides the font. Absent keeps the theme's. */
  font?: Font;
  label?: string;
}) {
  const c = colors ?? theme.colors;
  const radius = `${Math.min(24, Math.max(0, Number(radiusText?.trim() ? radiusText : theme.radius) || 0))}px`;
  return (
    <div
      aria-label={label}
      role="img"
      className="space-y-3 border p-4 text-sm"
      style={{ background: c.background, color: c.text, fontFamily: FONT_STACKS[font ?? theme.font], borderColor: c.border, borderRadius: radius }}
    >
      {isLogoUrl(theme.logoUrl.trim()) && (
        <div className="flex h-8 w-20 items-center justify-center border border-dashed text-xs" style={{ borderColor: c.border, color: c.muted }}>
          Logo
        </div>
      )}
      <p className="text-base font-semibold">Book a table</p>
      <p style={{ color: c.muted }}>Pick a day and a time.</p>
      <div className="border px-3 py-2" style={{ background: c.surface, borderColor: c.border, borderRadius: radius }}>
        20:00 · 2 people
      </div>
      <div className="px-3 py-2 text-center font-medium" style={{ background: c.primary, color: c.onPrimary, borderRadius: radius }}>
        Book
      </div>
    </div>
  );
}

/** A checkbox drawn as a pill. The real input stays in the page, so labels and the keyboard work as before. */
function Chip({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-3.5 py-1.5 text-sm font-medium first-letter:uppercase transition-colors",
          "hover:bg-muted peer-checked:border-primary peer-checked:bg-accent peer-checked:text-accent-foreground",
          "peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50",
        )}
      >
        {children}
      </span>
    </label>
  );
}

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
  const { data: venueData } = useVenues();
  const services = serviceData?.services ?? [];
  const serviceNames = services.map((s) => s.name);
  const venueName = venueData?.venues.find((v) => v.id === venueId)?.name;
  const [form, setForm] = useState<OnlineBookingForm | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [incomplete, setIncomplete] = useState(false);
  const [host, setHost] = useState(window.location.origin);
  const [followDark, setFollowDark] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [lowContrast, setLowContrast] = useState<number | null>(null);
  const [lowContrastDark, setLowContrastDark] = useState<number | null>(null);

  // Reset the form only when the saved server value changes, so a refetch that returns the same
  // settings does not wipe edits that are not saved yet.
  const savedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!data) return;
    const next = JSON.stringify(data);
    if (next === savedKey.current) return;
    savedKey.current = next;
    setForm(toForm(data));
    setErrors({});
    setIncomplete(false);
  }, [data]);

  const save = useMutation({
    mutationFn: (update: Parameters<typeof api.setOnlineBooking>[1]) =>
      api.setOnlineBooking(venueId, update),
    onSuccess: ({ warnings, ...settings }) => {
      queryClient.setQueryData(["online-booking", venueId], settings);
      setIncomplete(false);
      toast.success("Online booking saved");
      const low = warnings.find((w) => w.code === "low_contrast" && w.palette !== "dark");
      setLowContrast(low ? (low.ratio ?? 0) : null);
      const lowDark = warnings.find((w) => w.code === "low_contrast" && w.palette === "dark");
      setLowContrastDark(lowDark ? (lowDark.ratio ?? 0) : null);
    },
    onError: (err) => {
      if (isApiError(err, "online_booking_incomplete")) {
        // The server kept online booking off: show that, and keep the other edits.
        setForm((f) => (f && data ? { ...f, enabled: data.enabled } : f));
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
    setLowContrast(null);
    setLowContrastDark(null);
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

  function setTheme(patch: Partial<ThemeForm>) {
    if (form) setForm({ ...form, theme: { ...form.theme, ...patch } });
  }

  function error(key: keyof FormErrors) {
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

  const bookable = services.some(
    (s) =>
      (form?.services == null || form.services.includes(s.name)) &&
      (form === null || s.days.some((d) => form.weekdays.includes(d))),
  );
  const missing: string[] = [];
  if (venueName !== undefined && venueName.trim() === "") missing.push("The venue needs a name.");
  if (services.length === 0) missing.push("Add at least one service under Services below.");
  else if (!bookable)
    missing.push(
      "At least one ticked service has to open on at least one ticked day. Check the days each service runs on.",
    );
  if (missing.length === 0) missing.push("Check the venue name and the services bookable online.");
  const key = data?.bookingKey ?? null;
  const hostOk = widgetOrigin(host) !== null;
  const snippet = key ? embedSnippet(host, key, followDark) : "";
  const script = key ? scriptSnippet(host, key, followDark) : "";

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
            <div
              className={cn(
                "flex items-center justify-between gap-4 rounded-xl border p-4 transition-colors",
                form.enabled && "border-transparent bg-success-soft",
              )}
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor="ob-enabled">Accept online bookings</Label>
                  <Pill tone={data.enabled ? "success" : "muted"} dot>
                    {data.enabled ? "Live" : "Off"}
                  </Pill>
                </div>
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
                <p>Online booking cannot be turned on yet. Nothing was saved.</p>
                <ul className="list-disc pl-5">
                  {missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            )}

            <Group title="What guests can book" description="Services and days open to online bookings.">
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Services bookable online</legend>
                {serviceNames.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No services yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {serviceNames.map((name) => (
                      <Chip
                        key={name}
                        checked={form.services === null || form.services.includes(name)}
                        onChange={(on) => toggleService(name, on)}
                      >
                        {name}
                      </Chip>
                    ))}
                  </div>
                )}
                {error("services")}
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Days bookable online</legend>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((d) => (
                    <Chip
                      key={d.value}
                      checked={form.weekdays.includes(d.value)}
                      onChange={(on) => toggleDay(d.value, on)}
                    >
                      {d.short}
                    </Chip>
                  ))}
                </div>
                {error("weekdays")}
              </fieldset>
            </Group>

            <Group title="Party size and timing" description="Limits for the bookings guests make by themselves.">
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
                  <Input id="ob-advance" placeholder="Same as the venue, or 365" {...num("maxAdvanceDays")} />
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
                        {LOCALE_NAMES[l]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </Group>

            <Group title="Embedding" description="Where the booking page may appear.">
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
            </Group>

            <fieldset className="space-y-4">
              <legend className="font-display text-lg">Look of the booking page</legend>
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    {COLOR_KEYS.map((k) => (
                      <div key={k} className="flex items-center gap-2">
                        <input
                          id={`ob-color-${k}`}
                          type="color"
                          value={form.theme.colors[k]}
                          onChange={(e) => setTheme({ colors: { ...form.theme.colors, [k]: e.target.value } })}
                          className="h-8 w-10 shrink-0 cursor-pointer rounded border border-input bg-transparent"
                        />
                        <Label htmlFor={`ob-color-${k}`} className="font-normal">
                          {COLOR_LABELS[k]}
                        </Label>
                      </div>
                    ))}
                  </div>
                  {error("themeColors")}
                  <div className="space-y-3 rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <Label htmlFor="ob-dark-palette">Choose a look for dark mode</Label>
                        <p className="text-sm text-muted-foreground">
                          Off: a visitor in dark mode sees the standard dark look if you kept the
                          default colors above, and your colors above otherwise. On: they see the
                          colors, corner radius and font below.
                        </p>
                      </div>
                      <Switch
                        id="ob-dark-palette"
                        checked={form.theme.darkColors !== null}
                        onCheckedChange={(on) =>
                          setTheme({ darkColors: on ? { ...DEFAULT_DARK_COLORS } : null })
                        }
                      />
                    </div>
                    {form.theme.darkColors && (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          {COLOR_KEYS.map((k) => (
                            <div key={k} className="flex items-center gap-2">
                              <input
                                id={`ob-dark-color-${k}`}
                                type="color"
                                value={form.theme.darkColors?.[k] ?? DEFAULT_DARK_COLORS[k]}
                                onChange={(e) =>
                                  setTheme({
                                    darkColors: { ...DEFAULT_DARK_COLORS, ...form.theme.darkColors, [k]: e.target.value },
                                  })
                                }
                                className="h-8 w-10 shrink-0 cursor-pointer rounded border border-input bg-transparent"
                              />
                              <Label htmlFor={`ob-dark-color-${k}`} className="font-normal">
                                Dark: {COLOR_LABELS[k].toLowerCase()}
                              </Label>
                            </div>
                          ))}
                        </div>
                        {error("themeDarkColors")}
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="ob-dark-radius">Corner radius in dark mode (px)</Label>
                            <Input
                              id="ob-dark-radius"
                              inputMode="numeric"
                              placeholder="Same as light"
                              value={form.theme.darkRadius}
                              aria-invalid={errors.themeDarkRadius ? true : undefined}
                              aria-describedby={errors.themeDarkRadius ? "ob-themeDarkRadius-error" : undefined}
                              onChange={(e) => setTheme({ darkRadius: e.target.value })}
                            />
                            {error("themeDarkRadius")}
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="ob-dark-font">Font in dark mode</Label>
                            <select
                              id="ob-dark-font"
                              value={form.theme.darkFont}
                              onChange={(e) => setTheme({ darkFont: e.target.value as Font | "" })}
                              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                            >
                              <option value="">Same as light</option>
                              {FONTS.map((f) => (
                                <option key={f} value={f}>
                                  {FONT_LABELS[f]}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="ob-radius">Corner radius (px)</Label>
                      <Input
                        id="ob-radius"
                        inputMode="numeric"
                        value={form.theme.radius}
                        aria-invalid={errors.themeRadius ? true : undefined}
                        aria-describedby={errors.themeRadius ? "ob-themeRadius-error" : undefined}
                        onChange={(e) => setTheme({ radius: e.target.value })}
                      />
                      {error("themeRadius")}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ob-font">Font</Label>
                      <select
                        id="ob-font"
                        value={form.theme.font}
                        onChange={(e) => setTheme({ font: e.target.value as Font })}
                        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                      >
                        {FONTS.map((f) => (
                          <option key={f} value={f}>
                            {FONT_LABELS[f]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ob-logo">Logo address</Label>
                    <Input
                      id="ob-logo"
                      placeholder="https://example.com/logo.png"
                      value={form.theme.logoUrl}
                      aria-invalid={errors.themeLogoUrl ? true : undefined}
                      aria-describedby={errors.themeLogoUrl ? "ob-themeLogoUrl-error" : undefined}
                      onChange={(e) => setTheme({ logoUrl: e.target.value })}
                    />
                    {error("themeLogoUrl")}
                    <p className="text-sm text-muted-foreground">
                      Optional. An https address of an image. Each guest's browser loads it from that
                      address, without telling it which page asked.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setForm({ ...form, theme: defaultThemeForm() })}
                  >
                    Reset look to defaults
                  </Button>
                </div>
                <div className="space-y-3 sm:sticky sm:top-36 sm:self-start">
                  <ThemePreview theme={form.theme} />
                  {form.theme.darkColors && (
                    <ThemePreview
                      theme={form.theme}
                      colors={form.theme.darkColors}
                      radiusText={form.theme.darkRadius}
                      font={form.theme.darkFont || undefined}
                      label="Preview of the booking page in dark mode"
                    />
                  )}
                </div>
              </div>
              {lowContrast !== null && (
                <div
                  role="alert"
                  className="rounded-md border border-amber-500/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
                >
                  Saved, but the text color has a contrast of {lowContrast}:1 against the background.
                  WCAG AA asks for at least 4.5:1, so some guests may find the booking page hard to
                  read. Pick a darker text or a lighter background, or the other way round.
                </div>
              )}
              {lowContrastDark !== null && (
                <div
                  role="alert"
                  className="rounded-md border border-amber-500/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
                >
                  Saved, but the dark text color has a contrast of {lowContrastDark}:1 against the dark
                  background. WCAG AA asks for at least 4.5:1, so some guests may find the booking
                  page hard to read in dark mode.
                </div>
              )}
            </fieldset>


            <div className="space-y-4 border-t pt-6">
              <h3 className="font-display text-lg">Booking page and embed code</h3>
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
                  {!hostOk && (
                    <p className="text-sm text-destructive" role="alert">
                      Enter the address as https://host, with no path.
                    </p>
                  )}

                  <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                    <div>
                      <Label htmlFor="ob-follow-dark">Follow my visitors&apos; dark mode</Label>
                      <p className="text-sm text-muted-foreground">
                        The embedded booking page turns dark for visitors whose device asks for dark
                        mode. Leave it off if your website is always light. A theme with colors
                        always stays as you set it.
                      </p>
                    </div>
                    <Switch id="ob-follow-dark" checked={followDark} onCheckedChange={setFollowDark} />
                  </div>

                  <Label htmlFor="ob-script">Embed code with automatic height (recommended)</Label>
                  <div className="flex gap-2">
                    <Textarea
                      id="ob-script"
                      readOnly
                      rows={2}
                      value={script}
                      aria-invalid={!hostOk}
                      className="font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Copy script embed code"
                      disabled={!hostOk}
                      onClick={() => void copyText(script, "Embed code copied")}
                    >
                      <CopyIcon className="size-4" />
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Use this where your website lets you paste a script. The booking page takes the
                    height it needs. If your website sets a Content-Security-Policy, it must allow
                    the booking page address in <code>script-src</code> and <code>frame-src</code>.
                  </p>

                  <Label htmlFor="ob-snippet">Embed code with a fixed height</Label>
                  <div className="flex gap-2">
                    <Textarea
                      id="ob-snippet"
                      readOnly
                      rows={3}
                      value={snippet}
                      aria-invalid={!hostOk}
                      className="font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Copy embed code"
                      disabled={!hostOk}
                      onClick={() => void copyText(snippet, "Embed code copied")}
                    >
                      <CopyIcon className="size-4" />
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Use this when your website builder removes scripts. If your website sets a
                    Content-Security-Policy, it must allow the booking page address in{" "}
                    <code>frame-src</code>.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    The embedding website also has to be listed above.
                  </p>
                </div>
              )}
            </div>

            <SaveBar hint="Changes apply to new bookings.">
              <Button onClick={submit} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save online booking"}
              </Button>
            </SaveBar>
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
