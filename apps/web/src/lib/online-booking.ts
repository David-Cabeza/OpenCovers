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
  theme: unknown;
}

export interface OnlineBookingSaved extends OnlineBooking {
  warnings: { code: string; message: string; ratio?: number }[];
}

export type OnlineBookingUpdate = Partial<
  Omit<OnlineBooking, "bookingKey" | "confirmationMode" | "askConsent" | "theme">
>;

export const LOCALES = ["es", "en"] as const;

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
}

export type FormErrors = Partial<Record<keyof OnlineBookingForm, string>>;

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
  };
}

const ORIGIN = /^https:\/\/[^/?#@*\s:]+(:[0-9]{1,5})?$/;

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
      "Each address is https://host or https://host:port, with no path and no wildcard.";
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

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, update };
}

export function embedSnippet(origin: string, key: string): string {
  const base = origin.trim().replace(/\/+$/, "");
  return `<iframe src="${base}/w/${key}" title="Reservas" width="100%" height="640" style="border:0"></iframe>`;
}
