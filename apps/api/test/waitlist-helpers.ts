// Shared by the public waitlist tests (ADR-0021, C68 to C78). The test file sets PUBLIC_CHALLENGE_SECRET and
// PUBLIC_POW_DIFFICULTY=0 in `vi.hoisted` and mocks `sendEmail` before this module loads the app.
import { eq, sql } from "drizzle-orm";
import app from "../src/app";
import { db } from "../src/db/client";
import { services, tables, venues, waitlist, waitlistLinks } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { challengeConfigFromEnv, issueChallenge, solve, type FormChallenge } from "../src/lib/public-challenge";
import { addDays, localDateTime } from "../src/lib/time";

export const TZ = "Europe/Madrid";
export const today = () => localDateTime(new Date(), TZ).date;
export const ahead = (days: number) => addDays(today(), days);
export const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/;

const challengeConfig = challengeConfigFromEnv();

export interface Venue {
  id: string;
  name: string;
  key: string;
  admin: string;
  write: string;
  read: string;
}

export const MAILING = { notificationsEnabled: true, resendApiKey: "re_test", fromEmail: "venue@example.com" } as const;

let venueCount = 0;
let contactCount = 0;

export const nextContact = (tag = "wl") => `${tag}.guest${++contactCount}@example.com`;

export interface VenueOptions {
  venue?: Partial<typeof venues.$inferInsert>;
  settings?: Record<string, unknown>;
  services?: { name: string; openStart: string; openEnd: string }[];
  tables?: number;
  prefix?: string;
}

/** A venue with email on, a dinner service every day, seven tables of four and the waitlist on. */
export async function makeVenue(options: VenueOptions = {}): Promise<Venue> {
  venueCount += 1;
  const id = `${options.prefix ?? "wl"}-${venueCount}`;
  const name = `Casa Espera ${venueCount}`;
  await db.insert(venues).values({ id, name, timezone: TZ, ...MAILING, ...options.venue });
  for (const s of options.services ?? [{ name: "dinner", openStart: "20:00", openEnd: "23:00" }]) {
    await db.insert(services).values({ venueId: id, ...s });
  }
  const count = options.tables ?? 7;
  if (count > 0) {
    await db.insert(tables).values(Array.from({ length: count }, (_, i) => ({ id: `${id}-t${i}`, venueId: id, name: `T${i}`, seats: 4 })));
  }
  const keys = { admin: `${id}-admin`, write: `${id}-write`, read: `${id}-read` };
  await addKey(db, keys.admin, `admin-${id}`, [id], "admin");
  await addKey(db, keys.write, `write-${id}`, [id], "write");
  await addKey(db, keys.read, `read-${id}`, [id], "read");
  const email = (options.venue?.notificationsEnabled ?? MAILING.notificationsEnabled) === true;
  const res = await putOnline(id, keys.admin, {
    enabled: true,
    maxOpenBookingsPerContact: null,
    ...(email ? { waitlistEnabled: true } : {}),
    ...options.settings,
  });
  if (res.status !== 200) throw new Error(`enable failed: ${await res.text()}`);
  return { id, name, key: (await res.json()).bookingKey, ...keys };
}

export function putOnline(venueId: string, apikey: string, body: unknown) {
  return app.request(`/v1/venues/${venueId}/online-booking`, {
    method: "PUT",
    headers: { apikey, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const challengeFor = (bookingKey: string, at = Date.now() - 10_000): FormChallenge =>
  issueChallenge(challengeConfig, bookingKey, at);

/** A valid join body for the venue: a fresh contact, ten days ahead, a party of two. */
export function joinBody(v: Venue, over: Record<string, unknown> = {}) {
  const challenge = challengeFor(v.key);
  return {
    date: ahead(10),
    partySize: 2,
    guest: { name: "Ana", contact: nextContact() },
    emailConsent: true,
    challenge,
    solution: solve(challenge),
    ...over,
  };
}

export function join(bookingKey: string, body: unknown, key: string | null = crypto.randomUUID(), headers: Record<string, string> = {}) {
  return app.request(`/v1/public/${bookingKey}/waitlist`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key === null ? {} : { "Idempotency-Key": key }), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Joins and expects 200. Returns the answer, the key, the body and the entry's id. */
export async function joined(v: Venue, over: Record<string, unknown> = {}, key = crypto.randomUUID()) {
  const body = joinBody(v, over);
  const res = await join(v.key, body, key);
  if (res.status !== 200) throw new Error(`join failed: ${res.status} ${await res.text()}`);
  const answer = await res.json();
  return { answer, token: answer.waitlistToken as string, key, body, entryId: await entryOf(answer.waitlistToken) };
}

export async function entryOf(token: string): Promise<string> {
  const [link] = await db.select({ entryId: waitlistLinks.entryId }).from(waitlistLinks).where(eq(waitlistLinks.id, token.split(".")[0]!));
  return link!.entryId;
}

export const readEntry = (token: string | null, headers: Record<string, string> = {}) =>
  app.request("/v1/public/waitlist-entry", { headers: { ...(token === null ? {} : { "X-Self-Service-Token": token }), ...headers } });

export const leave = (token: string | null, key: string | null = crypto.randomUUID(), headers: Record<string, string> = {}) =>
  app.request("/v1/public/waitlist-entry/leave", {
    method: "POST",
    headers: {
      ...(token === null ? {} : { "X-Self-Service-Token": token }),
      ...(key === null ? {} : { "Idempotency-Key": key }),
      ...headers,
    },
  });

export function staff(v: Venue, method: string, path: string, body?: unknown, key: string | null = crypto.randomUUID(), apikey = v.admin) {
  return app.request(`/v1/venues/${v.id}${path}`, {
    method,
    headers: {
      apikey,
      "content-type": "application/json",
      ...(key === null ? {} : { "Idempotency-Key": key }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export async function staffList(v: Venue, date?: string, apikey = v.admin) {
  const res = await staff(v, "GET", `/waitlist${date === undefined ? "" : `?date=${date}`}`, undefined, null, apikey);
  return { status: res.status, body: await res.json() };
}

export async function snapshot(res: Response) {
  return { status: res.status, body: await res.text(), headers: [...res.headers.entries()].filter(([name]) => name !== "date") };
}

export async function entriesOf(venueId: string) {
  return db.select().from(waitlist).where(eq(waitlist.venueId, venueId));
}

export async function countRows(table: string, venueId: string): Promise<number> {
  const rows = await db.execute(sql.raw(`select count(*)::int as n from ${table} where venue_id = '${venueId}'`));
  return (rows.rows[0] as { n: number }).n;
}

export { app, db };
