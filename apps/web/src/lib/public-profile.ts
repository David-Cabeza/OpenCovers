// Mirrors the API's rules for PUT /v1/venues/{id}/public-profile
// (apps/api/src/lib/public-profile.ts, ADR-0012).

export interface PublicProfile {
  publicProfileEnabled: boolean;
  street: string | null;
  locality: string | null;
  postalCode: string | null;
  region: string | null;
  country: string | null;
  phone: string | null;
  websiteUrl: string | null;
  bookingUrl: string | null;
  cuisine: string | null;
  priceRange: string | null;
  latitude: number | null;
  longitude: number | null;
}

export type ProfileUpdate = Partial<PublicProfile>;

export interface PublicProfileForm {
  publicProfileEnabled: boolean;
  street: string;
  locality: string;
  postalCode: string;
  region: string;
  country: string;
  phone: string;
  websiteUrl: string;
  bookingUrl: string;
  cuisine: string;
  priceRange: string;
  latitude: string;
  longitude: string;
}

export type FormErrors = Partial<Record<keyof PublicProfileForm, string>>;

export type ParseResult =
  | { ok: true; update: ProfileUpdate }
  | { ok: false; errors: FormErrors };

export const PRICE_RANGES = ["$", "$$", "$$$", "$$$$"] as const;

const TEXT_LIMITS = {
  street: 200,
  locality: 100,
  postalCode: 20,
  region: 100,
  cuisine: 100,
} as const;
const TEXT_LABELS = {
  street: "Street",
  locality: "City or town",
  postalCode: "Postal code",
  region: "Region",
  cuisine: "Cuisine",
} as const;
const PHONE = /^\+?[0-9 ()./-]{5,30}$/;
const MAX_URL = 2048;

export function toForm(p: PublicProfile): PublicProfileForm {
  const s = (v: string | number | null) => (v === null ? "" : String(v));
  return {
    publicProfileEnabled: p.publicProfileEnabled,
    street: s(p.street),
    locality: s(p.locality),
    postalCode: s(p.postalCode),
    region: s(p.region),
    country: s(p.country),
    phone: s(p.phone),
    websiteUrl: s(p.websiteUrl),
    bookingUrl: s(p.bookingUrl),
    cuisine: s(p.cuisine),
    priceRange: s(p.priceRange),
    latitude: s(p.latitude),
    longitude: s(p.longitude),
  };
}

function httpsHref(value: string): string | null {
  if (value.length > MAX_URL) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username !== "" || u.password !== "" || u.hostname === "") {
      return null;
    }
    return u.href;
  } catch {
    return null;
  }
}

function coordinate(raw: string, limit: number): number | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return undefined;
  const n = Number(t);
  return Math.abs(n) <= limit ? n : undefined;
}

/** Validates the form and returns only the fields that differ from `initial`. */
export function parseForm(form: PublicProfileForm, initial: PublicProfile): ParseResult {
  const errors: FormErrors = {};
  const next: Partial<PublicProfile> = {};

  next.publicProfileEnabled = form.publicProfileEnabled;

  for (const key of Object.keys(TEXT_LIMITS) as (keyof typeof TEXT_LIMITS)[]) {
    const t = form[key].trim();
    if (t.length > TEXT_LIMITS[key]) {
      errors[key] = `${TEXT_LABELS[key]} can be at most ${TEXT_LIMITS[key]} characters.`;
    } else {
      next[key] = t === "" ? null : t;
    }
  }

  const country = form.country.trim();
  if (country === "") next.country = null;
  else if (!/^[A-Z]{2}$/.test(country)) {
    errors.country = "Use a 2-letter upper-case country code, for example ES.";
  } else next.country = country;

  const phone = form.phone.trim();
  if (phone === "") next.phone = null;
  else if (!PHONE.test(phone)) {
    errors.phone = "Use 5 to 30 digits, spaces or + ( ) . / -, for example +34 910 000 000.";
  } else next.phone = phone;

  for (const key of ["websiteUrl", "bookingUrl"] as const) {
    const t = form[key].trim();
    if (t === "") next[key] = null;
    else {
      const href = httpsHref(t);
      if (href) next[key] = href;
      else {
        errors[key] =
          "Use an https address without a user name or password, for example https://example.com/.";
      }
    }
  }

  if (form.priceRange === "") next.priceRange = null;
  else if ((PRICE_RANGES as readonly string[]).includes(form.priceRange)) {
    next.priceRange = form.priceRange;
  } else errors.priceRange = "Pick $, $$, $$$ or $$$$.";

  const lat = coordinate(form.latitude, 90);
  const lon = coordinate(form.longitude, 180);
  if (lat === undefined) errors.latitude = "Latitude must be a number from -90 to 90.";
  else next.latitude = lat;
  if (lon === undefined) errors.longitude = "Longitude must be a number from -180 to 180.";
  else next.longitude = lon;
  if (lat !== undefined && lon !== undefined && (lat === null) !== (lon === null)) {
    errors[lat === null ? "latitude" : "longitude"] =
      "Give both latitude and longitude, or neither.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const update: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof PublicProfile)[]) {
    if (next[key] !== initial[key]) update[key] = next[key];
  }
  return { ok: true, update: update as ProfileUpdate };
}

/** What the API needs before the profile can be enabled, judged from the form values. */
export function missingForPublishing(form: PublicProfileForm): string[] {
  const missing: string[] = [];
  if (form.street.trim() === "") missing.push("street");
  if (form.locality.trim() === "") missing.push("city or town");
  if (form.country.trim() === "") missing.push("country");
  return missing;
}

export function jsonLdUrl(origin: string, venueId: string): string {
  return `${origin}/v1/venues/${encodeURIComponent(venueId)}/public.jsonld`;
}
