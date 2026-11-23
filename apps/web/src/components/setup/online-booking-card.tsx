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
import { LoadError } from "@/components/load-error";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useT, type MessageKey } from "@/i18n";
import { useOnlineBooking } from "@/hooks/use-online-booking";
import { useServices } from "@/hooks/use-services";
import { useTables } from "@/hooks/use-tables";
import { useVenues } from "@/hooks/use-venues";
import { api } from "@/lib/api";
import { useDemoStatus } from "@/lib/demo";
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

const COLOR_LABELS: Record<ColorKey, MessageKey> = {
  primary: "onlinebooking.color.primary",
  onPrimary: "onlinebooking.color.onPrimary",
  background: "onlinebooking.color.background",
  surface: "onlinebooking.color.surface",
  text: "onlinebooking.color.text",
  muted: "onlinebooking.color.muted",
  border: "onlinebooking.color.border",
};

const FONT_LABELS: Record<Font, MessageKey> = {
  system: "onlinebooking.font.system",
  serif: "onlinebooking.font.serif",
  rounded: "onlinebooking.font.rounded",
};

/** A translated sentence with `{name}` spots filled by elements (the `<code>` words that stay as they are). */
function withCode(text: string, parts: Record<string, string>) {
  return text.split(/(\{\w+\})/).map((piece, i) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    return name && name in parts ? <code key={i}>{parts[name]}</code> : piece;
  });
}

/**
 * A small likeness of the booking page. The staff app's CSP loads no image from other sites, so a valid logo
 * address shows as a placeholder here and loads only in the widget.
 */
function ThemePreview({
  theme,
  colors,
  radiusText,
  font,
  label,
}: {
  theme: ThemeForm;
  colors?: ThemeForm["colors"];
  /** Overrides the corner radius, as text. Empty or absent keeps the theme's. */
  radiusText?: string;
  /** Overrides the font. Absent keeps the theme's. */
  font?: Font;
  label?: string;
}) {
  const t = useT();
  const c = colors ?? theme.colors;
  const radius = `${Math.min(24, Math.max(0, Number(radiusText?.trim() ? radiusText : theme.radius) || 0))}px`;
  return (
    <div
      aria-label={label ?? t("onlinebooking.preview.label")}
      role="img"
      className="space-y-3 border p-4 text-sm"
      style={{ background: c.background, color: c.text, fontFamily: FONT_STACKS[font ?? theme.font], borderColor: c.border, borderRadius: radius }}
    >
      {isLogoUrl(theme.logoUrl.trim()) && (
        <div className="flex h-8 w-20 items-center justify-center border border-dashed text-xs" style={{ borderColor: c.border, color: c.muted }}>
          {t("onlinebooking.preview.logo")}
        </div>
      )}
      <p className="text-base font-semibold">{t("onlinebooking.preview.title")}</p>
      <p style={{ color: c.muted }}>{t("onlinebooking.preview.pick")}</p>
      <div className="border px-3 py-2" style={{ background: c.surface, borderColor: c.border, borderRadius: radius }}>
        {t("onlinebooking.preview.sample", { count: 2 })}
      </div>
      <div className="px-3 py-2 text-center font-medium" style={{ background: c.primary, color: c.onPrimary, borderRadius: radius }}>
        {t("onlinebooking.preview.book")}
      </div>
    </div>
  );
}

/** A checkbox drawn as a pill. The real input stays in the page, so labels and the keyboard work as before. */
function Chip({
  checked,
  onChange,
  disabled,
  verbatim,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Shows the label as written. A zone name is an exact identifier, so its first letter is not capitalised. */
  verbatim?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
          !verbatim && "first-letter:uppercase",
          "hover:bg-muted peer-checked:border-primary peer-checked:bg-accent peer-checked:text-accent-foreground",
          "peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50",
        )}
      >
        {children}
      </span>
    </label>
  );
}

async function copyText(text: string, done: string, failed: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.error(failed);
  }
}

