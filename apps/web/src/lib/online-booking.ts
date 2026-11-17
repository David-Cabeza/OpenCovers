export interface OnlineBooking {
  enabled: boolean;
  bookingKey: string | null;
  allowedOrigins: string[];
  services: string[] | null;
  weekdays: number[] | null;
  minPartySize: number;
  maxPartySize: number;
  leadTimeMinutes: number;
  maxAdvanceDays: number | null;
  selfServiceCutoffMinutes: number;
  maxOpenBookingsPerContact: number | null;
  confirmationMode: string;
  askConsent: boolean;
  locale: string;
  theme: Theme;
}

export interface OnlineBookingSaved extends OnlineBooking {
  warnings: { code: string; message: string; ratio?: number }[];
}

export type OnlineBookingUpdate = Partial<
  Omit<OnlineBooking, "bookingKey" | "confirmationMode" | "askConsent" | "theme">
> & { theme?: Theme | null };

export const LOCALES = ["es", "en", "ca", "fr", "de", "it", "pt"] as const;
export const LOCALE_NAMES: Record<(typeof LOCALES)[number], string> = {
  es: "Español",
  en: "English",
  ca: "Català",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
  pt: "Português",
};

export const COLOR_KEYS = ["primary", "onPrimary", "background", "surface", "text", "muted", "border"] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];
export const FONTS = ["system", "serif", "rounded"] as const;
export type Font = (typeof FONTS)[number];

/** The theme tokens of ADR-0017 section 5. An absent key uses the widget's built-in value. */
export interface Theme {
  colors?: Partial<Record<ColorKey, string>>;
  radius?: number;
  font?: Font;
  logoUrl?: string | null;
}

/** The widget's built-in theme, as `apps/widget/src/styles.css` and `apps/widget/src/theme.ts` set it. */
export const DEFAULT_THEME = {
  colors: {
    primary: "#1f4d3a",
    onPrimary: "#ffffff",
    background: "#ffffff",
    surface: "#f5f3ef",
    text: "#1c1b19",
    muted: "#5c5852",
    border: "#cfcac1",
  },
  radius: 8,
  font: "system",
} as const satisfies Theme;

export const FONT_STACKS: Record<Font, string> = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  rounded:
    'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Arial Rounded MT", "Arial Rounded MT Bold", Calibri, sans-serif',
};

export interface ThemeForm {
  colors: Record<ColorKey, string>;
  radius: string;
  font: Font;
  logoUrl: string;
}

export function themeToForm(theme: Theme): ThemeForm {
  return {
    colors: { ...DEFAULT_THEME.colors, ...theme.colors },
    radius: String(theme.radius ?? DEFAULT_THEME.radius),
    font: theme.font ?? DEFAULT_THEME.font,
    logoUrl: theme.logoUrl ?? "",
  };
}

export const defaultThemeForm = (): ThemeForm => themeToForm({});

const HEX = /^#[0-9a-f]{6}$/;

/** A logo address the API accepts: `https`, a host, no credentials, no spaces, up to 2048 characters. */
export function isLogoUrl(text: string): boolean {
  if (text.length > 2048 || /[\s\x00-\x1f\x7f]/.test(text)) return false;
  try {
    const u = new URL(text);
    return u.protocol === "https:" && u.hostname !== "" && u.username === "" && u.password === "";
  } catch {
    return false;
  }
}

/** The theme with every key that equals the built-in value left out, in a fixed key order. */
function compact(theme: Theme): Theme {
  const out: Theme = {};
  const colors: Partial<Record<ColorKey, string>> = {};
  for (const k of COLOR_KEYS) {
    const c = theme.colors?.[k]?.toLowerCase();
    if (c && c !== DEFAULT_THEME.colors[k]) colors[k] = c;
  }
  if (Object.keys(colors).length > 0) out.colors = colors;
  if (theme.radius !== undefined && theme.radius !== DEFAULT_THEME.radius) out.radius = theme.radius;
  if (theme.font !== undefined && theme.font !== DEFAULT_THEME.font) out.font = theme.font;
  if (theme.logoUrl) out.logoUrl = theme.logoUrl;
  return out;
}

/** The theme the form describes, or null after writing its errors into `errors`. */
function parseTheme(form: ThemeForm, errors: FormErrors): Theme | null {
  const radius = int(form.radius, 0, 24, false);
  const logo = form.logoUrl.trim();
  let ok = true;
  if (radius == null) {
    errors.themeRadius = "Whole number of pixels from 0 to 24.";
    ok = false;
  }
  if (logo !== "" && !isLogoUrl(logo)) {
    errors.themeLogoUrl = "An https address of an image, with no spaces, up to 2048 characters.";
    ok = false;
  }
  if (COLOR_KEYS.some((k) => !HEX.test(form.colors[k].toLowerCase()))) {
    errors.themeColors = "Each color is #rrggbb.";
    ok = false;
  }
  return ok ? compact({ colors: form.colors, radius: radius ?? undefined, font: form.font, logoUrl: logo || undefined }) : null;
}

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

/** Editable state as the form holds it: numbers as text, origins one per line. */
export interface OnlineBookingForm {
  enabled: boolean;
  /** Service names ticked. Null means every service. */
  services: string[] | null;
  weekdays: number[];
  minPartySize: string;
  maxPartySize: string;
  leadTimeMinutes: string;
  maxAdvanceDays: string;
  selfServiceCutoffMinutes: string;
  maxOpenBookingsPerContact: string;
  allowedOrigins: string;
  locale: string;
  theme: ThemeForm;
}

export type FormErrors = Partial<
  Record<Exclude<keyof OnlineBookingForm, "theme"> | "themeRadius" | "themeLogoUrl" | "themeColors", string>
>;

