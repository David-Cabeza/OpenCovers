import { and, count, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.PUBLIC_CHALLENGE_SECRET = "test-secret-for-the-public-form-challenge";
  process.env.PUBLIC_POW_DIFFICULTY = "4";
});

import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { events, guests, idempotencyKeys, reservations, services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { auth } from "../src/lib/auth";
import { blocklistKeys, insertBlocklistEntry } from "../src/lib/blocklist";
import { blocklistHash, normalizeContact } from "../src/lib/contact";
import {
  challengeConfigFromEnv,
  issueChallenge,
  solve,
  solves,
  type FormChallenge,
} from "../src/lib/public-challenge";
import { addDays, localDateTime, toTimestamp } from "../src/lib/time";
import { saturdayAhead } from "./dates";

const SATURDAY = saturdayAhead();
const SUNDAY = addDays(SATURDAY, 1);
const NEXT_SATURDAY = addDays(SATURDAY, 7);
const config = challengeConfigFromEnv();

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE events, tombstones, idempotency_keys, table_allocations, reservations, guests, guest_blocklist, grants, api_keys, services, tables, venue_online_booking, venues RESTART IDENTITY CASCADE`,
  );
});

interface Venue {
  id: string;
  admin: string;
  key: string;
}

let venueCount = 0;
async function makeVenue(
  opts: {
    seats?: number[];
    venue?: Partial<typeof venues.$inferInsert>;
    settings?: Record<string, unknown>;
  } = {},
): Promise<Venue> {
  venueCount += 1;
  const id = `pub-${venueCount}`;
  const admin = `${id}-admin`;
  await db.insert(venues).values({ id, name: `Casa ${venueCount}`, timezone: "Europe/Madrid", ...opts.venue });
  await db.insert(services).values({ venueId: id, name: "dinner", openStart: "20:00", openEnd: "23:00" });
  const seats = opts.seats ?? [4];
  if (seats.length > 0) {
    await db.insert(tables).values(seats.map((s, i) => ({ id: `${id}-t${i}`, venueId: id, name: `T${i}`, seats: s })));
  }
  await addKey(db, admin, `admin-${id}`, [id], "admin");
  const res = await app.request(`/v1/venues/${id}/online-booking`, {
    method: "PUT",
    headers: { apikey: admin, "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, ...opts.settings }),
  });
  if (res.status !== 200) throw new Error(`enable failed: ${await res.text()}`);
  return { id, admin, key: (await res.json()).bookingKey };
}

function oldChallenge(bookingKey: string, ageMs = 10_000): FormChallenge {
  return issueChallenge(config, bookingKey, Date.now() - ageMs);
}

let contacts = 0;
const newContact = () => `guest${++contacts}@example.com`;

function body(bookingKey: string, overrides: Record<string, unknown> = {}) {
  const challenge = oldChallenge(bookingKey);
  return {
    date: SATURDAY,
    time: "20:00",
    partySize: 2,
    guest: { name: "Ana García", contact: newContact() },
    challenge,
    solution: solve(challenge),
    ...overrides,
  };
}

function create(bookingKey: string, payload: unknown, key: string = crypto.randomUUID(), headers: Record<string, string> = {}) {
  return app.request(`/v1/public/${bookingKey}/reservations`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": key, ...headers },
    body: JSON.stringify(payload),
  });
}

const getPublic = (path: string, headers: Record<string, string> = {}) => app.request(`/v1/public/${path}`, { headers });
const availability = (bookingKey: string, date: string, partySize: number | string) =>
  getPublic(`${bookingKey}/availability?date=${date}&partySize=${partySize}`);

async function staffCreate(v: Venue, payload: Record<string, unknown>, key: string = crypto.randomUUID()) {
  return app.request(`/v1/venues/${v.id}/reservations`, {
    method: "POST",
    headers: { apikey: v.admin, "content-type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(payload),
  });
}

async function counts(venueId: string) {
  const [r] = await db.select({ n: count() }).from(reservations).where(eq(reservations.venueId, venueId));
  const [e] = await db.select({ n: count() }).from(events).where(eq(events.venueId, venueId));
  const [k] = await db.select({ n: count() }).from(idempotencyKeys).where(eq(idempotencyKeys.venueId, venueId));
  return { reservations: r.n, events: e.n, keys: k.n };
}

async function staffSessionCookie(): Promise<string> {
  const res = await auth.api.signUpEmail({
    body: { name: "Staff", email: `pub-staff-${Math.random().toString(36).slice(2)}@example.com`, password: "password123" },
    asResponse: true,
  });
  return res.headers.get("set-cookie") as string;
}

const INVALID = JSON.stringify({ code: "invalid_request", message: "invalid_request", retryable: false });

describe("C40 public surface and venue isolation", () => {
  it("returns the widget config with a fresh challenge, no ids and no-store", async () => {
    const v = await makeVenue({
      venue: { publicPhone: "+34 600 123 456", leadTimeMinutes: 60, maxAdvanceDays: 400, noticeAddress: "owner@example.com" },
      settings: { leadTimeMinutes: 30, maxAdvanceDays: 90, weekdays: [5, 6], minPartySize: 2, maxPartySize: 6 },
    });
    const first = await getPublic(v.key);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(first.headers.get("access-control-allow-origin")).toBeNull();
    expect(first.headers.get("set-cookie")).toBeNull();
    const a = await first.json();
    expect(a).toEqual({
      venue: { name: `Casa ${venueCount}`, locale: "es", theme: {}, phone: "+34 600 123 456", address: null },
      minPartySize: 2,
      maxPartySize: 6,
      weekdays: [5, 6],
      leadTimeMinutes: 60,
      maxAdvanceDays: 90,
      askConsent: false,
      confirmationMode: "auto",
      challenge: { nonce: expect.any(String), issuedAt: expect.any(String), difficulty: 4, signature: expect.any(String) },
      captcha: null,
      linkResend: false,
      privacyNoticeUrl: null,
      zones: [],
    });
    const b = await (await getPublic(v.key)).json();
    expect(b.challenge.nonce).not.toBe(a.challenge.nonce);
    const text = JSON.stringify(a);
    for (const leak of [v.id, "owner@example.com", "dinner", v.admin]) expect(text).not.toContain(leak);
  });

  it("returns the venue's theme as stored, colors in lower case", async () => {
    const theme = { colors: { primary: "#aa0000", text: "#111111" }, radius: 0, font: "rounded", logoUrl: "https://cdn.example.com/logo.png?v=2" };
    const v = await makeVenue({ settings: { theme: { ...theme, colors: { primary: "#AA0000", text: "#111111" } } } });
    expect((await (await getPublic(v.key)).json()).venue.theme).toEqual(theme);
  });

  it("answers an unknown, malformed, rotated or disabled key with the same 404 on every route", async () => {
    const rotated = await makeVenue();
    const rotation = await app.request(`/v1/venues/${rotated.id}/online-booking/rotate-key`, {
      method: "POST",
      headers: { apikey: rotated.admin },
    });
    expect((await getPublic((await rotation.json()).bookingKey)).status).toBe(200);
    const disabled = await makeVenue();
    await app.request(`/v1/venues/${disabled.id}/online-booking`, {
      method: "PUT",
      headers: { apikey: disabled.admin, "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    const keys = ["pk_AAAAAAAAAAAAAAAAAAAAAA", "not-a-key", rotated.key, disabled.key];
    const answers: string[] = [];
    for (const key of keys) {
      for (const res of [
        await getPublic(key),
        await availability(key, SATURDAY, 2),
        await create(key, body(key)),
      ]) {
        expect(res.status).toBe(404);
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(res.headers.get("content-type")).toBe("application/json");
        answers.push(await res.text());
      }
    }
    expect(new Set(answers)).toEqual(new Set([JSON.stringify({ code: "venue_not_found", message: "venue_not_found", retryable: false })]));
    expect((await counts(rotated.id)).reservations).toBe(0);
    expect((await counts(disabled.id)).reservations).toBe(0);
  });

  it("gives the same answer with a staff cookie or an API key as without", async () => {
    const v = await makeVenue();
    const cookie = await staffSessionCookie();
    const plain = await availability(v.key, SATURDAY, 2);
    const withCredentials = await getPublic(`${v.key}/availability?date=${SATURDAY}&partySize=2`, { Cookie: cookie, apikey: v.admin });
    expect(withCredentials.status).toBe(plain.status);
    expect(await withCredentials.text()).toBe(await plain.text());
    const bad = body(v.key, { tables: ["x"] });
    const anon = await create(v.key, bad);
    const staff = await create(v.key, bad, crypto.randomUUID(), { Cookie: cookie, apikey: v.admin });
    expect([anon.status, staff.status]).toEqual([400, 400]);
    expect(await staff.text()).toBe(await anon.text());
  });

  it("keeps a booking made with one venue's key in that venue", async () => {
    const a = await makeVenue();
    const b = await makeVenue();
    const res = await create(a.key, body(a.key));
    expect(res.status).toBe(200);
    expect((await counts(a.id)).reservations).toBe(1);
    expect((await counts(b.id)).reservations).toBe(0);
    const text = await (await getPublic(a.key)).text();
    expect(text).not.toContain(b.key);
    expect(text).not.toContain(`Casa ${b.id.slice(4)}`);
  });
});

describe("C42 public availability", () => {
  it("lists only times a public create would accept, and nothing else", async () => {
    const v = await makeVenue({ settings: { weekdays: [6], maxPartySize: 4 } });
    const res = await availability(v.key, SATURDAY, 2);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const answer = await res.json();
    expect(Object.keys(answer).sort()).toEqual(["date", "partySize", "reason", "times"]);
    expect(answer.times[0]).toBe("20:00");
    expect(answer.times).toEqual([...answer.times].sort());
    expect(answer.times).toHaveLength(12);
    expect((await (await availability(v.key, SUNDAY, 2)).json()).times).toEqual([]);
    expect((await (await availability(v.key, SATURDAY, 5)).json()).times).toEqual([]);
  });

  it("refuses a malformed date or party size", async () => {
    const v = await makeVenue();
    for (const [date, party] of [["2030-02-30", 2], ["tomorrow", 2], [SATURDAY, 0], [SATURDAY, "2.5"], [SATURDAY, "x"]] as const) {
      const res = await availability(v.key, date, party);
      expect(res.status).toBe(400);
      expect(await res.text()).toBe(INVALID);
    }
  });

  it("leaves out a time only the overbooking ceiling could fill, which the staff view shows", async () => {
    const v = await makeVenue({ venue: { overbookingCeiling: 10 } });
    expect((await staffCreate(v, { date: SATURDAY, time: "20:00", partySize: 4 })).status).toBe(200);
    const staff = await (await app.request(`/v1/venues/${v.id}/availability?date=${SATURDAY}&partySize=2`, { headers: { apikey: v.admin } })).json();
    expect(staff.availability.dinner.find((s: { time: string }) => s.time === "20:00").available).toBe(true);
    const times = (await (await availability(v.key, SATURDAY, 2)).json()).times;
    expect(times).not.toContain("20:00");
    expect(times).toContain("22:00");
  });

  it("agrees with the create over a grid of times and party sizes", async () => {
    const v = await makeVenue({ seats: [2, 4], settings: { maxPartySize: 4 } });
    await staffCreate(v, { date: SATURDAY, time: "21:00", partySize: 4 });
    for (const party of [1, 3, 5]) {
      const listed = new Set<string>((await (await availability(v.key, SATURDAY, party)).json()).times);
      for (const time of ["19:45", "20:00", "20:30", "21:00", "21:15", "22:45"]) {
        const probe = await makeProbe(v, time, party);
        expect([time, party, probe]).toEqual([time, party, listed.has(time)]);
      }
    }
  });
});

// A create that succeeds is undone, so each probe sees the same venue.
async function makeProbe(v: Venue, time: string, partySize: number): Promise<boolean> {
  const res = await create(v.key, body(v.key, { time, partySize }));
  if (res.status !== 200) return false;
  await db.execute(
    sql`delete from table_allocations where reservation_id in (select id from reservations where venue_id = ${v.id} and booked_via = 'widget')`,
  );
  await db.delete(reservations).where(and(eq(reservations.venueId, v.id), eq(reservations.bookedVia, "widget")));
  return true;
}

describe("C43 public create and attribution", () => {
  it("books with engine attribution and returns the guest view", async () => {
    const v = await makeVenue();
    const res = await create(
      v.key,
      body(v.key, {
        guest: { name: "  Ana García ", contact: "Ana.Garcia@Example.com" },
        commentary: "window seat",
        bookedVia: "evil",
        ownerPrincipal: "evil",
        basis: "consent",
        source: "x",
        service: "lunch",
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const answer = await res.json();
    expect(answer).toEqual({
      reservation: {
        venue: { name: expect.any(String), locale: "es", theme: {}, phone: null, address: null },
        date: SATURDAY,
        time: "20:00",
        partySize: 2,
        maxPartySize: 8,
        status: "booked",
        version: 1,
        guest: { name: "Ana García", contact: "a***@example.com" },
        commentary: "window seat",
        consent: "unknown",
        changeableUntil: expect.any(String),
        linkExpiresAt: expect.any(String),
      },
      selfServiceToken: expect.stringMatching(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/),
    });
    const start = toTimestamp(SATURDAY, "20:00", "Europe/Madrid").getTime();
    expect(Date.parse(answer.reservation.changeableUntil)).toBe(start - 120 * 60_000);
    expect(Date.parse(answer.reservation.linkExpiresAt)).toBe(start + 120 * 60_000 + 48 * 3_600_000);
    const [row] = await db.select().from(reservations).where(eq(reservations.venueId, v.id));
    expect(row).toMatchObject({ bookedVia: "widget", ownerPrincipal: "widget", basis: "service", guestContact: "Ana.Garcia@Example.com" });
    const staffView = await (await app.request(`/v1/venues/${v.id}/reservations/${row.id}`, { headers: { apikey: v.admin } })).json();
    expect(staffView.tables).toEqual([`${v.id}-t0`]);
    expect(await counts(v.id)).toEqual({ reservations: 1, events: 1, keys: 1 });
    const text = JSON.stringify(answer.reservation);
    for (const leak of [row.id, v.id, "t0", "dinner", "widget"]) expect(text).not.toContain(leak);
  });

  it("masks a phone to its last two digits", async () => {
    const v = await makeVenue();
    const res = await create(v.key, body(v.key, { guest: { name: "Bo", contact: "+34600123456" } }));
    expect((await res.json()).reservation.guest.contact).toBe("***56");
  });

  it("refuses named tables, zones, ratings, reconfirmation and malformed guests, writing nothing", async () => {
    const v = await makeVenue();
    const bad: Record<string, unknown>[] = [
      { tables: [`${v.id}-t0`] },
      { zone: "terrace" },
      { rating: 5 },
      { reconfirmation: "confirmed" },
      { guest: { name: "Ana", contact: "not a contact" } },
      { guest: { name: "   ", contact: newContact() } },
      { guest: { name: "x".repeat(101), contact: newContact() } },
      { guest: { name: "Ana", contact: newContact(), consent: "denied" } },
      { commentary: "x".repeat(501) },
      { partySize: 0 },
      { partySize: 2.5 },
      { date: "2030-13-01" },
      { time: "20:00:00" },
    ];
    for (const override of bad) {
      const res = await create(v.key, body(v.key, override));
      expect([override, res.status]).toEqual([override, 400]);
      expect(await res.text()).toBe(INVALID);
    }
    expect(await counts(v.id)).toEqual({ reservations: 0, events: 0, keys: 0 });
  });

  it("applies the online services, weekdays, party limits, lead time and horizon on top of the venue's", async () => {
    const tomorrow = addDays(localDateTime(new Date(), "Europe/Madrid").date, 1);
    const v = await makeVenue({
      venue: { blockedDates: [{ from: NEXT_SATURDAY, to: NEXT_SATURDAY }] },
      settings: { weekdays: [6], minPartySize: 2, maxPartySize: 4 },
    });
    const cases: [Record<string, unknown>, number, string][] = [
      [{ date: SUNDAY }, 400, "outside_hours"],
      [{ time: "13:00" }, 400, "outside_hours"],
      [{ partySize: 1 }, 400, "party_size_too_small"],
      [{ partySize: 5 }, 400, "party_size_too_large"],
      [{ date: NEXT_SATURDAY }, 400, "date_blocked"],
    ];
    for (const [override, status, code] of cases) {
      const res = await create(v.key, body(v.key, override));
      expect([override, res.status, (await res.json()).code]).toEqual([override, status, code]);
    }
    const early = await makeVenue({ settings: { leadTimeMinutes: 2 * 1440 } });
    const tooSoon = await create(early.key, body(early.key, { date: tomorrow }));
    expect((await tooSoon.json()).code).toBe("lead_time_violation");
    const near = await makeVenue({ settings: { maxAdvanceDays: 30 } });
    const res = await create(near.key, body(near.key));
    expect((await res.json()).code).toBe("beyond_booking_horizon");
    for (const [venue, date] of [[v, NEXT_SATURDAY], [early, tomorrow], [near, SATURDAY]] as const) {
      expect((await (await availability(venue.key, date, 2)).json()).times).toEqual([]);
    }
    expect((await (await availability(early.key, SATURDAY, 2)).json()).times).toContain("20:00");
  });

  it("records consent only when the venue asks, and never a refusal", async () => {
    const off = await makeVenue();
    const on = await makeVenue({ settings: { askConsent: true } });
    for (const v of [off, on]) {
      expect((await create(v.key, body(v.key, { guest: { name: "Ana", contact: newContact(), consent: "granted" } }))).status).toBe(200);
    }
    const [offRow] = await db.select().from(reservations).where(eq(reservations.venueId, off.id));
    const [onRow] = await db.select().from(reservations).where(eq(reservations.venueId, on.id));
    expect([offRow.consent, offRow.consentRecordedAt]).toEqual(["unknown", null]);
    expect(onRow.consent).toBe("granted");
    expect(onRow.consentRecordedAt).toBeInstanceOf(Date);
    const denied = await create(on.key, body(on.key, { guest: { name: "Ana", contact: newContact(), consent: "denied" } }));
    expect(denied.status).toBe(400);
    expect((await (await getPublic(on.key)).json()).askConsent).toBe(true);
  });

  it("never overbooks: slot_taken where a staff create is accepted under the ceiling", async () => {
    for (const ceiling of [10, 0]) {
      const v = await makeVenue({ venue: { overbookingCeiling: ceiling } });
      expect((await staffCreate(v, { date: SATURDAY, time: "20:00", partySize: 4 })).status).toBe(200);
      const res = await create(v.key, body(v.key));
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("slot_taken");
      const staff = await staffCreate(v, { date: SATURDAY, time: "20:00", partySize: 2 });
      if (ceiling > 0) expect((await staff.json()).tables).toEqual([]);
      const [{ held }] = await db
        .select({ held: count() })
        .from(reservations)
        .where(and(eq(reservations.venueId, v.id), eq(reservations.bookedVia, "widget")));
      expect(held).toBe(0);
    }
  });

  it("books one of two concurrent creates for the last table, and the other gets slot_taken", async () => {
    const v = await makeVenue({ seats: [4] });
    const [a, b] = await Promise.all([create(v.key, body(v.key)), create(v.key, body(v.key))]);
    const answers = [
      { status: a.status, code: a.status === 200 ? "ok" : (await a.json()).code },
      { status: b.status, code: b.status === 200 ? "ok" : (await b.json()).code },
    ].sort((x, y) => x.status - y.status);
    expect(answers).toEqual([
      { status: 200, code: "ok" },
      { status: 409, code: "slot_taken" },
    ]);
    expect((await counts(v.id)).reservations).toBe(1);
  });
});

describe("C44 public idempotency", () => {
  it("replays a repeat of the key with no second booking or event, even with a spent or expired challenge", async () => {
    const v = await makeVenue({ seats: [4, 4] });
    const key = crypto.randomUUID();
    const payload = body(v.key);
    const first = await create(v.key, payload, key);
    expect(first.status).toBe(200);
    const again = await create(v.key, payload, key);
    expect(again.status).toBe(200);
    expect((await again.json()).reservation).toEqual((await first.json()).reservation);
    const expired = oldChallenge(v.key, 31 * 60_000);
    const late = await create(v.key, { ...payload, challenge: expired, solution: solve(expired) }, key.toUpperCase());
    expect(late.status).toBe(200);
    expect(await counts(v.id)).toEqual({ reservations: 1, events: 1, keys: 1 });
    const [stored] = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.venueId, v.id));
    expect(stored.key).toBe(`public:${key}`);
  });

  it("refuses a missing key or one that is not a UUID", async () => {
    const v = await makeVenue();
    for (const key of ["", "abc", "public:00000000-0000-0000-0000-000000000000"]) {
      const res = await app.request(`/v1/public/${v.key}/reservations`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
        body: JSON.stringify(body(v.key)),
      });
      expect(res.status).toBe(400);
      expect(await res.text()).toBe(INVALID);
    }
    expect(await counts(v.id)).toEqual({ reservations: 0, events: 0, keys: 0 });
  });

  it("keeps public keys apart from staff keys, and per venue", async () => {
    const v = await makeVenue({ seats: [4, 4, 4] });
    const k = crypto.randomUUID();
    const staff = await (await staffCreate(v, { date: SATURDAY, time: "21:00", partySize: 4, guest: { name: "Staff", contact: "staff@example.com" } }, k)).json();
    const pub = await create(v.key, body(v.key), k);
    expect(pub.status).toBe(200);
    const view = (await pub.json()).reservation;
    expect(view.time).toBe("20:00");
    expect(JSON.stringify(view)).not.toContain("staff@example.com");
    const k2 = crypto.randomUUID();
    expect((await create(v.key, body(v.key), k2)).status).toBe(200);
    const staffAfter = await staffCreate(v, { date: SATURDAY, time: "22:00", partySize: 2 }, k2);
    expect((await staffAfter.json()).id).not.toBe(staff.id);
    const other = await makeVenue();
    expect((await create(other.key, body(other.key), k2)).status).toBe(200);
    expect((await counts(v.id)).reservations).toBe(4);
    expect((await counts(other.id)).reservations).toBe(1);
  });
});

describe("C45 bot protection", () => {
  async function refused(v: Venue, payload: unknown, key: string = crypto.randomUUID()) {
    const res = await create(v.key, payload, key);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(INVALID);
  }

  it("refuses a filled honeypot, a missing, young, old, altered, foreign or unsolved challenge, alike", async () => {
    const v = await makeVenue();
    const other = await makeVenue();
    const fresh = issueChallenge(config, v.key);
    const old = oldChallenge(v.key, 30 * 60_000 + 5_000);
    const foreign = oldChallenge(other.key);
    const good = oldChallenge(v.key);
    let wrong = 0;
    while (solves(good.nonce, String(wrong), good.difficulty)) wrong += 1;
    await refused(v, body(v.key, { honeypot: "http://spam.example" }));
    await refused(v, { ...body(v.key), challenge: undefined });
    await refused(v, { ...body(v.key), solution: undefined });
    await refused(v, body(v.key, { challenge: fresh, solution: solve(fresh) }));
    await refused(v, body(v.key, { challenge: old, solution: solve(old) }));
    await refused(v, body(v.key, { challenge: foreign, solution: solve(foreign) }));
    await refused(v, body(v.key, { challenge: good, solution: String(wrong) }));
    for (const altered of [
      { ...good, difficulty: 0 },
      { ...good, issuedAt: new Date(Date.parse(good.issuedAt) - 1000).toISOString() },
      { ...good, nonce: good.nonce.replace(/^./, (c) => (c === "A" ? "B" : "A")) },
      { ...good, signature: good.signature.replace(/^./, (c) => (c === "A" ? "B" : "A")) },
    ]) {
      await refused(v, body(v.key, { challenge: altered, solution: solve(altered) }));
    }
    expect(await counts(v.id)).toEqual({ reservations: 0, events: 0, keys: 0 });
    expect((await create(v.key, body(v.key, { honeypot: "" }))).status).toBe(200);
  });

  it("refuses a nonce another submit already presented, but lets the same submit retry", async () => {
    const v = await makeVenue({ seats: [4, 4] });
    const challenge = oldChallenge(v.key);
    const payload = body(v.key, { challenge, solution: solve(challenge) });
    const key = crypto.randomUUID();
    expect((await create(v.key, payload, key)).status).toBe(200);
    await refused(v, { ...payload, guest: { name: "Bot", contact: newContact() } });
    expect((await create(v.key, payload, key)).status).toBe(200);
    expect((await counts(v.id)).reservations).toBe(1);
  });

  it("counts a nonce as used even when that create failed on its own rules", async () => {
    const v = await makeVenue();
    const challenge = oldChallenge(v.key);
    const failing = await create(v.key, body(v.key, { challenge, solution: solve(challenge), date: SUNDAY, time: "13:00" }));
    expect((await failing.json()).code).toBe("outside_hours");
    await refused(v, body(v.key, { challenge, solution: solve(challenge) }));
  });
});

describe("C46 per-contact caps", () => {
  it("allows the booking that reaches the cap and refuses the next with online_booking_limit", async () => {
    const v = await makeVenue({ seats: [4, 4, 4, 4, 4] });
    const contact = newContact();
    const as = (time: string, c = contact) => body(v.key, { time, guest: { name: "Ana", contact: c } });
    expect((await create(v.key, as("20:00"))).status).toBe(200);
    expect((await create(v.key, as("20:15", `  ${contact.toUpperCase()} `))).status).toBe(200);
    const over = await create(v.key, as("20:30"));
    expect(over.status).toBe(409);
    expect(await over.json()).toEqual({ code: "online_booking_limit", message: "online_booking_limit", retryable: false });
    expect((await counts(v.id)).reservations).toBe(2);
    expect((await staffCreate(v, { date: SATURDAY, time: "21:00", partySize: 2, guest: { name: "Ana", contact } })).status).toBe(200);
    const [booked] = await db
      .select()
      .from(reservations)
      .where(and(eq(reservations.venueId, v.id), eq(reservations.bookedVia, "widget")))
      .limit(1);
    await app.request(`/v1/venues/${v.id}/reservations/${booked.id}/cancel`, {
      method: "POST",
      headers: { apikey: v.admin, "Idempotency-Key": crypto.randomUUID() },
    });
    expect((await create(v.key, as("20:30"))).status).toBe(200);
    const elsewhere = await makeVenue();
    expect((await create(elsewhere.key, body(elsewhere.key, { guest: { name: "Ana", contact } }))).status).toBe(200);
  });

  it("ignores bookings staff made and past bookings, and null turns the cap off", async () => {
    const v = await makeVenue({ seats: [4, 4, 4, 4], settings: { maxOpenBookingsPerContact: 1 } });
    const contact = newContact();
    await staffCreate(v, { date: SATURDAY, time: "22:00", partySize: 2, guest: { name: "Ana", contact } });
    expect((await create(v.key, body(v.key, { guest: { name: "Ana", contact } }))).status).toBe(200);
    await db.update(reservations).set({ startsAt: new Date(Date.now() - 3_600_000) }).where(and(eq(reservations.venueId, v.id), eq(reservations.bookedVia, "widget")));
    expect((await create(v.key, body(v.key, { time: "20:15", guest: { name: "Ana", contact } }))).status).toBe(200);
    expect((await create(v.key, body(v.key, { time: "20:30", guest: { name: "Ana", contact } }))).status).toBe(409);
    await app.request(`/v1/venues/${v.id}/online-booking`, {
      method: "PUT",
      headers: { apikey: v.admin, "content-type": "application/json" },
      body: JSON.stringify({ maxOpenBookingsPerContact: null }),
    });
    expect((await create(v.key, body(v.key, { time: "20:30", guest: { name: "Ana", contact } }))).status).toBe(200);
  });

  it("never exceeds the cap under concurrent creates by one contact", async () => {
    const v = await makeVenue({ seats: [2, 2, 2, 2, 2, 2] });
    const contact = newContact();
    const results = await Promise.all(
      ["20:00", "20:15", "20:30", "20:45", "21:00", "21:15"].map((time) =>
        create(v.key, body(v.key, { time, guest: { name: "Ana", contact } })),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    expect((await counts(v.id)).reservations).toBe(2);
  });

  it("checks the venue's per-day cap first when both caps are reached", async () => {
    const v = await makeVenue({ seats: [4, 4, 4], venue: { maxActivePerGuestPerDay: 2 } });
    const contact = newContact();
    for (const time of ["20:00", "20:15"]) {
      expect((await create(v.key, body(v.key, { time, guest: { name: "Ana", contact } }))).status).toBe(200);
    }
    const res = await create(v.key, body(v.key, { time: "20:30", guest: { name: "Ana", contact } }));
    expect((await res.json()).code).toBe("guest_booking_limit");
  });

  it("never refuses a staff create with the online cap", async () => {
    const v = await makeVenue({ seats: [4, 4, 4, 4], settings: { maxOpenBookingsPerContact: 1 } });
    const contact = newContact();
    expect((await create(v.key, body(v.key, { guest: { name: "Ana", contact } }))).status).toBe(200);
    expect((await staffCreate(v, { date: SATURDAY, time: "20:00", partySize: 2, guest: { name: "Ana", contact } })).status).toBe(200);
  });
});

describe("C54 guest blocklist on the public create", () => {
  it("declines a blocked contact where it would book, leaving nothing, and the same key books after removal", async () => {
    const v = await makeVenue();
    const contact = "blocked@example.com";
    const hash = blocklistHash(blocklistKeys.current, v.id, normalizeContact(contact, null)!);
    const entry = await insertBlocklistEntry(db, v.id, hash, { reason: null, createdBy: "admin" });
    const key = crypto.randomUUID();
    const payload = body(v.key, { guest: { name: "Bo", contact } });
    const res = await create(v.key, payload, key);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "booking_declined", message: "booking_declined", retryable: false });
    expect(await counts(v.id)).toEqual({ reservations: 0, events: 0, keys: 0 });
    expect(await db.select().from(guests).where(eq(guests.venueId, v.id))).toEqual([]);
    const closed = await create(v.key, body(v.key, { time: "13:00", guest: { name: "Bo", contact } }));
    expect((await closed.json()).code).toBe("outside_hours");
    const plain = await (await availability(v.key, SATURDAY, 2)).json();
    expect(plain.times).toContain("20:00");
    await db.execute(sql`delete from guest_blocklist where id = ${entry!.id}`);
    expect((await create(v.key, payload, key)).status).toBe(200);
    const elsewhere = await makeVenue();
    expect((await create(elsewhere.key, body(elsewhere.key, { guest: { name: "Bo", contact } }))).status).toBe(200);
  });
});

describe("C43 / C55 guest locale on the public create (ADR-0024)", () => {
  const staffGet = (v: Venue, path: string) => app.request(`/v1/venues/${v.id}${path}`, { headers: { apikey: v.admin } });
  const staffPost = (v: Venue, path: string, payload: unknown) =>
    app.request(`/v1/venues/${v.id}${path}`, {
      method: "POST",
      headers: { apikey: v.admin, "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(payload),
    });
  const stored = async (id: string) =>
    (await db.select({ l: reservations.guestLocale }).from(reservations).where(eq(reservations.id, id)))[0].l;

  async function publicCreate(v: Venue, overrides: Record<string, unknown> = {}, key: string = crypto.randomUUID()) {
    const res = await create(v.key, body(v.key, overrides), key);
    const json = await res.json();
    return { res, json, key };
  }

  async function staffId(v: Venue, token: string) {
    const rows = await db.select().from(reservations).where(eq(reservations.venueId, v.id));
    return rows.find((r) => r.guestContact === token)!.id;
  }

  it("stores each of the seven codes and shows it as guestLocale through get, list, search and agenda", async () => {
    const v = await makeVenue({ seats: [4, 4, 4, 4, 4, 4, 4, 4] });
    for (const code of ["es", "en", "ca", "fr", "de", "it", "pt"]) {
      const contact = newContact();
      const { res } = await publicCreate(v, { locale: code, guest: { name: "Ana", contact } });
      expect(res.status).toBe(200);
      const id = await staffId(v, contact);
      expect(await stored(id)).toBe(code);
      expect(((await (await staffGet(v, `/reservations/${id}`)).json()) as any).guestLocale).toBe(code);
    }
    const search = (await (await staffGet(v, `/reservations/search?dateStart=${SATURDAY}&dateEnd=${SUNDAY}`)).json()) as any;
    const agenda = (await (await staffGet(v, `/agenda?date=${SATURDAY}`)).json()) as any;
    for (const feed of [search, agenda]) {
      expect(feed.reservations.map((r: any) => r.guestLocale).sort()).toEqual(["ca", "de", "en", "es", "fr", "it", "pt"]);
    }
  });

  it("reads null without locale, and for staff creates and walk-ins; no staff write sets it", async () => {
    const v = await makeVenue({ seats: [4, 4, 4, 4] });
    const contact = newContact();
    expect((await publicCreate(v, { guest: { name: "Ana", contact } })).res.status).toBe(200);
    const publicId = await staffId(v, contact);
    expect(await stored(publicId)).toBeNull();

    const made = await staffPost(v, "/reservations", {
      date: SATURDAY, time: "21:00", partySize: 2, guest: { name: "Staff", contact: "staff@example.com" }, guestLocale: "en", locale: "en",
    });
    expect(made.status).toBe(200);
    const staffRes = (await made.json()) as any;
    expect(staffRes.guestLocale).toBeNull();
    expect(await stored(staffRes.id)).toBeNull();
    // The list is the caller's own bookings (by principal), so it shows the staff one, with null.
    const list = (await (await staffGet(v, "/reservations")).json()) as any;
    expect(list.reservations.map((r: any) => r.guestLocale)).toEqual([null]);

    const walk = await staffPost(v, "/reservations/walk-in", { partySize: 2, date: SATURDAY, time: "21:00", guestLocale: "fr" });
    expect(walk.status).toBe(200);
    expect(await stored(((await walk.json()) as any).id)).toBeNull();

    const modified = await staffPost(v, `/reservations/${publicId}/modify`, { partySize: 3, guestLocale: "de" });
    expect(modified.status).toBe(200);
    expect(await stored(publicId)).toBeNull();
  });

  it("refuses anything but the seven lower-case codes and writes nothing", async () => {
    const v = await makeVenue();
    const before = await counts(v.id);
    for (const bad of ["EN", "En", "en-GB", "xx", "", " en", "en ", null, 5, true, ["en"], { l: "en" }]) {
      const { res } = await publicCreate(v, { locale: bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(await res.text().catch(() => "")).toBe("");
    }
    expect(await counts(v.id)).toEqual(before);
  });

  it("keeps the first stored locale on a replay of the create key", async () => {
    const v = await makeVenue();
    const contact = newContact();
    const payload = body(v.key, { locale: "en", guest: { name: "Ana", contact } });
    const key = crypto.randomUUID();
    expect((await create(v.key, payload, key)).status).toBe(200);
    const id = await staffId(v, contact);
    expect((await create(v.key, { ...payload, locale: "fr" }, key)).status).toBe(200);
    expect((await create(v.key, { ...payload, locale: undefined }, key)).status).toBe(200);
    expect(await stored(id)).toBe("en");
    const [n] = await db.select({ n: count() }).from(reservations).where(eq(reservations.venueId, v.id));
    expect(n.n).toBe(1);
  });

  it("keeps it through a guest modify and a staff modify", async () => {
    const v = await makeVenue({ seats: [4, 6] });
    const contact = newContact();
    const { json } = await publicCreate(v, { locale: "pt", guest: { name: "Ana", contact } });
    const id = await staffId(v, contact);
    const ok = await app.request("/v1/public/self-service/modify", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Self-Service-Token": json.selfServiceToken },
      body: JSON.stringify({ version: 1, partySize: 3, locale: "de" }),
    });
    expect(ok.status).toBe(200);
    expect(await stored(id)).toBe("pt");
    expect((await staffPost(v, `/reservations/${id}/modify`, { partySize: 2, guestLocale: "fr" })).status).toBe(200);
    expect(await stored(id)).toBe("pt");
  });

  it("resets it to null on erasure, with the counts unchanged", async () => {
    const v = await makeVenue();
    const contact = newContact();
    await publicCreate(v, { locale: "it", guest: { name: "Ana", contact } });
    const id = await staffId(v, contact);
    const res = await staffPost(v, "/erasure", { principal: "widget" });
    expect(res.status).toBe(200);
    const counts = (await res.json()) as any;
    expect(counts.erasedReservations).toBe(1);
    const [row] = await db.select().from(reservations).where(eq(reservations.id, id));
    expect(row).toMatchObject({ erased: true, guestLocale: null });
  });
});
