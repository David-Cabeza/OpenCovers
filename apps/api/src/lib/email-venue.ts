// What an email may say about the venue: only fields the venue itself set and the engine validated (name, public
// profile address and phone, theme colors and logo). Everything is optional and left out cleanly when missing.
// A guest's own text is never part of it.

import { accentFor, type EmailAccent } from "./email-layout";
import type { Theme } from "./online-booking";

export interface EmailVenue {
  name: string;
  /** The address as one line, e.g. `Calle Mayor 1, 28013 Madrid`, when the venue set a street or a locality. */
  address?: string;
  /** A plain map search URL for the address, with no tracking parameters. */
  mapUrl?: string;
  phone?: { display: string; href: string };
  /** An https logo URL from the venue's theme. */
  logoUrl?: string;
  accent: EmailAccent;
}

interface VenueRow {
  name: string;
  publicStreet: string | null;
  publicLocality: string | null;
  publicPostalCode: string | null;
  publicPhone: string | null;
}

const clean = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();

/** The venue facts for an email, from its row and the theme of its online-booking settings. */
export function emailVenue(row: VenueRow, theme: Theme = {}): EmailVenue {
  const name = clean(row.name);
  const street = clean(row.publicStreet);
  const town = [clean(row.publicPostalCode), clean(row.publicLocality)].filter(Boolean).join(" ");
  const address = [street, town].filter(Boolean).join(", ");
  const phone = clean(row.publicPhone);
  const tel = phone.replace(/[^0-9+]/g, "");
  const logo = theme.logoUrl && /^https:\/\/\S+$/.test(theme.logoUrl) ? theme.logoUrl : undefined;
  return {
    name,
    ...(address ? { address, mapUrl: mapSearchUrl([name, address].filter(Boolean).join(", ")) } : {}),
    ...(tel.replace(/\D/g, "").length >= 5 ? { phone: { display: phone, href: `tel:${tel}` } } : {}),
    ...(logo ? { logoUrl: logo } : {}),
    accent: accentFor(theme.colors, theme.darkColors),
  };
}

/** A Google Maps search for `query`: a plain link, no tracking. */
export function mapSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
