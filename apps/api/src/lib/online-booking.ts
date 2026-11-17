import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { services, venueOnlineBooking, venues } from "../db/schema";
import type { Db, DbTx } from "./venue";
import { isFrameAncestor } from "./widget-page";

export const LOCALES = ["es", "en", "ca", "fr", "de", "it", "pt"] as const;
export const FONTS = ["system", "serif", "rounded"] as const;
export const COLOR_KEYS = ["primary", "onPrimary", "background", "surface", "text", "muted", "border"] as const;
export const MAX_ORIGINS = 10;
const MAX_LOGO_URL = 2048;
/** The widget's built-in text and background colors (`apps/widget/src/styles.css`), used for a key a theme leaves out. */
export const DEFAULT_TEXT = "#1c1b19";
export const DEFAULT_BACKGROUND = "#ffffff";

export interface Theme {
  colors?: Partial<Record<(typeof COLOR_KEYS)[number], string>>;
  radius?: number;
  font?: (typeof FONTS)[number];
  logoUrl?: string;
}

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

export interface Warning {
  code: "low_contrast";
  message: string;
  ratio: number;
}

export type OnlineBookingInput = Partial<Omit<OnlineBooking, "bookingKey" | "theme">> & { theme?: Theme | null };

export type OnlineBookingResult =
  | { ok: true; settings: OnlineBooking; warnings: Warning[] }
  | { ok: false; code: "venue_not_found" | "online_booking_incomplete" | "invalid_request" };

type Row = typeof venueOnlineBooking.$inferSelect;

function defaults(): OnlineBooking {
  return {
    enabled: false,
    bookingKey: null,
    allowedOrigins: [],
    services: null,
    weekdays: null,
    minPartySize: 1,
    maxPartySize: 8,
    leadTimeMinutes: 0,
    maxAdvanceDays: null,
    selfServiceCutoffMinutes: 120,
    maxOpenBookingsPerContact: 2,
    confirmationMode: "auto",
    askConsent: false,
    locale: "es",
    theme: {},
  };
}

function viewOf(r: Row | undefined): OnlineBooking {
  if (!r) return defaults();
  return {
    enabled: r.enabled,
    bookingKey: r.bookingKey,
    allowedOrigins: r.allowedOrigins,
    services: r.services,
    weekdays: r.weekdays,
    minPartySize: r.minPartySize,
    maxPartySize: r.maxPartySize,
    leadTimeMinutes: r.leadTimeMinutes,
    maxAdvanceDays: r.maxAdvanceDays,
    selfServiceCutoffMinutes: r.selfServiceCutoffMinutes,
    maxOpenBookingsPerContact: r.maxOpenBookingsPerContact,
    confirmationMode: r.confirmationMode,
    askConsent: r.askConsent,
    locale: r.locale,
    theme: r.theme as Theme,
  };
}

