// The guest routes of docs/contract/openapi.yaml under /v1/public. Same origin, no cookie, nothing cached.

export interface FormChallenge {
  nonce: string;
  issuedAt: string;
  difficulty: number;
  signature: string;
}

export interface PublicVenue {
  name: string;
  locale: string;
  phone: string | null;
  /** The public profile's street, postal code and locality, or null (C64). Absent from an older API. */
  address?: string | null;
  /** Read through `theme.ts`, which checks every value again before use. */
  theme?: unknown;
}

export interface PublicConfig {
  venue: PublicVenue;
  minPartySize: number;
  maxPartySize: number;
  weekdays: number[];
  leadTimeMinutes: number;
  maxAdvanceDays: number | null;
  askConsent: boolean;
  /** The venue's own privacy notice, an `https` URL or null (C64). Read through `noticeHref`, never rendered raw. */
  privacyNoticeUrl?: string | null;
  /** The public zone names, in the venue's order, or `[]` (C66). Absent from an older API. Two or more offer a choice. */
  zones?: string[];
  /** Whether a guest can join the public waitlist (ADR-0021, C68). Absent from an older API, read as false. */
  waitlistEnabled?: boolean;
  challenge: FormChallenge;
  /** Whether the venue can email a lost link. Without it the widget does not offer the resend. */
  linkResend: boolean;
}

/** One bookable time of the availability answer (C66). `zones` and `service` appear only when the venue opted in. */
export interface PublicSlot {
  time: string;
  zones?: string[];
  service?: string;
}

export interface PublicAvailability {
  times: string[];
  /** Present with two or more public zones or service names; its times are exactly `times`. */
  slots?: PublicSlot[];
  reason?: "past_date" | "beyond_horizon" | null;
}

/** The status of one date of the days route (C63). `selected` is a widget state, not an API status. */
export type DayStatus = "available" | "full" | "closed" | "outside_window";

export interface PublicDay {
  date: string;
  status: DayStatus;
  firstTime: string | null;
}

export interface PublicDays {
  from: string;
  partySize: number;
  days: PublicDay[];
}

/** The guest view (`PublicReservation`), the answer of the create and of every self-service route. */
export interface PublicReservation {
  venue: PublicVenue;
  date: string;
  time: string;
  partySize: number;
  /** The online party maximum, where the change screen stops. */
  maxPartySize: number;
  status: string;
  version: number;
  guest: { name: string; contact: string };
  commentary: string;
  consent: string;
  changeableUntil: string;
  linkExpiresAt: string;
}

/** Whether the guest may still change or cancel: `booked`, and before `changeableUntil`. */
export const isChangeable = (view: PublicReservation, now: number = Date.now()) =>
  view.status === "booked" && now < Date.parse(view.changeableUntil);

export interface Created {
  reservation: PublicReservation;
  selfServiceToken: string | null;
}

export interface BookingFields {
  date: string;
  time: string;
  partySize: number;
  name: string;
  contact: string;
  commentary: string;
  /** The hidden field. A person leaves it empty; the engine refuses any other value. */
  honeypot: string;
  /** A public zone chosen by the guest. Absent means any table. */
  zone?: string;
}

/** The fields of the public waitlist join (ADR-0021 section 3). No phone, no note, no marketing field. */
export interface WaitlistFields {
  date: string;
  partySize: number;
  name: string;
  /** One email. The engine refuses a phone. */
  email: string;
  /** Both ends as `HH:MM`, or null for any time. */
  window: { from: string; to: string } | null;
  /** The consent box. The widget sends the join only with `true`; it is never pre-ticked. */
  emailConsent: boolean;
  honeypot: string;
}

/** The guest view of a waitlist entry (`PublicWaitlistEntry`). The contact is masked. */
export interface PublicWaitlistEntry {
  venue: PublicVenue;
  date: string;
  window: { from: string; to: string } | null;
  partySize: number;
  status: "waiting" | "seated" | "cancelled";
  guest: { contact: string };
  linkExpiresAt: string;
}

