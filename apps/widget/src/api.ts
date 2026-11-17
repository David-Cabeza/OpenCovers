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
}

export interface PublicConfig {
  venue: PublicVenue;
  minPartySize: number;
  maxPartySize: number;
  weekdays: number[];
  leadTimeMinutes: number;
  maxAdvanceDays: number | null;
  askConsent: boolean;
  challenge: FormChallenge;
}

/** The guest view (`PublicReservation`), the answer of the create and of every self-service route. */
export interface PublicReservation {
  venue: PublicVenue;
  date: string;
  time: string;
  partySize: number;
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

export function publicApi(bookingKey: string, fetcher: Fetch = (input, init) => fetch(input, init)) {
  const base = `/v1/public/${encodeURIComponent(bookingKey)}`;
  return {
    config: () => call<PublicConfig>(fetcher, base),
    availability: (date: string, partySize: number) =>
      call<{ times: string[] }>(
        fetcher,
        `${base}/availability?${new URLSearchParams({ date, partySize: String(partySize) })}`,
      ),
    create: (idempotencyKey: string, fields: BookingFields, challenge: FormChallenge, solution: string) =>
      call<Created>(fetcher, `${base}/reservations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          date: fields.date,
          time: fields.time,
          partySize: fields.partySize,
          guest: { name: fields.name.trim(), contact: fields.contact.trim() },
          ...(fields.commentary.trim() ? { commentary: fields.commentary.trim() } : {}),
          honeypot: fields.honeypot,
          challenge,
          solution,
        }),
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