export function newBookingKey(): string {
  return `pk_${randomBytes(16).toString("base64url")}`;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const intIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** The origin in lower case when the value is exactly an `https` origin, as `new URL(v).origin` writes it. */
export function normalizeOrigin(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const origin = v.toLowerCase();
  if (!isFrameAncestor(origin)) return null;
  try {
    return new URL(origin).origin === origin ? origin : null;
  } catch {
    return null;
  }
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

function parseTheme(v: unknown): Theme | null {
  if (!isObject(v)) return null;
  const out: Theme = {};
  for (const [k, val] of Object.entries(v)) {
    if (k === "colors") {
      if (!isObject(val)) return null;
      const colors: NonNullable<Theme["colors"]> = {};
      for (const [ck, cv] of Object.entries(val)) {
        if (!(COLOR_KEYS as readonly string[]).includes(ck)) return null;
        if (typeof cv !== "string" || !HEX.test(cv)) return null;
        colors[ck as (typeof COLOR_KEYS)[number]] = cv.toLowerCase();
      }
      out.colors = colors;
    } else if (k === "radius") {
      if (!intIn(val, 0, 24)) return null;
      out.radius = val;
    } else if (k === "font") {
      if (typeof val !== "string" || !(FONTS as readonly string[]).includes(val)) return null;
      out.font = val as (typeof FONTS)[number];
    } else if (k === "logoUrl") {
      if (val === null) continue;
      if (typeof val !== "string" || val.length > MAX_LOGO_URL || /[\s\x00-\x1f\x7f]/.test(val)) return null;
      try {
        const u = new URL(val);
        if (u.protocol !== "https:" || u.username !== "" || u.password !== "" || u.hostname === "") return null;
      } catch {
        return null;
      }
      out.logoUrl = val;
    } else return null;
  }
  return out;
}

const INT_FIELDS = [
  ["minPartySize", 1, 100, false],
  ["maxPartySize", 1, 100, false],
  ["leadTimeMinutes", 0, 10080, false],
  ["maxAdvanceDays", 0, 1000, true],
  ["selfServiceCutoffMinutes", 0, 10080, false],
  ["maxOpenBookingsPerContact", 1, 20, true],
] as const;

/** Parses a request body. Returns null when any present field is invalid. Absent fields stay absent, null resets. */
export function parseOnlineBookingInput(body: unknown): OnlineBookingInput | null {
  if (!isObject(body) || Object.keys(body).length === 0) return null;
  const out: OnlineBookingInput = {};
  for (const key of ["enabled", "askConsent"] as const) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "boolean") return null;
    out[key] = body[key];
  }
  if (body.allowedOrigins !== undefined) {
    if (!Array.isArray(body.allowedOrigins) || body.allowedOrigins.length > MAX_ORIGINS) return null;
    const seen = new Set<string>();
    for (const o of body.allowedOrigins) {
      const n = normalizeOrigin(o);
      if (!n) return null;
      seen.add(n);
    }
    out.allowedOrigins = [...seen];
  }
  if (body.services !== undefined) {
    const s = body.services;
    if (s === null) out.services = null;
    else if (Array.isArray(s) && s.length >= 1 && s.every((n) => typeof n === "string" && n !== "")) {
      out.services = [...new Set(s as string[])];
    } else return null;
  }
  if (body.weekdays !== undefined) {
    const w = body.weekdays;
    if (w === null) out.weekdays = null;
    else if (Array.isArray(w) && w.length >= 1 && w.length <= 7 && w.every((d) => intIn(d, 1, 7))) {
      if (new Set(w).size !== w.length) return null;
      out.weekdays = (w as number[]).slice().sort((a, b) => a - b);
    } else return null;
  }
  for (const [key, min, max, nullable] of INT_FIELDS) {
    const v = body[key];
    if (v === undefined) continue;
    if (v === null && nullable) (out as Record<string, unknown>)[key] = null;
    else if (intIn(v, min, max)) (out as Record<string, unknown>)[key] = v;
    else return null;
  }
  if (body.confirmationMode !== undefined) {
    if (body.confirmationMode !== "auto") return null;
    out.confirmationMode = "auto";
  }
  if (body.locale !== undefined) {
    if (typeof body.locale !== "string" || !(LOCALES as readonly string[]).includes(body.locale)) return null;
    out.locale = body.locale;
  }
  if (body.theme !== undefined) {
    if (body.theme === null) out.theme = null;
    else {
      const t = parseTheme(body.theme);
      if (!t) return null;
      out.theme = t;
    }
  }
  return out;
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/** Warns when the text color, as the widget shows it, has a contrast below WCAG AA against the background. */
export function contrastWarnings(theme: Theme): Warning[] {
  const fg = theme.colors?.text ?? DEFAULT_TEXT;
  const bg = theme.colors?.background ?? DEFAULT_BACKGROUND;
  const [a, b] = [luminance(fg), luminance(bg)];
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  if (ratio >= 4.5) return [];
  const rounded = Math.round(ratio * 100) / 100;
  return [
    {
      code: "low_contrast",
      message: `The text color has a contrast of ${rounded}:1 against the background color, below the 4.5:1 of WCAG AA.`,
      ratio: rounded,
    },
  ];
}

export async function getOnlineBooking(db: Db, venueId: string): Promise<OnlineBooking | null> {
  const v = (await db.select({ id: venues.id }).from(venues).where(eq(venues.id, venueId)).limit(1))[0];
  if (!v) return null;
  const row = (await db.select().from(venueOnlineBooking).where(eq(venueOnlineBooking.venueId, venueId)).limit(1))[0];
  return viewOf(row);
}

async function lockVenue(tx: DbTx, venueId: string) {
  return (await tx.select().from(venues).where(eq(venues.id, venueId)).for("update").limit(1))[0];
}

async function current(tx: DbTx, venueId: string): Promise<OnlineBooking> {
  const row = (await tx.select().from(venueOnlineBooking).where(eq(venueOnlineBooking.venueId, venueId)).limit(1))[0];
  return viewOf(row);
}

async function store(tx: DbTx, venueId: string, s: OnlineBooking) {
  const { bookingKey, theme, ...rest } = s;
  const values = { ...rest, bookingKey, theme: theme as Record<string, unknown>, updatedAt: new Date() };
  await tx
    .insert(venueOnlineBooking)
    .values({ venueId, ...values })
    .onConflictDoUpdate({ target: venueOnlineBooking.venueId, set: values });
}

export async function setOnlineBooking(
  db: Db,
  venueId: string,
  input: OnlineBookingInput,
): Promise<OnlineBookingResult> {
  return db.transaction(async (tx): Promise<OnlineBookingResult> => {
    const venue = await lockVenue(tx, venueId);
    if (!venue) return { ok: false, code: "venue_not_found" };
    const { theme, ...rest } = input;
    const merged: OnlineBooking = { ...(await current(tx, venueId)), ...rest };
    if (theme !== undefined) merged.theme = theme ?? {};
    if (merged.minPartySize > merged.maxPartySize) return { ok: false, code: "invalid_request" };
    const rows = await tx
      .select({ name: services.name, days: services.days })
      .from(services)
      .where(eq(services.venueId, venueId));
    if (merged.services?.some((n) => !rows.some((r) => r.name === n))) {
      return { ok: false, code: "invalid_request" };
    }
    if (merged.enabled) {
      const bookable = rows.some(
        (r) =>
          (merged.services === null || merged.services.includes(r.name)) &&
          (merged.weekdays === null || r.days.some((d) => merged.weekdays!.includes(d))),
      );
      if (venue.name.trim() === "" || !bookable) return { ok: false, code: "online_booking_incomplete" };
      merged.bookingKey ??= newBookingKey();
    }
    await store(tx, venueId, merged);
    return { ok: true, settings: merged, warnings: contrastWarnings(merged.theme) };
  });
}

export async function rotateBookingKey(db: Db, venueId: string): Promise<OnlineBookingResult> {
  return db.transaction(async (tx): Promise<OnlineBookingResult> => {
    if (!(await lockVenue(tx, venueId))) return { ok: false, code: "venue_not_found" };
    const settings = { ...(await current(tx, venueId)), bookingKey: newBookingKey() };
    await store(tx, venueId, settings);
    return { ok: true, settings, warnings: [] };
  });
}
