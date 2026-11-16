import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { services, venues } from "../db/schema";
import { toCountryCode } from "./contact";
import type { Db } from "./venue";

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

export type ProfileInput = Partial<PublicProfile>;

export type ProfileResult =
  | { ok: true; profile: PublicProfile }
  | { ok: false; code: "venue_not_found" | "public_profile_incomplete" };

const TEXT_FIELDS = {
  street: 200,
  locality: 100,
  postalCode: 20,
  region: 100,
  cuisine: 100,
} as const;

const PHONE = /^\+?[0-9 ()./-]{5,30}$/;
const PRICE_RANGE = /^\${1,4}$/;
const MAX_URL = 2048;

type Row = typeof venues.$inferSelect;

export function profileOf(v: Row): PublicProfile {
  return {
    publicProfileEnabled: v.publicProfileEnabled,
    street: v.publicStreet,
    locality: v.publicLocality,
    postalCode: v.publicPostalCode,
    region: v.publicRegion,
    country: v.publicCountry,
    phone: v.publicPhone,
    websiteUrl: v.publicWebsiteUrl,
    bookingUrl: v.publicBookingUrl,
    cuisine: v.publicCuisine,
    priceRange: v.publicPriceRange,
    latitude: v.publicLatitude,
    longitude: v.publicLongitude,
  };
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_URL) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username !== "" || u.password !== "" || u.hostname === "") return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Parses a request body. Returns null when any present field is invalid. Absent fields stay absent, null clears. */
export function parseProfileInput(body: unknown): ProfileInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const out: ProfileInput = {};
  if (b.publicProfileEnabled !== undefined) {
    if (typeof b.publicProfileEnabled !== "boolean") return null;
    out.publicProfileEnabled = b.publicProfileEnabled;
  }
  for (const [key, max] of Object.entries(TEXT_FIELDS) as [keyof typeof TEXT_FIELDS, number][]) {
    const v = b[key];
    if (v === undefined) continue;
    if (v === null) {
      out[key] = null;
      continue;
    }
    if (typeof v !== "string") return null;
    const t = v.trim();
    if (t === "") out[key] = null;
    else if (t.length > max) return null;
    else out[key] = t;
  }
  if (b.country !== undefined) {
    if (b.country === null) out.country = null;
    else {
      const c = toCountryCode(b.country);
      if (!c) return null;
      out.country = c;
    }
  }
  if (b.phone !== undefined) {
    if (b.phone === null) out.phone = null;
    else if (typeof b.phone === "string" && PHONE.test(b.phone.trim())) out.phone = b.phone.trim();
    else return null;
  }
  for (const key of ["websiteUrl", "bookingUrl"] as const) {
    const v = b[key];
    if (v === undefined) continue;
    if (v === null) out[key] = null;
    else {
      const u = httpsUrl(v);
      if (!u) return null;
      out[key] = u;
    }
  }
  if (b.priceRange !== undefined) {
    if (b.priceRange === null) out.priceRange = null;
    else if (typeof b.priceRange === "string" && PRICE_RANGE.test(b.priceRange)) out.priceRange = b.priceRange;
    else return null;
  }
  for (const [key, lim] of [["latitude", 90], ["longitude", 180]] as const) {
    const v = b[key];
    if (v === undefined) continue;
    if (v === null) out[key] = null;
    else if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= lim) out[key] = v;
    else return null;
  }
  return out;
}

export async function getProfile(db: Db, venueId: string): Promise<PublicProfile | null> {
  const v = (await db.select().from(venues).where(eq(venues.id, venueId)).limit(1))[0];
  return v ? profileOf(v) : null;
}

export async function setProfile(db: Db, venueId: string, input: ProfileInput): Promise<ProfileResult> {
  const v = (await db.select().from(venues).where(eq(venues.id, venueId)).limit(1))[0];
  if (!v) return { ok: false, code: "venue_not_found" };
  const merged: PublicProfile = { ...profileOf(v), ...input };
  if (
    (merged.latitude === null) !== (merged.longitude === null) ||
    (merged.publicProfileEnabled &&
      (v.name.trim() === "" || !merged.street || !merged.locality || !merged.country))
  ) {
    return { ok: false, code: "public_profile_incomplete" };
  }
  await db
    .update(venues)
    .set({
      publicProfileEnabled: merged.publicProfileEnabled,
      publicStreet: merged.street,
      publicLocality: merged.locality,
      publicPostalCode: merged.postalCode,
      publicRegion: merged.region,
      publicCountry: merged.country,
      publicPhone: merged.phone,
      publicWebsiteUrl: merged.websiteUrl,
      publicBookingUrl: merged.bookingUrl,
      publicCuisine: merged.cuisine,
      publicPriceRange: merged.priceRange,
      publicLatitude: merged.latitude,
      publicLongitude: merged.longitude,
    })
    .where(eq(venues.id, venueId));
  return { ok: true, profile: merged };
}

const ALL_DAYS = [
  "https://schema.org/Monday",
  "https://schema.org/Tuesday",
  "https://schema.org/Wednesday",
  "https://schema.org/Thursday",
  "https://schema.org/Friday",
  "https://schema.org/Saturday",
  "https://schema.org/Sunday",
];

export type JsonLd = Record<string, unknown>;

/** The schema.org Restaurant document, or null when the venue is unknown or has the profile off. */
export async function getJsonLd(db: Db, venueId: string): Promise<JsonLd | null> {
  const v = (await db.select().from(venues).where(eq(venues.id, venueId)).limit(1))[0];
  if (!v || !v.publicProfileEnabled) return null;
  const p = profileOf(v);
  const rows = await db
    .select({ openStart: services.openStart, openEnd: services.openEnd })
    .from(services)
    .where(eq(services.venueId, venueId))
    .orderBy(services.openStart, services.openEnd);
  const address: JsonLd = {
    "@type": "PostalAddress",
    streetAddress: p.street,
    addressLocality: p.locality,
    ...(p.postalCode ? { postalCode: p.postalCode } : {}),
    ...(p.region ? { addressRegion: p.region } : {}),
    addressCountry: p.country,
  };
  const doc: JsonLd = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: v.name,
    address,
  };
  if (p.websiteUrl) doc.url = p.websiteUrl;
  if (p.phone) doc.telephone = p.phone;
  if (p.cuisine) doc.servesCuisine = p.cuisine;
  if (p.priceRange) doc.priceRange = p.priceRange;
  if (p.latitude !== null && p.longitude !== null) {
    doc.geo = { "@type": "GeoCoordinates", latitude: p.latitude, longitude: p.longitude };
  }
  if (rows.length > 0) {
    doc.openingHoursSpecification = rows.map((r) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ALL_DAYS,
      opens: r.openStart,
      closes: r.openEnd,
    }));
  }
  if (p.bookingUrl) {
    doc.potentialAction = {
      "@type": "ReserveAction",
      target: { "@type": "EntryPoint", urlTemplate: p.bookingUrl },
      result: { "@type": "Reservation", name: "Book a table" },
    };
  }
  return doc;
}

export function etagOf(body: string): string {
  return `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`;
}

export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);
}