export function OnlineBookingCard({ venueId }: { venueId: string }) {
  const t = useT();
  // The hosted demo offers only the reviewed languages (ADR-0022); the API refuses the others there too.
  const demo = useDemoStatus();
  const widgetLocales = demo?.enabled ? LOCALES.filter((l) => l === "es" || l === "en") : LOCALES;
  const queryClient = useQueryClient();
  const { data, isPending, isError, error: loadError, isRefetching, refetch } = useOnlineBooking(venueId);
  const { data: serviceData } = useServices(venueId);
  const { data: venueData } = useVenues();
  const { data: tableData } = useTables(venueId);
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
      toast.success(t("onlinebooking.saved"));
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
          ? t("onlinebooking.forbidden")
          : errorMessage(err, t("onlinebooking.saveFailed")),
      );
    },
  });

  const rotate = useMutation({
    mutationFn: () => api.rotateBookingKey(venueId),
    onSuccess: (settings) => {
      queryClient.setQueryData(["online-booking", venueId], settings);
      setConfirmRotate(false);
      toast.success(t("onlinebooking.rotated"));
    },
    onError: (err) => {
      setConfirmRotate(false);
      toast.error(
        isApiError(err, "forbidden")
          ? t("onlinebooking.rotateForbidden")
          : errorMessage(err, t("onlinebooking.rotateFailed")),
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
      toast.success(t("onlinebooking.nothingToSave"));
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

  function toggleZone(name: string, on: boolean) {
    if (!form) return;
    setForm({
      ...form,
      publicZones: on ? [...new Set([...form.publicZones, name])] : form.publicZones.filter((z) => z !== name),
    });
  }

  function toggleDay(day: number, on: boolean) {
    if (!form) return;
    setForm({
      ...form,
      weekdays: on ? [...new Set([...form.weekdays, day])] : form.weekdays.filter((d) => d !== day),
    });
  }

  // The zone names the venue's tables carry. A saved name no table has is still listed, so it can be removed.
  const tableZones = [...new Set((tableData?.tables ?? []).map((tb) => tb.zone.trim()).filter((z) => z !== ""))];
  const zonesReady = tableData !== undefined;
  const zoneOptions = [...tableZones, ...(form?.publicZones ?? []).filter((z) => !tableZones.includes(z))];
  const zonesLocked = tableZones.length < 2;

  const bookable = services.some(
    (s) =>
      (form?.services == null || form.services.includes(s.name)) &&
      (form === null || s.days.some((d) => form.weekdays.includes(d))),
  );
  const missing: string[] = [];
  if (venueName !== undefined && venueName.trim() === "") missing.push(t("onlinebooking.missing.name"));
  if (services.length === 0) missing.push(t("onlinebooking.missing.services"));
  else if (!bookable)
    missing.push(t("onlinebooking.missing.bookable"));
  if (missing.length === 0) missing.push(t("onlinebooking.missing.generic"));
  const key = data?.bookingKey ?? null;
  const hostOk = widgetOrigin(host) !== null;
  const snippet = key ? embedSnippet(host, key, followDark) : "";
  const script = key ? scriptSnippet(host, key, followDark) : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("onlinebooking.title")}</CardTitle>
        <CardDescription>{t("onlinebooking.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isError && !data ? (
          <LoadError compact what={t("onlinebooking.loadWhat")} error={loadError} retrying={isRefetching} onRetry={() => void refetch()} />
        ) : isPending || !form || !data ? (
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
                  <Label htmlFor="ob-enabled">{t("onlinebooking.enabled.label")}</Label>
                  <Pill tone={data.enabled ? "success" : "muted"} dot>
                    {data.enabled ? t("onlinebooking.live") : t("onlinebooking.off")}
                  </Pill>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("onlinebooking.enabled.help")}
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
                <p>{t("onlinebooking.incomplete")}</p>
                <ul className="list-disc pl-5">
                  {missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            )}

            <Group title={t("onlinebooking.what.title")} description={t("onlinebooking.what.description")}>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{t("onlinebooking.services.legend")}</legend>
                {serviceNames.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("onlinebooking.services.none")}</p>
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
                <legend className="text-sm font-medium">{t("onlinebooking.days.legend")}</legend>
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

            <Group title={t("onlinebooking.party.title")} description={t("onlinebooking.party.description")}>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ob-min">{t("onlinebooking.minParty")}</Label>
                  <Input id="ob-min" {...num("minPartySize")} />
                  {error("minPartySize")}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ob-max">{t("onlinebooking.maxParty")}</Label>
                  <Input id="ob-max" {...num("maxPartySize")} />
                  {error("maxPartySize")}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ob-lead">{t("onlinebooking.lead")}</Label>
                  <Input id="ob-lead" {...num("leadTimeMinutes")} />
                  {error("leadTimeMinutes")}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ob-advance">{t("onlinebooking.horizon")}</Label>
                  <Input id="ob-advance" placeholder={t("onlinebooking.horizon.placeholder")} {...num("maxAdvanceDays")} />
                  {error("maxAdvanceDays")}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ob-cutoff">{t("onlinebooking.cutoff")}</Label>
                  <Input id="ob-cutoff" {...num("selfServiceCutoffMinutes")} />
                  {error("selfServiceCutoffMinutes")}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ob-open">{t("onlinebooking.open")}</Label>
                  <Input id="ob-open" placeholder={t("onlinebooking.open.placeholder")} {...num("maxOpenBookingsPerContact")} />
                  {error("maxOpenBookingsPerContact")}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ob-locale">{t("common.language")}</Label>
                  <select
                    id="ob-locale"
                    value={form.locale}
                    onChange={(e) => setForm({ ...form, locale: e.target.value })}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                  >
                    {widgetLocales.map((l) => (
                      <option key={l} value={l}>
                        {LOCALE_NAMES[l]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </Group>

            <Group title={t("onlinebooking.guest.title")} description={t("onlinebooking.guest.description")}>
              <fieldset className="space-y-2" disabled={zonesReady && zonesLocked && form.publicZones.length === 0}>
                <legend className="text-sm font-medium">{t("onlinebooking.zones.legend")}</legend>
                {zonesReady && zonesLocked && form.publicZones.length === 0 ? (
                  <p id="ob-zones-help" className="text-sm text-muted-foreground">
                    {t("onlinebooking.zones.fewer")}
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2" aria-describedby="ob-zones-help">
                      {zoneOptions.map((name) => {
                        const unused = zonesReady && !tableZones.includes(name);
                        return (
                          <Chip
                            key={name}
                            checked={form.publicZones.includes(name)}
                            disabled={!zonesReady}
                            verbatim
                            onChange={(on) => toggleZone(name, on)}
                          >
                            {name}
                            {unused && (
                              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                ({t("onlinebooking.zones.unused")})
                              </span>
                            )}
                          </Chip>
                        );
                      })}
                    </div>
                    <p id="ob-zones-help" className="text-sm text-muted-foreground">
                      {t("onlinebooking.zones.help")}
                    </p>
                  </>
                )}
                {error("publicZones")}
              </fieldset>

              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="ob-service-names">{t("onlinebooking.serviceNames.label")}</Label>
                  <p className="text-sm text-muted-foreground">{t("onlinebooking.serviceNames.help")}</p>
                </div>
                <Switch
                  id="ob-service-names"
                  checked={form.showServiceNames}
                  onCheckedChange={(v) => setForm({ ...form, showServiceNames: v })}
                />
              </div>

              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="ob-waitlist">{t("onlinebooking.waitlist.label")}</Label>
                  <p id="ob-waitlist-help" className="text-sm text-muted-foreground">
                    {demo?.enabled ? t("onlinebooking.waitlist.demo") : t("onlinebooking.waitlist.help")}
                  </p>
                </div>
                <Switch
                  id="ob-waitlist"
                  aria-describedby="ob-waitlist-help"
                  checked={form.waitlistEnabled && !demo?.enabled}
                  disabled={demo?.enabled === true}
                  onCheckedChange={(v) => setForm({ ...form, waitlistEnabled: v })}
                />
              </div>
            </Group>

            <Group title={t("onlinebooking.privacy.title")} description={t("onlinebooking.privacy.description")}>
              <div className="space-y-2">
                <Label htmlFor="ob-privacy-url">{t("onlinebooking.privacy.label")}</Label>
                <Input
                  id="ob-privacy-url"
                  inputMode="url"
                  placeholder="https://example.com/privacy" // i18n-ok
                  value={form.privacyNoticeUrl}
                  aria-invalid={errors.privacyNoticeUrl ? true : undefined}
                  aria-describedby={
                    errors.privacyNoticeUrl ? "ob-privacy-url-help ob-privacyNoticeUrl-error" : "ob-privacy-url-help"
                  }
                  onChange={(e) => setForm({ ...form, privacyNoticeUrl: e.target.value })}
                />
                {error("privacyNoticeUrl")}
                <p id="ob-privacy-url-help" className="text-sm text-muted-foreground">
                  {t("onlinebooking.privacy.help")}
                </p>
              </div>
            </Group>

            <Group title={t("onlinebooking.embedding.title")} description={t("onlinebooking.embedding.description")}>
              <div className="space-y-2">
                <Label htmlFor="ob-origins">{t("onlinebooking.origins.label")}</Label>
                <Textarea
                  id="ob-origins"
                  rows={3}
                  placeholder="https://example.com" // i18n-ok
                  value={form.allowedOrigins}
                  aria-invalid={errors.allowedOrigins ? true : undefined}
                  aria-describedby={errors.allowedOrigins ? "ob-allowedOrigins-error" : undefined}
                  onChange={(e) => setForm({ ...form, allowedOrigins: e.target.value })}
                />
                {error("allowedOrigins")}
                <p className="text-sm text-muted-foreground">
                  {t("onlinebooking.origins.help")}
                </p>
              </div>
            </Group>

            <fieldset className="space-y-4">
              <legend className="font-display text-lg">{t("onlinebooking.look.legend")}</legend>
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
                          {t(COLOR_LABELS[k])}
                        </Label>
                      </div>
                    ))}
                  </div>
                  {error("themeColors")}
                  <div className="space-y-3 rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <Label htmlFor="ob-dark-palette">{t("onlinebooking.dark.label")}</Label>
                        <p className="text-sm text-muted-foreground">
                          {t("onlinebooking.dark.help")}
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
                                {t("onlinebooking.dark.color", { color: t(COLOR_LABELS[k]).toLowerCase() })}
                              </Label>
                            </div>
                          ))}
                        </div>
                        {error("themeDarkColors")}
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="ob-dark-radius">{t("onlinebooking.dark.radius")}</Label>
                            <Input
                              id="ob-dark-radius"
                              inputMode="numeric"
                              placeholder={t("onlinebooking.sameAsLight")}
                              value={form.theme.darkRadius}
                              aria-invalid={errors.themeDarkRadius ? true : undefined}
                              aria-describedby={errors.themeDarkRadius ? "ob-themeDarkRadius-error" : undefined}
                              onChange={(e) => setTheme({ darkRadius: e.target.value })}
                            />
                            {error("themeDarkRadius")}
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="ob-dark-font">{t("onlinebooking.dark.font")}</Label>
                            <select
                              id="ob-dark-font"
                              value={form.theme.darkFont}
                              onChange={(e) => setTheme({ darkFont: e.target.value as Font | "" })}
                              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                            >
                              <option value="">{t("onlinebooking.sameAsLight")}</option>
                              {FONTS.map((f) => (
                                <option key={f} value={f}>
                                  {t(FONT_LABELS[f])}
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
                      <Label htmlFor="ob-radius">{t("onlinebooking.radius")}</Label>
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
                      <Label htmlFor="ob-font">{t("onlinebooking.font")}</Label>
                      <select
                        id="ob-font"
                        value={form.theme.font}
                        onChange={(e) => setTheme({ font: e.target.value as Font })}
                        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                      >
                        {FONTS.map((f) => (
                          <option key={f} value={f}>
                            {t(FONT_LABELS[f])}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ob-logo">{t("onlinebooking.logo.label")}</Label>
                    <Input
                      id="ob-logo"
                      placeholder="https://example.com/logo.png" // i18n-ok
                      value={form.theme.logoUrl}
                      aria-invalid={errors.themeLogoUrl ? true : undefined}
                      aria-describedby={errors.themeLogoUrl ? "ob-themeLogoUrl-error" : undefined}
                      onChange={(e) => setTheme({ logoUrl: e.target.value })}
                    />
                    {error("themeLogoUrl")}
                    <p className="text-sm text-muted-foreground">
                      {t("onlinebooking.logo.help")}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setForm({ ...form, theme: defaultThemeForm() })}
                  >
                    {t("onlinebooking.resetLook")}
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
                      label={t("onlinebooking.preview.darkLabel")}
                    />
                  )}
                </div>
              </div>
              {lowContrast !== null && (
                <div
                  role="alert"
                  className="rounded-md border border-amber-500/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
                >
                  {t("onlinebooking.contrast.light", { ratio: lowContrast })}
                </div>
              )}
              {lowContrastDark !== null && (
                <div
                  role="alert"
                  className="rounded-md border border-amber-500/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
                >
                  {t("onlinebooking.contrast.dark", { ratio: lowContrastDark })}
                </div>
              )}
            </fieldset>


            <div className="space-y-4 border-t pt-6">
              <h3 className="font-display text-lg">{t("onlinebooking.embed.title")}</h3>
              {key ? (
                <div className="space-y-2">
                  <Label htmlFor="ob-key">{t("onlinebooking.key.label")}</Label>
                  <div className="flex gap-2">
                    <Input id="ob-key" readOnly value={key} className="font-mono" />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={t("onlinebooking.key.copyAria")}
                      onClick={() => void copyText(key, t("onlinebooking.key.copied"), t("onlinebooking.copyFailed"))}
                    >
                      <CopyIcon className="size-4" />
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t("onlinebooking.key.help")}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("onlinebooking.key.none")}
                </p>
              )}

              <div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmRotate(true)}
                >
                  {t("onlinebooking.rotateKey")}
                </Button>
              </div>

              {data.enabled && key && (
                <div className="space-y-2">
                  <Label htmlFor="ob-host">{t("onlinebooking.host.label")}</Label>
                  <Input
                    id="ob-host"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    className="font-mono"
                  />
                  <p className="text-sm text-muted-foreground">
                    {withCode(t("onlinebooking.host.help"), { path: `/w/${key}` })}
                  </p>
                  {!hostOk && (
                    <p className="text-sm text-destructive" role="alert">
                      {t("onlinebooking.host.invalid")}
                    </p>
                  )}

                  <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                    <div>
                      <Label htmlFor="ob-follow-dark">{t("onlinebooking.followDark.label")}</Label>
                      <p className="text-sm text-muted-foreground">
                        {t("onlinebooking.followDark.help")}
                      </p>
                    </div>
                    <Switch id="ob-follow-dark" checked={followDark} onCheckedChange={setFollowDark} />
                  </div>

                  <Label htmlFor="ob-script">{t("onlinebooking.script.label")}</Label>
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
                      aria-label={t("onlinebooking.script.copyAria")}
                      disabled={!hostOk}
                      onClick={() => void copyText(script, t("onlinebooking.embedCopied"), t("onlinebooking.copyFailed"))}
                    >
                      <CopyIcon className="size-4" />
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {withCode(t("onlinebooking.script.help"), { script: "script-src", frame: "frame-src" })}
                  </p>

                  <Label htmlFor="ob-snippet">{t("onlinebooking.snippet.label")}</Label>
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
                      aria-label={t("onlinebooking.snippet.copyAria")}
                      disabled={!hostOk}
                      onClick={() => void copyText(snippet, t("onlinebooking.embedCopied"), t("onlinebooking.copyFailed"))}
                    >
                      <CopyIcon className="size-4" />
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {withCode(t("onlinebooking.snippet.help"), { frame: "frame-src" })}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t("onlinebooking.snippet.origins")}
                  </p>
                </div>
              )}
            </div>

            <SaveBar hint={t("onlinebooking.saveHint")}>
              <Button onClick={submit} disabled={save.isPending}>
                {save.isPending ? t("common.saving") : t("onlinebooking.saveButton")}
              </Button>
            </SaveBar>
          </>
        )}
      </CardContent>

      <Dialog open={confirmRotate} onOpenChange={setConfirmRotate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("onlinebooking.rotate.title")}</DialogTitle>
            <DialogDescription>
              {t("onlinebooking.rotate.description")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRotate(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={rotate.isPending}
              onClick={() => rotate.mutate()}
            >
              {rotate.isPending ? t("onlinebooking.rotating") : t("onlinebooking.rotateKey")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
