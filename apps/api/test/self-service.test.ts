import { timingSafeEqual } from "node:crypto";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => {
  process.env.PUBLIC_CHALLENGE_SECRET = "test-secret-for-the-self-service-link";
  process.env.PUBLIC_POW_DIFFICULTY = "0";
  return [] as { to: string; subject: string; text: string }[];
});

vi.mock("../src/lib/mailer", async (original) => ({
  ...(await original<typeof import("../src/lib/mailer")>()),
  sendEmail: async (_key: string, _from: string, to: string, subject: string, text: string) => {
    sent.push({ to, subject, text });
  },
}));

import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { events, reservations, selfServiceLinks, sentEmails, services, tableAllocations, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { auth } from "../src/lib/auth";
import { challengeConfigFromEnv, issueChallenge, solve } from "../src/lib/public-challenge";
import { runRetention } from "../src/lib/retention";
import { findLink } from "../src/lib/self-service";
import { toTimestamp } from "../src/lib/time";
import { saturdayAhead } from "./dates";

const SATURDAY = saturdayAhead();
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/;
const config = challengeConfigFromEnv();
const LINK_INVALID = JSON.stringify({
  code: "self_service_link_invalid",
  message: "self_service_link_invalid",
  retryable: false,
});

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE events, tombstones, idempotency_keys, table_allocations, reservations, guests, guest_blocklist, grants, api_keys, services, tables, venue_online_booking, venues RESTART IDENTITY CASCADE`,
  );
});

interface Venue {
  id: string;
  admin: string;
  writer: string;
  reader: string;
  key: string;
}

let venueCount = 0;
async function makeVenue(
  opts: { seats?: number[]; venue?: Partial<typeof venues.$inferInsert>; settings?: Record<string, unknown> } = {},
): Promise<Venue> {
  venueCount += 1;
  const id = `ss-${venueCount}`;
  await db.insert(venues).values({ id, name: `Casa ${venueCount}`, timezone: "Europe/Madrid", ...opts.venue });
  await db.insert(services).values({ venueId: id, name: "dinner", openStart: "20:00", openEnd: "23:00" });
  const seats = opts.seats ?? [4];
  await db.insert(tables).values(seats.map((s, i) => ({ id: `${id}-t${i}`, venueId: id, name: `T${i}`, seats: s })));
  const v = { id, admin: `${id}-admin`, writer: `${id}-writer`, reader: `${id}-reader` };
  await addKey(db, v.admin, `admin-${id}`, [id], "admin");
  await addKey(db, v.writer, `writer-${id}`, [id], "write");
  await addKey(db, v.reader, `reader-${id}`, [id], "read");
  const res = await app.request(`/v1/venues/${id}/online-booking`, {
    method: "PUT",
    headers: { apikey: v.admin, "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, ...opts.settings }),
  });
  if (res.status !== 200) throw new Error(`enable failed: ${await res.text()}`);
  return { ...v, key: (await res.json()).bookingKey };
}

let contacts = 0;

function createBody(bookingKey: string, overrides: Record<string, unknown> = {}) {
  const challenge = issueChallenge(config, bookingKey, Date.now() - 10_000);
  return {
    date: SATURDAY,
    time: "20:00",
    partySize: 2,
    guest: { name: "Ana García", contact: `guest${++contacts}@example.com` },
    challenge,
    solution: solve(challenge),
    ...overrides,
  };
}

function publicCreate(bookingKey: string, payload: unknown, key: string = crypto.randomUUID()) {
  return app.request(`/v1/public/${bookingKey}/reservations`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(payload),
  });
}

interface Booking {
  id: string;
  token: string;
  createKey: string;
}

async function book(v: Venue, overrides: Record<string, unknown> = {}): Promise<Booking> {
  const createKey = crypto.randomUUID();
  const res = await publicCreate(v.key, createBody(v.key, overrides), createKey);
  if (res.status !== 200) throw new Error(`create failed: ${await res.text()}`);
  const { selfServiceToken } = await res.json();
  const link = await findLink(db, selfServiceToken);
  return { id: link!.reservationId, token: selfServiceToken, createKey };
}

const read = (token?: string, headers: Record<string, string> = {}) =>
  app.request("/v1/public/self-service", { headers: { ...(token ? { "X-Self-Service-Token": token } : {}), ...headers } });

function modify(token: string | undefined, payload: unknown, key: string = crypto.randomUUID(), headers: Record<string, string> = {}) {
  return app.request("/v1/public/self-service/modify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": key,
      ...(token ? { "X-Self-Service-Token": token } : {}),
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

function cancel(token: string | undefined, key: string = crypto.randomUUID(), headers: Record<string, string> = {}) {
  return app.request("/v1/public/self-service/cancel", {
    method: "POST",
    headers: { "Idempotency-Key": key, ...(token ? { "X-Self-Service-Token": token } : {}), ...headers },
  });
}

function staff(v: Venue, path: string, payload: unknown, apikey = v.admin, key: string = crypto.randomUUID()) {
  return app.request(`/v1/venues/${v.id}${path}`, {
    method: "POST",
    headers: { apikey, "content-type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(payload),
  });
}

const reissue = (v: Venue, id: string, apikey = v.writer, key: string = crypto.randomUUID()) =>
  staff(v, `/reservations/${id}/self-service-link`, {}, apikey, key);

async function row(id: string) {
  return (await db.select().from(reservations).where(eq(reservations.id, id)))[0];
}

async function eventCount(id: string) {
  const [e] = await db.select({ n: count() }).from(events).where(eq(events.reservationId, id));
  return e.n;
}

async function linkRows(id: string) {
  return db.select().from(selfServiceLinks).where(eq(selfServiceLinks.reservationId, id));
}

async function startIn(id: string, minutes: number) {
  const startsAt = new Date(Date.now() + minutes * 60_000);
  await db
    .update(reservations)
    .set({ startsAt, endsAt: new Date(startsAt.getTime() + 120 * 60_000) })
    .where(eq(reservations.id, id));
}

async function expectLinkInvalid(res: Response) {
  expect(res.status).toBe(404);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.text()).toBe(LINK_INVALID);
}

const headerList = (res: Response) => [...res.headers.entries()].sort();

async function staffSessionCookie(): Promise<string> {
  const res = await auth.api.signUpEmail({
    body: { name: "Staff", email: `ss-staff-${Math.random().toString(36).slice(2)}@example.com`, password: "password123" },
    asResponse: true,
  });
  return res.headers.get("set-cookie") as string;
}

async function allTableText(): Promise<string> {
  const names = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  const parts: string[] = [];
  for (const { table_name } of names.rows) {
    const rows = await db.execute(sql.raw(`select row_to_json(t)::text as j from "${table_name}" t`));
    for (const r of rows.rows as { j: string }[]) parts.push(r.j);
  }
  return parts.join("\n");
}

describe("C47 self-service token", () => {
  it("mints a token of a lower-case UUID and 43 base64url characters, stored only as a hash", async () => {
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    const v = await makeVenue({ seats: [4, 4] });
    const a = await book(v);
    const b = await book(v);
    expect(a.token).toMatch(TOKEN);
    const [linkId, secret] = a.token.split(".");
    expect(linkId).not.toBe(b.token.split(".")[0]);
    expect(secret).not.toBe(b.token.split(".")[1]);
    const [link] = await linkRows(a.id);
    expect(link).toMatchObject({ id: linkId, venueId: v.id, reservationId: a.id, revokedAt: null });
    expect(link.secretHash).toMatch(/^[0-9a-f]{64}$/);
    await read(a.token);
    await modify(a.token, { version: 1, commentary: "terrace" });
    await read("00000000-0000-0000-0000-000000000000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    await read(`${linkId}.${"A".repeat(43)}`);
    await reissue(v, b.id);
    await cancel(a.token);
    const logged = [log, warn, error].flatMap((spy) => spy.mock.calls.map((call) => call.map(String).join(" ")));
    for (const spy of [log, warn, error]) spy.mockRestore();
    for (const t of [a.token, secret]) expect(logged.join("\n")).not.toContain(t);
    const text = await allTableText();
    for (const t of [a.token, b.token, secret, b.token.split(".")[1]]) expect(text).not.toContain(t);
  });

  it("answers every token that does not work with the same 404 on read, modify and cancel", async () => {
    const v = await makeVenue({ seats: [4, 4, 4, 4] });
    const live = await book(v);
    const expired = await book(v);
    await db.update(selfServiceLinks).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(selfServiceLinks.reservationId, expired.id));
    const revoked = await book(v);
    await reissue(v, revoked.id);
    const erased = await book(v);
    const erasedRow = await row(erased.id);
    await staff(v, "/erasure", { guestId: erasedRow.guestId });
    const [linkId] = live.token.split(".");
    const tokens: (string | undefined)[] = [
      undefined,
      "not-a-token",
      `${linkId.toUpperCase()}.${live.token.split(".")[1]}`,
      `${crypto.randomUUID()}.${live.token.split(".")[1]}`,
      `${linkId}.${"B".repeat(43)}`,
      expired.token,
      revoked.token,
      erased.token,
    ];
    const answers: Response[] = [];
    for (const token of tokens) {
      answers.push(await read(token), await modify(token, { version: 1, commentary: "x" }), await cancel(token));
    }
    for (const res of answers) await expectLinkInvalid(res);
    const reference = headerList(answers[0]);
    for (const res of answers) expect(headerList(res)).toEqual(reference);
    expect((await read(live.token)).status).toBe(200);
    expect((await row(live.id)).version).toBe(1);
  });

  it("compares a hash once whether or not the link id exists", async () => {
    const v = await makeVenue();
    const a = await book(v);
    let compares = 0;
    const counting = (x: Buffer, y: Buffer) => {
      compares += 1;
      return timingSafeEqual(x, y);
    };
    expect(await findLink(db, `${crypto.randomUUID()}.${"C".repeat(43)}`, counting)).toBeNull();
    expect(compares).toBe(1);
    expect(await findLink(db, `${a.token.split(".")[0]}.${"C".repeat(43)}`, counting)).toBeNull();
    expect(compares).toBe(2);
    expect(await findLink(db, a.token, counting)).not.toBeNull();
    expect(compares).toBe(3);
  });

  it("expires 48 hours after the booking ends, by the database clock", async () => {
    const v = await makeVenue();
    const a = await book(v);
    const r = await row(a.id);
    const [link] = await linkRows(a.id);
    expect(link.expiresAt.getTime()).toBe(r.endsAt.getTime() + 48 * 3_600_000);
    await db.update(selfServiceLinks).set({ expiresAt: sql`now() + interval '2 seconds'` }).where(eq(selfServiceLinks.id, link.id));
    expect((await read(a.token)).status).toBe(200);
    await db.update(selfServiceLinks).set({ expiresAt: sql`now() - interval '1 millisecond'` }).where(eq(selfServiceLinks.id, link.id));
    await expectLinkInvalid(await read(a.token));
  });

  it("keeps at most one live link per reservation", async () => {
    const v = await makeVenue();
    const a = await book(v);
    await reissue(v, a.id);
    await publicCreate(v.key, createBody(v.key), a.createKey);
    await reissue(v, a.id);
    const rows = await linkRows(a.id);
    expect(rows).toHaveLength(4);
    expect(rows.filter((l) => l.revokedAt === null)).toHaveLength(1);
    await expect(
      db.insert(selfServiceLinks).values({ id: crypto.randomUUID(), venueId: v.id, reservationId: a.id, secretHash: "0".repeat(64), expiresAt: new Date() }),
    ).rejects.toThrow();
  });

  it("names exactly one booking, so a token never reaches another booking or venue", async () => {
    const v = await makeVenue({ seats: [4, 4] });
    const w = await makeVenue();
    const a = await book(v);
    const b = await book(v, { time: "20:15" });
    const c = await book(w);
    expect((await (await read(a.token)).json()).time).toBe("20:00");
    expect((await (await read(b.token)).json()).time).toBe("20:15");
    expect((await (await read(c.token)).json()).venue.name).toBe(`Casa ${venueCount}`);
    expect((await modify(a.token, { version: 1, partySize: 3 })).status).toBe(200);
    expect((await row(b.id)).partySize).toBe(2);
    expect((await row(c.id)).partySize).toBe(2);
  });
});

describe("C48 self-service read and the guest view", () => {
  it("returns the guest view and nothing else, and changes nothing", async () => {
    const v = await makeVenue({ venue: { publicPhone: "+34 600 000 000" }, settings: { selfServiceCutoffMinutes: 60 } });
    const a = await book(v, { guest: { name: "Ana García", contact: "ana.garcia@example.com" }, commentary: "window" });
    const res = await read(a.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const view = await res.json();
    const start = toTimestamp(SATURDAY, "20:00", "Europe/Madrid").getTime();
    expect(view).toEqual({
      venue: { name: `Casa ${venueCount}`, locale: "es", theme: {}, phone: "+34 600 000 000", address: null },
      date: SATURDAY,
      time: "20:00",
      partySize: 2,
      maxPartySize: 8,
      status: "booked",
      version: 1,
      guest: { name: "Ana García", contact: "a***@example.com" },
      commentary: "window",
      consent: "unknown",
      changeableUntil: new Date(start - 60 * 60_000).toISOString(),
      linkExpiresAt: new Date(start + 120 * 60_000 + 48 * 3_600_000).toISOString(),
    });
    const text = JSON.stringify(view);
    for (const leak of [a.id, v.id, "t0", "dinner", "widget", "ana.garcia"]) expect(text).not.toContain(leak);
    expect(await eventCount(a.id)).toBe(1);
    expect(await linkRows(a.id)).toHaveLength(1);
  });

  it("shows the public profile's address in the guest view only while the profile is on (C64)", async () => {
    const profile = { publicStreet: "Calle Mayor 1", publicPostalCode: "28013", publicLocality: "Madrid", publicRegion: "Madrid", noticeAddress: "owner@example.com" };
    const v = await makeVenue({ venue: { ...profile, publicProfileEnabled: true } });
    const off = await makeVenue({ venue: { ...profile, publicProfileEnabled: false } });
    const a = await book(v);
    const b = await book(off);
    expect((await (await read(a.token)).json()).venue.address).toBe("Calle Mayor 1, 28013 Madrid");
    expect((await (await read(b.token)).json()).venue.address).toBeNull();
    await db.update(venues).set({ publicProfileEnabled: false }).where(eq(venues.id, v.id));
    await db.update(venues).set({ publicStreet: "Plaza Nueva 2", publicProfileEnabled: true }).where(eq(venues.id, off.id));
    const first = await (await read(a.token)).json();
    const second = await (await read(b.token)).json();
    expect(first.venue.address).toBeNull();
    expect(second.venue.address).toBe("Plaza Nueva 2, 28013 Madrid");
    expect(JSON.stringify([first, second])).not.toContain("owner@example.com");
  });

  it("masks a phone to its last two digits", async () => {
    const v = await makeVenue();
    const a = await book(v, { guest: { name: "Luis", contact: "+34600123456" } });
    expect((await (await read(a.token)).json()).guest.contact).toBe("***56");
  });

  it("follows staff changes, a staff cancel and the start time, while online booking is off or the key rotated", async () => {
    const v = await makeVenue({ seats: [4, 4] });
    const a = await book(v);
    await staff(v, `/reservations/${a.id}/modify`, { partySize: 3 });
    expect(await (await read(a.token)).json()).toMatchObject({ partySize: 3, version: 2 });
    await app.request(`/v1/venues/${v.id}/online-booking`, {
      method: "PUT",
      headers: { apikey: v.admin, "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    await app.request(`/v1/venues/${v.id}/online-booking/rotate-key`, { method: "POST", headers: { apikey: v.admin } });
    expect((await modify(a.token, { version: 2, commentary: "late" })).status).toBe(200);
    await staff(v, `/reservations/${a.id}/cancel`, {});
    expect(await (await read(a.token)).json()).toMatchObject({ status: "cancelled", version: 4 });
    await startIn(a.id, -30);
    expect((await read(a.token)).status).toBe(200);
  });

  it("gives the same answer with a staff cookie or an API key as without", async () => {
    const v = await makeVenue();
    const a = await book(v);
    const cookie = await staffSessionCookie();
    const plain = await read(a.token);
    const withCreds = await read(a.token, { cookie, apikey: v.admin });
    expect(withCreds.status).toBe(plain.status);
    expect(await withCreds.text()).toBe(await plain.text());
    expect(withCreds.headers.get("set-cookie")).toBeNull();
    const m = await modify(a.token, { version: 1, commentary: "x" }, crypto.randomUUID(), { cookie, apikey: v.admin });
    expect(m.status).toBe(200);
    expect(m.headers.get("set-cookie")).toBeNull();
    const c = await cancel(a.token, crypto.randomUUID(), { cookie, apikey: v.admin });
    expect(c.status).toBe(200);
    expect(c.headers.get("set-cookie")).toBeNull();
    await expectLinkInvalid(await read("bad", { cookie, apikey: v.admin }));
  });
});

describe("C49 guest modify", () => {
  it("changes the party, note and consent, bumps the version once and keeps the link and attribution", async () => {
    const v = await makeVenue({ settings: { askConsent: true } });
    const a = await book(v);
    const res = await modify(a.token, { version: 1, partySize: 3, commentary: "  terrace ", guest: { consent: "granted" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ partySize: 3, commentary: "terrace", consent: "granted", version: 2 });
    const r = await row(a.id);
    expect(r).toMatchObject({ bookedVia: "widget", ownerPrincipal: "widget", basis: "service", version: 2 });
    expect(r.consentRecordedAt).not.toBeNull();
    const types = await db.select({ type: events.type, version: events.version }).from(events).where(eq(events.reservationId, a.id));
    expect(types).toEqual([
      { type: "created", version: 1 },
      { type: "modified", version: 2 },
    ]);
    expect((await read(a.token)).status).toBe(200);
    expect(await linkRows(a.id)).toHaveLength(1);
  });

  it("changes nothing when the values are the stored ones", async () => {
    const v = await makeVenue();
    const a = await book(v, { commentary: "window" });
    const res = await modify(a.token, { version: 1, partySize: 2, commentary: "window" });
    expect(res.status).toBe(200);
    expect((await res.json()).version).toBe(1);
    expect(await eventCount(a.id)).toBe(1);
  });

  it("refuses date, time, tables, zone, rating, reconfirmation, a version alone and bad values", async () => {
    const v = await makeVenue();
    const a = await book(v);
    const bodies = [
      { version: 1, date: SATURDAY },
      { version: 1, time: "21:00" },
      { version: 1, tables: [] },
      { version: 1, zone: "x" },
      { version: 1, rating: 5 },
      { version: 1, reconfirmation: "confirmed" },
      { version: 1 },
      { partySize: 3 },
      { version: 0, partySize: 3 },
      { version: 1, partySize: 0 },
      { version: 1, partySize: 2.5 },
      { version: 1, commentary: "x".repeat(501) },
      { version: 1, guest: { consent: "denied" } },
      { version: 1, guest: { name: "Eve" } },
      "not json",
    ];
    for (const b of bodies) {
      const res = await modify(a.token, b);
      expect(res.status, JSON.stringify(b)).toBe(400);
      expect((await res.json()).code).toBe("invalid_request");
    }
    expect((await row(a.id)).version).toBe(1);
  });

  it("runs the checks in the contract's order", async () => {
    const v = await makeVenue({ seats: [4, 6], settings: { maxPartySize: 6 } });
    const a = await book(v);
    expect((await (await modify("bad", { version: 1 }, "not-a-uuid")).json()).code).toBe("invalid_request");
    await expectLinkInvalid(await modify("bad", { version: 9, partySize: 99 }));
    const key = crypto.randomUUID();
    expect((await modify(a.token, { version: 1, partySize: 3 }, key)).status).toBe(200);
    await staff(v, `/reservations/${a.id}/modify`, { commentary: "staff" });
    await startIn(a.id, 30);
    const replay = await modify(a.token, { version: 1, partySize: 3 }, key);
    expect(replay.status).toBe(200);
    expect((await replay.json()).version).toBe(3);
    expect((await (await modify(a.token, { version: 1, partySize: 99 })).json()).code).toBe("self_service_closed");
    await startIn(a.id, 600);
    expect((await (await modify(a.token, { version: 1, partySize: 99 })).json()).code).toBe("reservation_changed");
    expect((await (await modify(a.token, { version: 3, partySize: 7 })).json()).code).toBe("party_size_too_large");
    expect((await row(a.id)).version).toBe(3);
  });

  it("refuses a stale version after a staff change, and passes after reading again", async () => {
    const v = await makeVenue({ seats: [4, 4] });
    const a = await book(v);
    await staff(v, `/reservations/${a.id}/modify`, { partySize: 3 });
    const stale = await modify(a.token, { version: 1, partySize: 4 });
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("reservation_changed");
    expect(await row(a.id)).toMatchObject({ partySize: 3, version: 2 });
    const { version } = await (await read(a.token)).json();
    expect((await modify(a.token, { version, partySize: 4 })).status).toBe(200);
  });

  it("closes at the cutoff, and a cutoff of 0 allows changes until the start", async () => {
    const v = await makeVenue();
    const a = await book(v);
    await startIn(a.id, 121);
    expect((await modify(a.token, { version: 1, commentary: "a" })).status).toBe(200);
    await startIn(a.id, 119);
    const closed = await modify(a.token, { version: 2, commentary: "b" });
    expect(closed.status).toBe(409);
    expect((await closed.json()).code).toBe("self_service_closed");
    const w = await makeVenue({ settings: { selfServiceCutoffMinutes: 0 } });
    const b = await book(w);
    await startIn(b.id, 1);
    expect((await modify(b.token, { version: 1, commentary: "a" })).status).toBe(200);
    await startIn(b.id, -1);
    expect((await (await modify(b.token, { version: 2, commentary: "b" })).json()).code).toBe("self_service_closed");
  });

  it("closes a seated, attended, no-show or cancelled booking", async () => {
    const v = await makeVenue({ seats: [4, 4, 4, 4] });
    const seated = await book(v);
    await staff(v, `/reservations/${seated.id}/status`, { status: "seated" });
    const attended = await book(v);
    await staff(v, `/reservations/${attended.id}/status`, { status: "seated" });
    await staff(v, `/reservations/${attended.id}/status`, { status: "attended" });
    const noShow = await book(v);
    await staff(v, `/reservations/${noShow.id}/status`, { status: "no_show" });
    const cancelled = await book(v);
    await staff(v, `/reservations/${cancelled.id}/cancel`, {});
    for (const b of [seated, attended, noShow, cancelled]) {
      const { version } = await (await read(b.token)).json();
      const res = await modify(b.token, { version, commentary: "x" });
      expect((await res.json()).code).toBe("self_service_closed");
    }
  });

  it("moves to a free table for a larger party, or fails with no_suitable_table and keeps the old one", async () => {
    const v = await makeVenue({ seats: [2, 4], venue: { overbookingCeiling: 20 } });
    const a = await book(v);
    const allocated = async (id: string) =>
      (await db.select({ t: tableAllocations.tableId }).from(tableAllocations).where(eq(tableAllocations.reservationId, id))).map((r) => r.t);
    expect(await allocated(a.id)).toEqual([`${v.id}-t0`]);
    expect((await modify(a.token, { version: 1, partySize: 4 })).status).toBe(200);
    expect(await allocated(a.id)).toEqual([`${v.id}-t1`]);
    expect((await modify(a.token, { version: 2, partySize: 2 })).status).toBe(200);
    expect(await allocated(a.id)).toEqual([`${v.id}-t1`]);
    const other = await book(v);
    expect(await allocated(other.id)).toEqual([`${v.id}-t0`]);
    const taken = await modify(other.token, { version: 1, partySize: 4 });
    expect(taken.status).toBe(409);
    expect((await taken.json()).code).toBe("no_suitable_table");
    expect(await allocated(other.id)).toEqual([`${v.id}-t0`]);
    expect((await row(other.id)).partySize).toBe(2);
  });

  it("holds the party to the narrower of the online and service limits", async () => {
    const v = await makeVenue({ seats: [10], settings: { minPartySize: 2, maxPartySize: 6 } });
    await db.update(services).set({ maxPartySize: 5 }).where(eq(services.venueId, v.id));
    const a = await book(v);
    expect((await (await modify(a.token, { version: 1, partySize: 1 })).json()).code).toBe("party_size_too_small");
    expect((await (await modify(a.token, { version: 1, partySize: 6 })).json()).code).toBe("party_size_too_large");
    expect((await modify(a.token, { version: 1, partySize: 5 })).status).toBe(200);
  });

  it("replays a repeat of the key, and refuses a key of another kind", async () => {
    const v = await makeVenue({ seats: [4, 4] });
    const a = await book(v);
    const key = crypto.randomUUID();
    const first = await (await modify(a.token, { version: 1, partySize: 3 }, key)).json();
    const again = await (await modify(a.token, { version: 1, partySize: 3 }, key)).json();
    expect(again).toEqual(first);
    expect(await eventCount(a.id)).toBe(2);
    const createKeyReuse = await modify(a.token, { version: 2, partySize: 4 }, a.createKey);
    expect((await createKeyReuse.json()).code).toBe("invalid_request");
    expect((await (await modify(a.token, { version: 2, partySize: 4 }, v.key)).json()).code).toBe("invalid_request");
    expect((await row(a.id)).version).toBe(2);
  });

  it("serializes a concurrent modify and cancel", async () => {
    for (let i = 0; i < 5; i++) {
      const v = await makeVenue({ seats: [4, 4] });
      const a = await book(v);
      const [m, c] = await Promise.all([modify(a.token, { version: 1, partySize: 3 }), cancel(a.token)]);
      expect(c.status).toBe(200);
      const r = await row(a.id);
      expect(r.status).toBe("cancelled");
      if (m.status === 200) {
        expect(r.version).toBe(3);
        expect(r.partySize).toBe(3);
      } else {
        expect(m.status).toBe(404);
        expect(r.version).toBe(2);
        expect(r.partySize).toBe(2);
      }
      expect(await eventCount(a.id)).toBe(r.version);
      const free = await db.select().from(tableAllocations).where(eq(tableAllocations.reservationId, a.id));
      expect(free).toHaveLength(0);
    }
  });
});

describe("C50 guest cancel and revocation", () => {
  it("cancels, frees the table, revokes the link, and answers only a repeat of that cancel", async () => {
    const v = await makeVenue();
    const a = await book(v);
    const key = crypto.randomUUID();
    const res = await cancel(a.token, key);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const view = await res.json();
    expect(view).toMatchObject({ status: "cancelled", version: 2 });
    expect(view).not.toHaveProperty("selfServiceToken");
    expect(await db.select().from(tableAllocations).where(eq(tableAllocations.reservationId, a.id))).toHaveLength(0);
    expect(await eventCount(a.id)).toBe(2);
    const links = await linkRows(a.id);
    expect(links).toHaveLength(1);
    expect(links[0].revokedAt).not.toBeNull();
    await expectLinkInvalid(await read(a.token));
    await expectLinkInvalid(await modify(a.token, { version: 2, commentary: "x" }));
    await expectLinkInvalid(await cancel(a.token));
    const replay = await cancel(a.token, key);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(view);
    expect(await eventCount(a.id)).toBe(2);
    await db.update(selfServiceLinks).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(selfServiceLinks.reservationId, a.id));
    await expectLinkInvalid(await cancel(a.token, key));
  });

  it("refuses within the cutoff or after a staff cancel, changing nothing, and a staff cancel keeps the link", async () => {
    const v = await makeVenue({ seats: [4, 4] });
    const a = await book(v);
    await startIn(a.id, 60);
    const closed = await cancel(a.token);
    expect(closed.status).toBe(409);
    expect((await closed.json()).code).toBe("self_service_closed");
    expect(await row(a.id)).toMatchObject({ status: "booked", version: 1 });
    expect((await linkRows(a.id))[0].revokedAt).toBeNull();
    const b = await book(v);
    await staff(v, `/reservations/${b.id}/cancel`, {});
    expect((await (await read(b.token)).json()).status).toBe("cancelled");
    expect((await (await cancel(b.token)).json()).code).toBe("self_service_closed");
    expect((await (await modify(b.token, { version: 2, commentary: "x" })).json()).code).toBe("self_service_closed");
    expect((await read(b.token)).status).toBe(200);
  });

  it("gives a guest who books again a new reservation with its own token", async () => {
    const v = await makeVenue();
    const a = await book(v, { guest: { name: "Ana", contact: "again@example.com" } });
    await cancel(a.token);
    const b = await book(v, { guest: { name: "Ana", contact: "again@example.com" } });
    expect(b.id).not.toBe(a.id);
    expect(b.token).not.toBe(a.token);
    expect((await read(b.token)).status).toBe(200);
  });

  it("refuses a create key reused for a cancel, and a booking key as the idempotency key", async () => {
    const v = await makeVenue();
    const a = await book(v);
    expect((await (await cancel(a.token, a.createKey)).json()).code).toBe("invalid_request");
    expect((await (await cancel(a.token, v.key)).json()).code).toBe("invalid_request");
    expect((await (await cancel(a.token, "")).json()).code).toBe("invalid_request");
    expect(await row(a.id)).toMatchObject({ status: "booked", version: 1 });
    expect((await linkRows(a.id))[0].revokedAt).toBeNull();
  });
});

describe("C51 link rotation by replay and staff reissue", () => {
  it("rotates on a repeat of the public create, and returns null for a booking no longer booked", async () => {
    const v = await makeVenue();
    const payload = createBody(v.key);
    const key = crypto.randomUUID();
    const first = await (await publicCreate(v.key, payload, key)).json();
    const second = await (await publicCreate(v.key, payload, key)).json();
    expect(second.selfServiceToken).toMatch(TOKEN);
    expect(second.selfServiceToken).not.toBe(first.selfServiceToken);
    await expectLinkInvalid(await read(first.selfServiceToken));
    expect((await read(second.selfServiceToken)).status).toBe(200);
    const id = (await findLink(db, second.selfServiceToken))!.reservationId;
    const [n] = await db.select({ n: count() }).from(reservations).where(eq(reservations.venueId, v.id));
    expect(n.n).toBe(1);
    await staff(v, `/reservations/${id}/cancel`, {});
    const third = await (await publicCreate(v.key, payload, key)).json();
    expect(third.selfServiceToken).toBeNull();
    expect(third.reservation.status).toBe("cancelled");
    expect((await read(second.selfServiceToken)).status).toBe(200);
  });

  it("reissues a link for the write and admin roles, once per call, with no version or event", async () => {
    const v = await makeVenue();
    const a = await book(v);
    const key = crypto.randomUUID();
    const res = await reissue(v, a.id, v.writer, key);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const issued = await res.json();
    expect(Object.keys(issued).sort()).toEqual(["linkExpiresAt", "selfServiceToken"]);
    expect(issued.selfServiceToken).toMatch(TOKEN);
    expect(Date.parse(issued.linkExpiresAt)).toBe((await row(a.id)).endsAt.getTime() + 48 * 3_600_000);
    await expectLinkInvalid(await read(a.token));
    expect((await read(issued.selfServiceToken)).status).toBe(200);
    const again = await (await reissue(v, a.id, v.admin, key)).json();
    expect(again.selfServiceToken).not.toBe(issued.selfServiceToken);
    await expectLinkInvalid(await read(issued.selfServiceToken));
    expect(await row(a.id)).toMatchObject({ version: 1 });
    expect(await eventCount(a.id)).toBe(1);
  });

  it("refuses a read role, another venue, a booking not booked and a key of another kind, leaving the link", async () => {
    const v = await makeVenue({ seats: [4, 4] });
    const w = await makeVenue();
    const a = await book(v);
    expect((await (await reissue(v, a.id, v.reader)).json()).code).toBe("forbidden");
    expect((await (await reissue(w, a.id)).json()).code).toBe("reservation_not_found");
    const modifyKey = crypto.randomUUID();
    await staff(v, `/reservations/${a.id}/modify`, { commentary: "x" }, v.admin, modifyKey);
    expect((await (await reissue(v, a.id, v.writer, modifyKey)).json()).code).toBe("invalid_request");
    const b = await book(v);
    await staff(v, `/reservations/${b.id}/cancel`, {});
    expect((await (await reissue(v, b.id)).json()).code).toBe("invalid_transition");
    expect((await read(a.token)).status).toBe(200);
    expect((await read(b.token)).status).toBe(200);
  });

  it("gives a booking staff made its first link", async () => {
    const v = await makeVenue();
    const res = await staff(v, "/reservations", { date: SATURDAY, time: "20:00", partySize: 2, guest: { name: "Rosa", contact: "+34611222333" } });
    const { id } = await res.json();
    expect(await linkRows(id)).toHaveLength(0);
    const issued = await (await reissue(v, id)).json();
    expect(await (await read(issued.selfServiceToken)).json()).toMatchObject({ guest: { name: "Rosa", contact: "***33" } });
  });

  it("never rotates on a read, a guest modify, a staff modify or a staff status change", async () => {
    const v = await makeVenue({ seats: [4, 4] });
    const a = await book(v);
    await read(a.token);
    await modify(a.token, { version: 1, partySize: 3 });
    await staff(v, `/reservations/${a.id}/modify`, { commentary: "x" });
    await staff(v, `/reservations/${a.id}/status`, { status: "seated" });
    expect(await linkRows(a.id)).toHaveLength(1);
    expect((await read(a.token)).status).toBe(200);
  });
});

describe("C55 consent through the link", () => {
  it("records nothing when the venue does not ask, and granted or unknown when it does", async () => {
    const off = await makeVenue();
    const a = await book(off);
    const res = await modify(a.token, { version: 1, guest: { consent: "granted" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ consent: "unknown", version: 1 });
    expect((await row(a.id)).consentRecordedAt).toBeNull();
    const on = await makeVenue({ settings: { askConsent: true } });
    const b = await book(on);
    expect(await (await modify(b.token, { version: 1, guest: { consent: "granted" } })).json()).toMatchObject({ consent: "granted", version: 2 });
    expect((await row(b.id)).consentRecordedAt).not.toBeNull();
    expect(await (await modify(b.token, { version: 2, guest: { consent: "unknown" } })).json()).toMatchObject({ consent: "unknown", version: 3 });
    expect((await (await modify(b.token, { version: 3, guest: { consent: "denied" } })).json()).code).toBe("invalid_request");
  });

  it("keeps guest data out of the events of guest writes", async () => {
    const v = await makeVenue({ seats: [4, 4] });
    const a = await book(v, { guest: { name: "Marta Ruiz", contact: "marta@example.com" }, commentary: "birthday" });
    await modify(a.token, { version: 1, partySize: 3, commentary: "cake" });
    await cancel(a.token);
    const feed = await (await app.request(`/v1/venues/${v.id}/events`, { headers: { apikey: v.admin } })).text();
    for (const leak of ["Marta", "marta@", "birthday", "cake", a.token.split(".")[0], a.token.split(".")[1]]) {
      expect(feed).not.toContain(leak);
    }
    const types = await db.select({ type: events.type }).from(events).where(eq(events.reservationId, a.id)).orderBy(events.id);
    expect(types.map((e) => e.type)).toEqual(["created", "modified", "cancelled"]);
  });
});

describe("C53 erasure and retention end links", () => {
  it("deletes the links of erased bookings, the cancel replay included, and keeps the others", async () => {
    const v = await makeVenue({ seats: [4, 4, 4] });
    const a = await book(v);
    const cancelKey = crypto.randomUUID();
    await cancel(a.token, cancelKey);
    const b = await book(v);
    const staffMade = await staff(v, "/reservations", { date: SATURDAY, time: "20:00", partySize: 2, guest: { name: "Rosa", contact: "rosa@example.com" } });
    const staffId = (await staffMade.json()).id;
    const staffLink = (await (await reissue(v, staffId)).json()).selfServiceToken;
    const erasure = await staff(v, "/erasure", { principal: "widget" });
    expect(await erasure.json()).toMatchObject({ erasedReservations: 2 });
    await expectLinkInvalid(await cancel(a.token, cancelKey));
    await expectLinkInvalid(await read(b.token));
    expect(await linkRows(a.id)).toHaveLength(0);
    expect(await linkRows(b.id)).toHaveLength(0);
    expect((await read(staffLink)).status).toBe(200);
  });

  it("deletes the link of a reservation retention blanks, and link rows 30 days after expiry", async () => {
    const v = await makeVenue({ seats: [4, 4], venue: { retentionDays: 30 } });
    const a = await book(v);
    const b = await book(v);
    await db.update(selfServiceLinks).set({ expiresAt: sql`now() - interval '29 days'` }).where(eq(selfServiceLinks.reservationId, b.id));
    const kept = (await linkRows(b.id))[0].id;
    await db.update(reservations).set({ guestId: null, startsAt: new Date("2020-01-01T20:00:00Z"), endsAt: new Date("2020-01-01T22:00:00Z"), date: "2020-01-01" }).where(eq(reservations.id, a.id));
    await db.update(venues).set({ retentionDays: 1 }).where(eq(venues.id, v.id));
    await runRetention(db);
    expect((await row(a.id)).erased).toBe(true);
    await expectLinkInvalid(await read(a.token));
    expect(await linkRows(a.id)).toHaveLength(0);
    expect((await db.select().from(selfServiceLinks).where(eq(selfServiceLinks.id, kept)))).toHaveLength(1);
    await db.update(selfServiceLinks).set({ expiresAt: sql`now() - interval '31 days'` }).where(eq(selfServiceLinks.id, kept));
    await runRetention(db);
    expect(await db.select().from(selfServiceLinks).where(and(eq(selfServiceLinks.id, kept), isNull(selfServiceLinks.cancelKey)))).toHaveLength(0);
  });
});

describe("C49 and C50 email on guest writes", () => {
  async function kinds(id: string, expected: number) {
    let rows: { kind: string; version: number }[] = [];
    for (let i = 0; i < 100 && rows.length < expected; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      rows = await db.select({ kind: sentEmails.kind, version: sentEmails.version }).from(sentEmails).where(eq(sentEmails.reservationId, id));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    rows = await db.select({ kind: sentEmails.kind, version: sentEmails.version }).from(sentEmails).where(eq(sentEmails.reservationId, id));
    return rows.map((r) => `${r.kind}@${r.version}`).sort();
  }

  it("sends a confirmation for a party change only, and a cancellation, none carrying the link", async () => {
    const v = await makeVenue({
      seats: [4, 4],
      venue: { notificationsEnabled: true, noticeAddress: "venue@example.com", fromEmail: "venue@example.com" },
    });
    const a = await book(v);
    await modify(a.token, { version: 1, commentary: "note only" });
    await modify(a.token, { version: 2, partySize: 3 });
    await cancel(a.token);
    expect(await kinds(a.id, 4)).toEqual(["cancellation@4", "confirmation@1", "confirmation@3", "notice@1"]);
    const [linkId, secret] = a.token.split(".");
    for (const mail of sent) {
      expect(mail.text).not.toContain(linkId);
      expect(mail.text).not.toContain(secret);
    }
  });
});