export interface Joined {
  entry: PublicWaitlistEntry;
  /** Null on a repeat of the join's key, which mints no token. */
  waitlistToken: string | null;
}

/**
 * `network`: no answer arrived, so the request may or may not have reached the engine. `local`: the browser
 * could not prepare the request, such as a proof of work outside a secure context.
 */
export type Failure =
  | { kind: "network" }
  | { kind: "local" }
  | { kind: "error"; code: string; retryable: boolean };
export type Result<T> = { ok: true; value: T } | { ok: false; failure: Failure };

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

async function call<T>(fetcher: Fetch, path: string, init: RequestInit = {}): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetcher(path, {
      ...init,
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json", ...init.headers },
    });
  } catch {
    return { ok: false, failure: { kind: "network" } };
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.ok && body !== null) return { ok: true, value: body as T };
  const error = (body ?? {}) as { code?: unknown; retryable?: unknown };
  return {
    ok: false,
    failure: {
      kind: "error",
      code: typeof error.code === "string" ? error.code : "unknown",
      retryable: typeof error.retryable === "boolean" ? error.retryable : res.status >= 500 || res.status === 429,
    },
  };
}

export function publicApi(
  bookingKey: string,
  fetcher: Fetch = (input, init) => fetch(input, init),
  /** The locale the widget shows. Sent on the create so guest emails follow it (ADR-0024, C43). */
  locale?: string,
) {
  const base = `/v1/public/${encodeURIComponent(bookingKey)}`;
  return {
    config: () => call<PublicConfig>(fetcher, base),
    availability: (date: string, partySize: number, zone?: string) =>
      call<PublicAvailability>(
        fetcher,
        `${base}/availability?${new URLSearchParams({ date, partySize: String(partySize), ...(zone ? { zone } : {}) })}`,
      ),
    days: (from: string, days: number, partySize: number) =>
      call<PublicDays>(
        fetcher,
        `${base}/days?${new URLSearchParams({ from, days: String(days), partySize: String(partySize) })}`,
      ),
    create: (idempotencyKey: string, fields: BookingFields, challenge: FormChallenge, solution: string) =>
      call<Created>(fetcher, `${base}/reservations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          date: fields.date,
          time: fields.time,
          partySize: fields.partySize,
          ...(locale ? { locale } : {}),
          ...(fields.zone ? { zone: fields.zone } : {}),
          guest: { name: fields.name.trim(), contact: fields.contact.trim() },
          ...(fields.commentary.trim() ? { commentary: fields.commentary.trim() } : {}),
          honeypot: fields.honeypot,
          challenge,
          solution,
        }),
      }),
    joinWaitlist: (idempotencyKey: string, fields: WaitlistFields, challenge: FormChallenge, solution: string) =>
      call<Joined>(fetcher, `${base}/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          date: fields.date,
          partySize: fields.partySize,
          ...(fields.window ? { window: { from: fields.window.from, to: fields.window.to } } : {}),
          ...(locale ? { locale } : {}),
          guest: { name: fields.name.trim(), contact: fields.email.trim() },
          emailConsent: fields.emailConsent,
          honeypot: fields.honeypot,
          challenge,
          solution,
        }),
      }),
    resendLink: (email: string) =>
      call<{ accepted: true }>(fetcher, `${base}/self-service/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      }),
  };
}

export type PublicApi = ReturnType<typeof publicApi>;

/** The booking key from `/w/{bookingKey}`. */
export function bookingKeyFrom(pathname: string): string | null {
  const match = /^\/w\/([^/]+)\/?$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * The self-service page on the widget origin. The token rides in the fragment, which the browser never sends to a
 * server, writes to a log or puts in a `Referer`. Only the locale goes in the query.
 */
export function selfServiceUrl(origin: string, token: string, lang?: string): string {
  const url = new URL("/r", origin);
  if (lang) url.searchParams.set("lang", lang);
  url.hash = token;
  return url.href;
}

/** A self-service token as the contract writes it: `<linkId>.<secret>`. */
export type SelfServiceToken = string & { readonly __brand: "SelfServiceToken" };

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/;

export function parseToken(hash: string): SelfServiceToken | null {
  const value = hash.startsWith("#") ? hash.slice(1) : hash;
  return TOKEN.test(value) ? (value as SelfServiceToken) : null;
}

/**
 * Reads the token from the fragment once and removes the fragment from the address bar and the history entry, so
 * it is not left on screen, in a bookmark or in a screenshot. The token then lives only in memory: the widget
 * keeps nothing in browser storage (ADR-0017 section 1).
 */
export function takeToken(
  location: { hash: string; pathname: string; search: string },
  history: { replaceState(data: unknown, unused: string, url: string): void },
): SelfServiceToken | null {
  const token = parseToken(location.hash);
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  return token;
}

/** The page of a waitlist leave link, `/r/waitlist`, with the token in the fragment like a booking link's. */
export function waitlistEntryUrl(origin: string, token: string, lang?: string): string {
  const url = new URL("/r/waitlist", origin);
  if (lang) url.searchParams.set("lang", lang);
  url.hash = token;
  return url.href;
}

/** Which guest page a path is: `/r` for a booking, `/r/waitlist` for a waitlist entry, with or without a trailing slash. */
export function guestPageOf(pathname: string): "booking" | "waitlist" | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  if (path === "/r") return "booking";
  if (path === "/r/waitlist") return "waitlist";
  return null;
}

/** A waitlist token. A separate type from `SelfServiceToken`, so a booking token cannot be handed to a waitlist call. */
export type WaitlistToken = string & { readonly __brand: "WaitlistToken" };

/** Like `takeToken`, for the waitlist page. The token is the same format, and goes only to the waitlist routes. */
export function takeWaitlistToken(
  location: { hash: string; pathname: string; search: string },
  history: { replaceState(data: unknown, unused: string, url: string): void },
): WaitlistToken | null {
  return takeToken(location, history) as string | null as WaitlistToken | null;
}

/** The waitlist entry routes. The token goes only in `X-Self-Service-Token`, never in a path or a query. */
export function waitlistApi(token: WaitlistToken, fetcher: Fetch = (input, init) => fetch(input, init)) {
  const base = "/v1/public/waitlist-entry";
  const auth = { "X-Self-Service-Token": token };
  return {
    read: () => call<PublicWaitlistEntry>(fetcher, base, { headers: auth }),
    leave: (idempotencyKey: string) =>
      call<PublicWaitlistEntry>(fetcher, `${base}/leave`, {
        method: "POST",
        headers: { ...auth, "Idempotency-Key": idempotencyKey },
      }),
  };
}

export type WaitlistApi = ReturnType<typeof waitlistApi>;

export interface GuestChanges {
  partySize?: number;
  commentary?: string;
}

/** The self-service routes. The token goes only in `X-Self-Service-Token`, never in a path or a query. */
export function selfServiceApi(token: SelfServiceToken, fetcher: Fetch = (input, init) => fetch(input, init)) {
  const base = "/v1/public/self-service";
  const auth = { "X-Self-Service-Token": token };
  return {
    read: () => call<PublicReservation>(fetcher, base, { headers: auth }),
    modify: (idempotencyKey: string, version: number, changes: GuestChanges) =>
      call<PublicReservation>(fetcher, `${base}/modify`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ version, ...changes }),
      }),
    cancel: (idempotencyKey: string) =>
      call<PublicReservation>(fetcher, `${base}/cancel`, {
        method: "POST",
        headers: { ...auth, "Idempotency-Key": idempotencyKey },
      }),
  };
}

export type SelfServiceApi = ReturnType<typeof selfServiceApi>;