export function toForm(s: OnlineBooking): OnlineBookingForm {
  return {
    enabled: s.enabled,
    services: s.services,
    weekdays: s.weekdays ?? ALL_DAYS,
    minPartySize: String(s.minPartySize),
    maxPartySize: String(s.maxPartySize),
    leadTimeMinutes: String(s.leadTimeMinutes),
    maxAdvanceDays: s.maxAdvanceDays === null ? "" : String(s.maxAdvanceDays),
    selfServiceCutoffMinutes: String(s.selfServiceCutoffMinutes),
    maxOpenBookingsPerContact:
      s.maxOpenBookingsPerContact === null ? "" : String(s.maxOpenBookingsPerContact),
    allowedOrigins: s.allowedOrigins.join("\n"),
    locale: s.locale,
    theme: themeToForm(s.theme),
  };
}

// The API check (`normalizeOrigin`), apart from the URL parse that also refuses `:443` and ports over 65535.
const ORIGIN = /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::[0-9]{1,5})?$/;

function int(text: string, min: number, max: number, nullable: boolean): number | null | undefined {
  const t = text.trim();
  if (t === "") return nullable ? null : undefined;
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n >= min && n <= max ? n : undefined;
}

function sameSet<T>(a: readonly T[] | null, b: readonly T[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((x) => b.includes(x));
}

/**
 * The fields that differ from the stored settings, as a partial PUT body.
 * `serviceNames` are all of the venue's services, so ticking every one sends null.
 */
export function parseForm(
  form: OnlineBookingForm,
  stored: OnlineBooking,
  serviceNames: readonly string[],
): { ok: true; update: OnlineBookingUpdate } | { ok: false; errors: FormErrors } {
  const errors: FormErrors = {};
  const update: OnlineBookingUpdate = {};

  if (form.enabled !== stored.enabled) update.enabled = form.enabled;

  const min = int(form.minPartySize, 1, 100, false);
  const max = int(form.maxPartySize, 1, 100, false);
  if (min == null) errors.minPartySize = "Whole number from 1 to 100.";
  if (max == null) errors.maxPartySize = "Whole number from 1 to 100.";
  if (min != null && max != null && min > max) errors.maxPartySize = "At least the smallest party.";
  if (min != null && min !== stored.minPartySize) update.minPartySize = min;
  if (max != null && max !== stored.maxPartySize) update.maxPartySize = max;

  const lead = int(form.leadTimeMinutes, 0, 10080, false);
  if (lead == null) errors.leadTimeMinutes = "Whole number of minutes from 0 to 10080.";
  else if (lead !== stored.leadTimeMinutes) update.leadTimeMinutes = lead;

  const advance = int(form.maxAdvanceDays, 0, 1000, true);
  if (advance === undefined) errors.maxAdvanceDays = "Leave empty, or a whole number of days from 0 to 1000.";
  else if (advance !== stored.maxAdvanceDays) update.maxAdvanceDays = advance;

  const cutoff = int(form.selfServiceCutoffMinutes, 0, 10080, false);
  if (cutoff == null) errors.selfServiceCutoffMinutes = "Whole number of minutes from 0 to 10080.";
  else if (cutoff !== stored.selfServiceCutoffMinutes) update.selfServiceCutoffMinutes = cutoff;

  const open = int(form.maxOpenBookingsPerContact, 1, 20, true);
  if (open === undefined) errors.maxOpenBookingsPerContact = "Leave empty, or a whole number from 1 to 20.";
  else if (open !== stored.maxOpenBookingsPerContact) update.maxOpenBookingsPerContact = open;

  const origins = form.allowedOrigins
    .split(/[\n,]/)
    .map((o) => o.trim().toLowerCase())
    .filter((o) => o !== "");
  if (origins.length > 10) errors.allowedOrigins = "At most 10 addresses.";
  else if (origins.some((o) => !ORIGIN.test(o)))
    errors.allowedOrigins =
      "Each address is https://host or https://host:port, with no path or wildcard, and a host of letters, digits, hyphens and dots.";
  else if (!sameSet(origins, stored.allowedOrigins)) update.allowedOrigins = origins;

  if (form.weekdays.length === 0) errors.weekdays = "Pick at least one day.";
  else {
    const days = form.weekdays.length === 7 ? null : [...form.weekdays].sort((a, b) => a - b);
    if (!sameSet(days, stored.weekdays)) update.weekdays = days;
  }

  if (form.services !== null && form.services.length === 0) errors.services = "Pick at least one service.";
  else {
    const everyService =
      form.services !== null &&
      serviceNames.length > 0 &&
      serviceNames.every((n) => form.services?.includes(n));
    const services = everyService ? null : form.services;
    if (!sameSet(services, stored.services)) update.services = services;
  }

  if (form.locale !== stored.locale) update.locale = form.locale;

  const theme = parseTheme(form.theme, errors);
  if (theme && JSON.stringify(theme) !== JSON.stringify(compact(stored.theme)))
    update.theme = Object.keys(theme).length === 0 ? null : theme;

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, update };
}

export function embedSnippet(origin: string, key: string): string {
  const base = origin.trim().replace(/\/+$/, "");
  return `<iframe src="${base}/w/${key}" title="Book a table" width="100%" height="640" style="border:0"></iframe>`;
}

/** The widget address as an origin without a trailing slash, or null when it is not one (http or https, no path). */
export function widgetOrigin(input: string): string | null {
  const t = input.trim().replace(/\/+$/, "");
  try {
    const u = new URL(t);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.origin !== t) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** The recommended snippet: `embed.js` adds an iframe that follows the widget's height. */
export function scriptSnippet(origin: string, key: string): string {
  const base = origin.trim().replace(/\/+$/, "");
  return `<script src="${base}/w/embed.js" data-key="${key}" async></script>`;
}
