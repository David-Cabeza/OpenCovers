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

export interface PublicReservation {
  venue: PublicVenue;
  date: string;
  time: string;
  partySize: number;
  status: string;
  guest: { name: string; contact: string };
  commentary: string;
}

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

/** The self-service page of stage 6. The token rides in the fragment, which is never sent to a server. */
export const selfServiceUrl = (origin: string, token: string) => `${origin}/r#${token}`;
