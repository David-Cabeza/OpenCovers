// ADR-0028, C83 to C87, C89 and C90: staff and integrators move a booking through the HTTP route.
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => [] as unknown[][]);

vi.mock("../src/lib/mailer", async (original) => ({
  ...(await original<typeof import("../src/lib/mailer")>()),
  sendEmail: async (...message: unknown[]) => {
    mail.push(message);
  },
}));

import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { addToBlocklist, blocklistKeys } from "../src/lib/blocklist";
import { linkExpiry } from "../src/lib/self-service";
import { addDays, localDateTime, toTimestamp } from "../src/lib/time";
import { saturdayAhead } from "./dates";
import { parseIcs } from "./ics-parse";

const VENUE = "move";
const WRITER = "move-writer";
const READER = "move-reader";
const ADMIN = "move-admin";
const TZ = "Europe/Madrid";
const SAT = saturdayAhead();
const SUN = addDays(SAT, 1);
const PAST = addDays(localDateTime(new Date(), TZ).date, -3);

beforeAll(async () => {
  await migrateDb();
});

beforeEach(async () => {
  await settled();
  mail.length = 0;
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, guests, guest_blocklist, grants, api_keys, services, tables, venue_online_booking, venues RESTART IDENTITY CASCADE`,
  );
  await db.insert(venues).values({
    id: VENUE,
    name: "Casa Move",
    timezone: TZ,
    turnTimes: [
      { upTo: 2, minutes: 90 },
      { upTo: 8, minutes: 150 },
    ],
  });
  await db.insert(services).values([
    { venueId: VENUE, name: "lunch", openStart: "13:00", openEnd: "17:00" },
    { venueId: VENUE, name: "dinner", openStart: "19:00", openEnd: "23:30" },
  ]);
  await db.insert(tables).values([
    { id: "a", venueId: VENUE, name: "a", seats: 2 },
    { id: "b", venueId: VENUE, name: "b", seats: 2 },
    { id: "c", venueId: VENUE, name: "c", seats: 6 },
    { id: "t", venueId: VENUE, name: "t", seats: 2, zone: "terrace" },
  ]);
  await addKey(db, WRITER, "writer", [VENUE], "write");
  await addKey(db, READER, "reader", [VENUE], "read");
  await addKey(db, ADMIN, "admin", [VENUE], "admin");
});

/** The route sends after it answers, so mail is read only once nothing more can arrive. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 100));

async function post(path: string, body?: unknown, key: string = crypto.randomUUID(), apikey = WRITER, venue = VENUE) {
  const res = await app.request(`/v1/venues/${venue}${path}`, {
    method: "POST",
    headers: { apikey, "Content-Type": "application/json", "Idempotency-Key": key },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

const read = async (id: string) =>
  (await (await app.request(`/v1/venues/${VENUE}/reservations/${id}`, { headers: { apikey: READER } })).json()) as any;

const modify = (id: string, body: object, key?: string) => post(`/reservations/${id}/modify`, body, key);

async function move(id: string, body: object, key?: string) {
  const { version } = await read(id);
  return modify(id, { version, ...body }, key);
}

async function booked(extra: object = {}): Promise<any> {
  const res = await post("/reservations", { date: SAT, time: "20:00", partySize: 2, ...extra });
  expect(res.body).toMatchObject({ status: "booked" });
  return res.body;
}

async function config(set: Partial<typeof venues.$inferInsert>) {
  await db.update(venues).set(set).where(sql`id = ${VENUE}`);
}

async function window(id: string) {
  const { rows } = await db.execute<{ table_id: string; starts_at: string; ends_at: string }>(
    sql`select table_id, starts_at, ends_at from table_allocations where reservation_id = ${id} order by table_id`,
  );
  const stored = await db.execute<{ starts_at: string; ends_at: string }>(
    sql`select starts_at, ends_at from reservations where id = ${id}`,
  );
  const [r] = stored.rows;
  for (const row of rows) {
    expect([row.starts_at, row.ends_at], "an allocation has its reservation's window").toEqual([r.starts_at, r.ends_at]);
  }
  return {
    tables: rows.map((row) => row.table_id),
    from: new Date(r.starts_at).toISOString(),
    to: new Date(r.ends_at).toISOString(),
  };
}

const at = (date: string, time: string) => toTimestamp(date, time, TZ).toISOString();

/** Every row a modify can touch. */
async function snapshot(): Promise<unknown[]> {
  const rows = [];
  for (const table of ["reservations", "table_allocations", "idempotency_keys", "events", "self_service_links"]) {
    rows.push((await db.execute(sql.raw(`SELECT t::text AS row FROM ${table} t ORDER BY 1`))).rows);
  }
  return rows;
}

/** The refusal's code, after checking that nothing was written and no email went out. */
async function refused(id: string, body: object, status?: number): Promise<any> {
  await settled();
  const before = await snapshot();
  mail.length = 0;
  const res = await move(id, body);
  await settled();
  expect(await snapshot(), "a refusal writes nothing").toEqual(before);
  expect(mail).toEqual([]);
  if (status) expect(res.status).toBe(status);
  expect(res.status).toBeGreaterThanOrEqual(400);
  return res.body;
}

const code = async (id: string, body: object) => (await refused(id, body)).code;

describe("C83 move a booking", () => {
  it("moves date, time and service in one write and frees the old window", async () => {
    const r = await booked({
      tables: ["a"],
      reconfirmation: "confirmed",
      rating: 4,
      commentary: "window seat",
      guest: { name: "Eva", contact: "eva@example.com", consent: "granted" },
    });
    const res = await modify(r.id, { date: SUN, time: "14:00", version: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: r.id,
      date: SUN,
      time: "14:00",
      service: "lunch",
      zone: "",
      partySize: 2,
      tables: ["a"],
      version: 2,
      status: "booked",
      reconfirmation: "none",
      reconfirmationRecordedAt: null,
      rating: 4,
      commentary: "window seat",
      guest: r.guest,
      bookedVia: r.bookedVia,
      ownerPrincipal: r.ownerPrincipal,
    });
    expect(await read(r.id)).toEqual(res.body);
    expect(await window(r.id)).toEqual({ tables: ["a"], from: at(SUN, "14:00"), to: at(SUN, "15:30") });
    const events = await db.execute(sql`select type, version from events order by id`);
    expect(events.rows).toEqual([
      { type: "created", version: 1 },
      { type: "modified", version: 2 },
    ]);
    expect((await post("/reservations", { date: SAT, time: "20:00", partySize: 2, tables: ["a"] })).status).toBe(200);
  });

  it("keeps the time when only the date changes, and the date when only the time changes", async () => {
    const r = await booked();
    expect((await move(r.id, { date: SUN })).body).toMatchObject({ date: SUN, time: "20:00" });
    expect((await move(r.id, { time: "21:00" })).body).toMatchObject({ date: SUN, time: "21:00", version: 3 });
  });

  it("keeps a reconfirmation the same body sets", async () => {
    const r = await booked({ reconfirmation: "requested" });
    const res = await move(r.id, { time: "20:30", reconfirmation: "confirmed" });
    expect(res.body).toMatchObject({ reconfirmation: "confirmed" });
    expect(res.body.reconfirmationRecordedAt).not.toBeNull();
    const kept = await move(r.id, { time: "21:00", reconfirmation: "confirmed" });
    expect(kept.body.reconfirmationRecordedAt).toBe(res.body.reconfirmationRecordedAt);
  });

  it("applies the whole body in one version and one event", async () => {
    const r = await booked();
    const res = await move(r.id, { time: "21:00", partySize: 4, commentary: "birthday", rating: 5, guest: { consent: "granted" } });
    expect(res.body).toMatchObject({ time: "21:00", partySize: 4, commentary: "birthday", rating: 5, version: 2 });
    expect((await db.execute(sql`select 1 from events where type = 'modified'`)).rows).toHaveLength(1);
  });

  it("recomputes the end from the turn time of the resulting party", async () => {
    const r = await booked({ tables: ["c"] });
    expect((await window(r.id)).to).toBe(at(SAT, "21:30"));
    // No version: neither date nor time changes.
    expect((await modify(r.id, { date: SAT, time: "20:00", partySize: 6 })).status).toBe(200);
    expect(await window(r.id)).toEqual({ tables: ["c"], from: at(SAT, "20:00"), to: at(SAT, "22:30") });
    expect((await post("/reservations", { date: SAT, time: "22:00", partySize: 2, tables: ["c"] })).body.code).toBe("slot_taken");
    expect((await modify(r.id, { partySize: 2 })).status).toBe(200);
    expect((await window(r.id)).to).toBe(at(SAT, "21:30"));
  });

  it("keeps the window on a change of tables or zone alone, whatever the turn times say now", async () => {
    const r = await booked({ tables: ["a"] });
    await config({ turnTimes: [{ upTo: 8, minutes: 45 }] });
    expect((await modify(r.id, { tables: ["b"] })).status).toBe(200);
    expect(await window(r.id)).toEqual({ tables: ["b"], from: at(SAT, "20:00"), to: at(SAT, "21:30") });
    expect((await modify(r.id, { zone: "terrace", tables: ["t"] })).status).toBe(200);
    expect((await window(r.id)).to).toBe(at(SAT, "21:30"));
  });

  it("places the booking in a zone without a version, and \"\" removes the zone", async () => {
    const r = await booked({ tables: ["a"] });
    const into = await modify(r.id, { zone: "terrace" });
    expect(into.body).toMatchObject({ zone: "terrace", tables: ["t"], time: "20:00", version: 2 });
    const out = await modify(r.id, { zone: "" });
    // The table it holds still fits a booking with no zone.
    expect(out.body).toMatchObject({ zone: "", tables: ["t"], version: 3 });
  });

  it.each([
    ["seconds", { time: "21:00:00" }, "time"],
    ["a space", { time: " 21:00" }, "time"],
    ["a 25th hour", { time: "25:00" }, "time"],
    ["a timestamp", { date: `${SUN}T00:00:00Z` }, "date"],
    ["an empty date", { date: "" }, "date"],
    ["a day no month has", { date: "2031-02-30" }, "date"],
    ["notifyGuest as a string", { time: "21:00", notifyGuest: "no" }, "notifyGuest"],
    ["notifyGuest as null", { time: "21:00", notifyGuest: null }, "notifyGuest"],
  ])("refuses %s as invalid", async (_name, body, path) => {
    const r = await booked();
    expect((await refused(r.id, body, 400)).details).toEqual({ fields: [{ path, problem: "invalid" }] });
  });

  it("refuses a body that holds only version and notifyGuest", async () => {
    const r = await booked();
    expect(await code(r.id, { notifyGuest: false })).toBe("invalid_request");
  });
});

describe("C84 a move is held to the create's rules", () => {
  it.each([
    ["no service covers the time", {}, { time: "18:00" }, "outside_hours"],
    ["off the slot grid", {}, { time: "20:07" }, "outside_hours"],
    ["after the last seating", { lastSeatingOffsetMinutes: 60 }, { time: "23:00" }, "outside_hours"],
    ["within the lead time", { leadTimeMinutes: 60 }, { date: PAST }, "lead_time_violation"],
    ["beyond the horizon", { maxAdvanceDays: 5 }, { time: "21:00" }, "beyond_booking_horizon"],
    ["a blocked date", { blockedDates: [{ from: SUN, to: SUN }] }, { date: SUN }, "date_blocked"],
  ])("refuses %s", async (_name, rules, body, expected) => {
    const r = await booked({ reconfirmation: "confirmed" });
    if (Object.keys(rules).length > 0) await config(rules);
    expect(await code(r.id, body)).toBe(expected);
  });

  it("answers the first rule in the create's order", async () => {
    const r = await booked();
    await config({ leadTimeMinutes: 60, maxAdvanceDays: 5, blockedDates: [{ from: PAST, to: SUN }] });
    await db.execute(sql`update services set min_party_size = 3`);
    expect(await code(r.id, { date: PAST, time: "18:00" })).toBe("outside_hours");
    expect(await code(r.id, { date: PAST })).toBe("lead_time_violation");
    expect(await code(r.id, { date: SUN })).toBe("beyond_booking_horizon");
    await config({ maxAdvanceDays: null });
    expect(await code(r.id, { date: SUN, tables: ["nope"] })).toBe("date_blocked");
    await config({ blockedDates: [] });
    expect(await code(r.id, { date: SUN, tables: ["nope"] })).toBe("party_size_too_small");
    await db.execute(sql`update services set min_party_size = null, max_party_size = 1`);
    expect(await code(r.id, { date: SUN })).toBe("party_size_too_large");
  });

  it("accepts a start in the past with no lead time, as a staff create does", async () => {
    const r = await booked();
    expect((await move(r.id, { date: PAST })).body).toMatchObject({ date: PAST });
  });

  it("succeeds with the same key once the cause is gone", async () => {
    const r = await booked();
    await config({ blockedDates: [{ from: SUN, to: SUN }] });
    expect((await modify(r.id, { date: SUN, version: 1 }, "later")).body.code).toBe("date_blocked");
    await config({ blockedDates: [] });
    expect((await modify(r.id, { date: SUN, version: 1 }, "later")).body).toMatchObject({ date: SUN, version: 2 });
  });

  it("holds the guest to the daily cap on another date, before the table rules, without counting this booking", async () => {
    const guest = { name: "Eva", contact: "eva@example.com" };
    const r = await booked({ guest });
    await config({ maxActivePerGuestPerDay: 1 });
    // A move within the date is never refused by the cap, even over it.
    await config({ maxActivePerGuestPerDay: 2 });
    await booked({ time: "13:00", guest });
    await config({ maxActivePerGuestPerDay: 1 });
    expect((await move(r.id, { time: "21:00" })).status).toBe(200);
    expect((await move(r.id, { date: SUN })).status).toBe(200);
    const other = await booked({ date: addDays(SAT, 2), guest });
    expect(await code(other.id, { date: SUN })).toBe("guest_booking_limit");
    expect(await code(other.id, { date: SUN, tables: ["nope"] })).toBe("guest_booking_limit");
    expect((await post(`/reservations/${r.id}/cancel`)).status).toBe(200);
    expect((await move(other.id, { date: SUN })).status).toBe(200);
  });

  it("applies no cap to a booking without a guest record", async () => {
    await booked({ date: SUN });
    const r = await booked();
    await config({ maxActivePerGuestPerDay: 1 });
    expect((await move(r.id, { date: SUN })).status).toBe(200);
  });

  it("runs no time rule, service limit or cap on a change of party size, tables or zone alone", async () => {
    const guest = { name: "Eva", contact: "eva@example.com" };
    await booked({ time: "13:00", guest });
    const r = await booked({ guest, tables: ["a"] });
    await config({
      maxActivePerGuestPerDay: 1,
      leadTimeMinutes: 100_000,
      maxAdvanceDays: 1,
      blockedDates: [{ from: SAT, to: SAT }],
    });
    await db.execute(sql`delete from services where name = 'dinner'`);
    await db.execute(sql`update services set max_party_size = 1`);
    expect((await modify(r.id, { partySize: 4 })).body).toMatchObject({ partySize: 4, tables: ["c"], service: "dinner" });
    expect((await modify(r.id, { partySize: 2 })).status).toBe(200);
    expect((await modify(r.id, { tables: ["b"] })).status).toBe(200);
    expect((await modify(r.id, { zone: "terrace" })).body).toMatchObject({ tables: ["t"], service: "dinner" });
  });

  it("does not apply the guest blocklist", async () => {
    const r = await booked({ guest: { name: "Eva", contact: "eva@example.com" } });
    const added = await addToBlocklist(db, blocklistKeys, VENUE, "owner", { contact: "eva@example.com" }, null);
    expect(added.ok).toBe(true);
    expect((await post("/reservations", { date: SUN, time: "13:00", partySize: 2, guest: { contact: "eva@example.com" } })).body.code).toBe("booking_declined");
    expect((await move(r.id, { date: SUN })).status).toBe(200);
  });
});

describe("C85 a move does not count itself", () => {
  it("moves onto its own overlapping window and keeps the table", async () => {
    const r = await booked({ tables: ["b"] });
    expect((await move(r.id, { time: "20:30" })).body).toMatchObject({ time: "20:30", tables: ["b"] });
    expect((await move(r.id, { time: "20:00", tables: ["b"] })).body).toMatchObject({ time: "20:00", tables: ["b"] });
  });

  it("keeps the tables it holds when they still fit, rather than the combination a create would pick", async () => {
    const r = await booked({ tables: ["c"] });
    expect((await move(r.id, { date: SUN })).body.tables).toEqual(["c"]);
    expect((await modify(r.id, { partySize: 1 })).body.tables).toEqual(["c"]);
  });

  it("takes the combination a create would assign when its tables are taken or too small", async () => {
    const r = await booked({ tables: ["a"] });
    await booked({ date: SUN, tables: ["a"] });
    expect((await move(r.id, { date: SUN })).body.tables).toEqual(["b"]);
    const grown = await modify(r.id, { partySize: 5 });
    expect(grown.body.tables).toEqual(["c"]);
  });

  it("keeps the old party, window and tables when a party change finds no place", async () => {
    const r = await booked({ tables: ["a"] });
    await booked({ tables: ["c"] });
    // a, b and t are free and seat 6.
    expect(await code(r.id, { partySize: 7 })).toBe("no_suitable_table");
    expect(await code(r.id, { partySize: 13 })).toBe("party_size_too_large");
    expect(await code(r.id, { zone: "terrace", partySize: 3 })).toBe("party_size_too_large");
    expect(await code(r.id, { zone: "nowhere" })).toBe("party_size_too_large");
  });

  it("holds no table under the overbooking ceiling, without counting itself twice", async () => {
    await config({ overbookingCeiling: 4 });
    for (const [table, partySize] of [["a", 2], ["b", 2], ["c", 6], ["t", 2]] as const) {
      await booked({ tables: [table], partySize });
    }
    const over = await booked({ partySize: 4 });
    expect(over.tables).toEqual([]);
    expect((await move(over.id, { time: "20:30" })).body).toMatchObject({ time: "20:30", tables: [] });
    const lunch = await booked({ time: "13:00", tables: ["c"], partySize: 5 });
    // 4 of the ceiling are held in that window, so 5 more do not fit.
    expect(await code(lunch.id, { time: "20:00" })).toBe("no_suitable_table");
    expect((await modify(over.id, { partySize: 2 })).status).toBe(200);
  });

  it("gets free tables for a booking that holds none", async () => {
    const r = await booked({ tables: ["a"] });
    await config({ overbookingCeiling: 4 });
    expect((await modify(r.id, { tables: [] })).body.tables).toEqual([]);
    expect((await move(r.id, { time: "21:00" })).body.tables).toEqual(["a"]);
  });

  it("holds none for tables: [], under the ceiling", async () => {
    const r = await booked({ tables: ["a"] });
    expect(await code(r.id, { time: "21:00", tables: [] })).toBe("no_suitable_table");
    await config({ overbookingCeiling: 2 });
    expect((await move(r.id, { time: "21:00", tables: [] })).body).toMatchObject({ time: "21:00", tables: [] });
    // Already without tables: a later move with the same `tables: []` still passes the ceiling check.
    await config({ overbookingCeiling: 1 });
    expect(await code(r.id, { time: "22:00", tables: [] })).toBe("no_suitable_table");
  });

  it("never holds more than the venue or the zone seats without tables, whatever the ceiling", async () => {
    await config({ overbookingCeiling: 100 });
    const r = await booked({ tables: ["a"] });
    expect((await post("/reservations", { date: SUN, time: "20:00", partySize: 13 })).body.code).toBe("party_size_too_large");
    expect(await code(r.id, { partySize: 13, tables: [] })).toBe("party_size_too_large");
    expect(await code(r.id, { time: "21:00", partySize: 50, tables: [] })).toBe("party_size_too_large");
    // The terrace seats 2.
    expect(await code(r.id, { zone: "terrace", partySize: 3, tables: [] })).toBe("party_size_too_large");
    expect((await modify(r.id, { partySize: 12, tables: [] })).body).toMatchObject({ partySize: 12, tables: [] });
  });

  it("refuses a zone with no table, also when the booking would hold none", async () => {
    await config({ overbookingCeiling: 100 });
    const r = await booked({ tables: ["a"] });
    expect(await code(r.id, { zone: "nowhere" })).toBe("party_size_too_large");
    expect(await code(r.id, { zone: "nowhere", tables: [] })).toBe("party_size_too_large");
    expect(await code(r.id, { time: "21:00", zone: "nowhere", tables: [] })).toBe("party_size_too_large");
  });

  it("holds exactly the named tables, checked in the create's order", async () => {
    const r = await booked({ tables: ["a"] });
    await booked({ date: SUN, tables: ["b"] });
    expect(await code(r.id, { date: SUN, tables: ["nope"] })).toBe("invalid_request");
    expect(await code(r.id, { date: SUN, tables: ["a", "a"] })).toBe("invalid_request");
    expect(await code(r.id, { date: SUN, partySize: 3, tables: ["t"], zone: "terrace" })).toBe("party_size_too_large");
    expect(await code(r.id, { date: SUN, tables: ["a"], zone: "terrace" })).toBe("invalid_request");
    expect(await code(r.id, { date: SUN, tables: ["b"] })).toBe("slot_taken");
    expect((await move(r.id, { date: SUN, tables: ["a", "t"] })).body.tables).toEqual(["a", "t"]);
  });

  it("holds a change of tables or party alone to the seats of the named tables", async () => {
    const r = await booked({ tables: ["a"] });
    expect(await code(r.id, { partySize: 5, tables: ["a"] })).toBe("party_size_too_large");
    await modify(r.id, { partySize: 4, tables: ["c"] });
    expect(await code(r.id, { tables: ["a"] })).toBe("party_size_too_large");
  });

  it("checks nothing when the body only restates the tables of a booking that no longer fits them", async () => {
    const r = await booked({ tables: ["a"] });
    await db.execute(sql`update tables set seats = 1 where id = 'a'`);
    expect((await modify(r.id, { tables: ["a"], commentary: "high chair" })).body).toMatchObject({ version: 2, tables: ["a"] });
  });
});

// The owner's decision of 2026-11-28: staff may keep a booking on tables outside its zone. "a", "b" and "c" are not
// in the terrace; "t" is its only table.
describe("C85 tables outside the booking's zone", () => {
  const terrace = (extra: object = {}) => booked({ zone: "terrace", tables: ["t"], ...extra });

  it("are accepted on a change of tables alone, which keeps the zone and still counts seats", async () => {
    const r = await terrace();
    expect((await modify(r.id, { tables: ["a"] })).body).toMatchObject({ zone: "terrace", tables: ["a"], version: 2 });
    expect((await modify(r.id, { tables: ["c"], date: SAT, time: "20:00", partySize: 2, zone: "terrace" })).body).toMatchObject({
      zone: "terrace",
      tables: ["c"],
    });
    await modify(r.id, { tables: ["a", "b"] });
    expect(await code(r.id, { partySize: 3, tables: ["t"] })).toBe("party_size_too_large");
    expect((await post(`/reservations/${r.id}/modify`, { tables: ["t"] })).status).toBe(200);
  });

  it("are kept by a later party change while they are free and seat the party", async () => {
    const r = await terrace();
    await modify(r.id, { tables: ["c"] });
    expect((await modify(r.id, { partySize: 4 })).body).toMatchObject({ zone: "terrace", tables: ["c"], partySize: 4 });
    expect((await window(r.id)).to).toBe(at(SAT, "22:30"));
    // Restating the held table with a party change keeps it too, and so does adding a table of the zone.
    expect((await modify(r.id, { partySize: 5, tables: ["c"] })).body.tables).toEqual(["c"]);
    expect((await modify(r.id, { partySize: 7, tables: ["c", "t"] })).body.tables).toEqual(["c", "t"]);
  });

  it("are not newly named by a change of party size", async () => {
    const r = await terrace();
    expect(await code(r.id, { partySize: 1, tables: ["a"] })).toBe("invalid_request");
    await modify(r.id, { tables: ["a"] });
    expect(await code(r.id, { partySize: 4, tables: ["a", "b"] })).toBe("invalid_request");
  });

  it("give way to the zone when they no longer seat the party or are taken for the new window", async () => {
    const r = await terrace();
    await modify(r.id, { tables: ["a"] });
    // The terrace seats 2, so a party of 3 that "a" cannot hold finds nothing.
    expect(await code(r.id, { partySize: 3 })).toBe("party_size_too_large");
    const other = await terrace({ time: "13:00" });
    expect((await modify(other.id, { tables: ["c"] })).status).toBe(200);
    await booked({ time: "14:30", tables: ["c"] });
    await db.execute(sql`update tables set zone = 'terrace', seats = 6 where id = 'b'`);
    // "c" seats 4, but a longer turn runs into the 14:30 booking on it.
    expect((await modify(other.id, { partySize: 4 })).body).toMatchObject({ zone: "terrace", tables: ["b"] });
  });

  it("do not survive a change of date, time or zone", async () => {
    const r = await terrace();
    await modify(r.id, { tables: ["c"] });
    for (const body of [{ date: SUN }, { time: "21:00" }]) {
      expect(await code(r.id, { ...body, tables: ["c"] })).toBe("invalid_request");
    }
    expect(await code(r.id, { zone: "nowhere", tables: ["c"] })).toBe("invalid_request");
    expect((await move(r.id, { time: "21:00" })).body).toMatchObject({ zone: "terrace", tables: ["t"] });
  });

  it("let a booking whose zone no table has any more shrink its party on the tables it holds", async () => {
    const r = await terrace();
    await db.execute(sql`update tables set zone = 'patio' where id = 't'`);
    expect((await modify(r.id, { partySize: 1 })).body).toMatchObject({ zone: "terrace", tables: ["t"], partySize: 1 });
    expect((await modify(r.id, { partySize: 2, tables: ["t"] })).body.tables).toEqual(["t"]);
    expect((await modify(r.id, { tables: ["a"] })).body.tables).toEqual(["a"]);
    // A move places by the zone, which no table has.
    expect(await code(r.id, { time: "21:00" })).toBe("party_size_too_large");
  });

  it("hold tables: [] on a change of tables alone to the venue's seats, not the zone's", async () => {
    await config({ overbookingCeiling: 100 });
    const r = await terrace();
    await modify(r.id, { tables: ["c"] });
    await modify(r.id, { partySize: 6 });
    expect((await modify(r.id, { tables: [] })).body).toMatchObject({ zone: "terrace", tables: [], partySize: 6 });
  });
});

describe("C86 only a booked reservation moves", () => {
  const moves = [{ date: SUN }, { time: "21:00" }, { zone: "terrace" }];

  it.each(["seated", "attended", "no_show", "cancelled"])("refuses to move a %s reservation", async (status) => {
    const r = await booked();
    await db.execute(sql`update reservations set status = ${status} where id = ${r.id}`);
    for (const body of moves) expect(await code(r.id, body)).toBe("invalid_transition");
  });

  it("keeps the window and today's rules for a seated party change", async () => {
    const r = await booked({ tables: ["a"] });
    await post(`/reservations/${r.id}/status`, { status: "seated" });
    const res = await modify(r.id, { partySize: 5 });
    expect(res.body).toMatchObject({ partySize: 5, tables: ["a"], status: "seated" });
    expect((await window(r.id)).to).toBe(at(SAT, "21:30"));
    expect((await modify(r.id, { tables: ["t"] })).status).toBe(200);
  });

  it("moves a booking whose start has passed", async () => {
    const r = await booked({ date: PAST });
    expect((await move(r.id, { date: SUN })).status).toBe(200);
  });

  it("moves a reservation whose guest data was erased, and sends no email", async () => {
    await config({ notificationsEnabled: true });
    const r = await booked({ guest: { name: "Eva", contact: "eva@example.com" } });
    await settled();
    const erased = await post("/erasure", { guestId: r.guest.guestId }, undefined, ADMIN);
    expect(erased.body.erasedReservations).toBe(1);
    mail.length = 0;
    expect((await move(r.id, { date: SUN })).body).toMatchObject({ date: SUN });
    await settled();
    expect(mail).toEqual([]);
  });

  it("refuses a read key and does not find another venue's reservation", async () => {
    const r = await booked();
    expect((await post(`/reservations/${r.id}/modify`, { date: SUN, version: 1 }, undefined, READER)).body.code).toBe("forbidden");
    await db.insert(venues).values({ id: "other", timezone: TZ });
    await addKey(db, "other-writer", "other", ["other"], "write");
    const res = await post(`/reservations/${r.id}/modify`, { date: SUN, version: 1 }, undefined, "other-writer", "other");
    expect(res.body.code).toBe("reservation_not_found");
  });
});

describe("C87 version on a move", () => {
  const MISSING = { fields: [{ path: "version", problem: "missing" }] };

  it.each([{ date: SUN }, { time: "21:00" }])("requires it for %j", async (body) => {
    const r = await booked();
    const before = await snapshot();
    const res = await modify(r.id, body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "invalid_request", details: MISSING });
    expect(await snapshot()).toEqual(before);
  });

  it("is asked for after reservation_not_found and before invalid_transition", async () => {
    expect((await modify("nope", { time: "21:00" })).body.code).toBe("reservation_not_found");
    const r = await booked();
    await post(`/reservations/${r.id}/cancel`);
    expect((await modify(r.id, { time: "21:00" })).body.details).toEqual(MISSING);
    expect((await modify(r.id, { time: "21:00", version: 1 })).body.code).toBe("reservation_changed");
    expect((await modify(r.id, { time: "21:00", version: 2 })).body.code).toBe("invalid_transition");
  });

  it("answers reservation_changed before the rules, and a repeat of a key before anything", async () => {
    const r = await booked();
    await modify(r.id, { rating: 3 });
    expect((await modify(r.id, { time: "18:00", version: 1 })).body.code).toBe("reservation_changed");
    expect((await modify(r.id, { time: "21:00", version: 2 }, "once")).body.version).toBe(3);
    await modify(r.id, { time: "21:30", version: 3 });
    const before = await snapshot();
    for (const body of [{ time: "21:00", version: 2 }, { time: "18:00" }]) {
      const res = await modify(r.id, body, "once");
      expect(res.body).toMatchObject({ time: "21:30", version: 4 });
    }
    expect(await snapshot()).toEqual(before);
  });
});

describe("C89 the self-service link follows the booking", () => {
  async function linked(extra: object = {}) {
    await app.request(`/v1/venues/${VENUE}/online-booking`, {
      method: "PUT",
      headers: { apikey: ADMIN, "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, selfServiceCutoffMinutes: 60 }),
    });
    const r = await booked(extra);
    const res = await post(`/reservations/${r.id}/self-service-link`, {});
    expect(res.status).toBeLessThan(300);
    return { ...r, token: res.body.selfServiceToken as string };
  }
  const view = async (token: string) => {
    const res = await app.request("/v1/public/self-service", { headers: { "X-Self-Service-Token": token } });
    return { status: res.status, body: (await res.json()) as any };
  };
  const links = async (id: string) =>
    (
      await db.execute<{ id: string; expires_at: string; revoked: boolean }>(
        sql`select id, expires_at, revoked_at is not null as revoked from self_service_links where reservation_id = ${id} order by created_at`,
      )
    ).rows.map((l) => ({ ...l, expires_at: new Date(l.expires_at).toISOString() }));
  const expiryAfter = async (id: string) => linkExpiry(new Date((await window(id)).to)).toISOString();

  it("keeps the token and moves the stored expiry with the end, later or earlier", async () => {
    const r = await linked();
    const [first] = await links(r.id);
    for (const body of [{ date: addDays(SAT, 5) }, { date: SAT, time: "13:00" }, { partySize: 6 }]) {
      expect((await move(r.id, body)).status).toBe(200);
      const [link, ...rest] = await links(r.id);
      expect(rest).toEqual([]);
      expect(link).toEqual({ id: first.id, revoked: false, expires_at: await expiryAfter(r.id) });
      const guest = await view(r.token);
      expect(guest.status).toBe(200);
      const stored = await read(r.id);
      expect(guest.body).toMatchObject({
        date: stored.date,
        time: stored.time,
        partySize: stored.partySize,
        version: stored.version,
        linkExpiresAt: link.expires_at,
        changeableUntil: new Date(Date.parse((await window(r.id)).from) - 60 * 60_000).toISOString(),
      });
    }
  });

  it("stops working 48 hours after an earlier end", async () => {
    const r = await linked();
    expect((await move(r.id, { date: PAST })).status).toBe(200);
    expect((await view(r.token)).status).toBe(404);
  });

  it("leaves a revoked link as it was and mints none for a booking without one", async () => {
    const r = await linked();
    await post(`/reservations/${r.id}/self-service-link`, {});
    const before = await links(r.id);
    expect((await move(r.id, { date: SUN })).status).toBe(200);
    const after = await links(r.id);
    expect(after[0]).toEqual(before[0]);
    expect(after[1].expires_at).toBe(await expiryAfter(r.id));
    const bare = await booked({ time: "13:00" });
    expect((await move(bare.id, { date: SUN })).status).toBe(200);
    expect(await links(bare.id)).toEqual([]);
  });

  it("leaves a guest's own party change in its window", async () => {
    const r = await linked({ tables: ["c"] });
    const end = (await window(r.id)).to;
    const [link] = await links(r.id);
    const res = await app.request("/v1/public/self-service/modify", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Self-Service-Token": r.token },
      body: JSON.stringify({ version: 1, partySize: 6 }),
    });
    expect(res.status).toBe(200);
    expect((await window(r.id)).to).toBe(end);
    expect(await links(r.id)).toEqual([link]);
  });
});

describe("C90 the email after a change", () => {
  const guest = { name: "Eva", contact: "eva@example.com" };

  async function mailed(id: string, body: object, key?: string) {
    await settled();
    mail.length = 0;
    const res = await move(id, body, key);
    await settled();
    return { status: res.status, version: res.body.version, emails: mail.length };
  }

  it("is sent once for a change of date, time or party size, with the version as SEQUENCE", async () => {
    await config({ notificationsEnabled: true });
    const r = await booked({ guest, tables: ["c"] });
    await settled();
    const calendar = (m: unknown[]) =>
      parseIcs(Buffer.from((m[6] as { content: string }[])[0].content, "base64").toString("utf8"));
    const created = calendar(mail[0]).get("UID");

    expect(await mailed(r.id, { date: SUN }, "moved")).toEqual({ status: 200, version: 2, emails: 1 });
    const ics = calendar(mail[0]);
    expect([ics.get("UID"), ics.get("SEQUENCE")]).toEqual([created, "2"]);
    expect(await mailed(r.id, { date: SUN }, "moved")).toEqual({ status: 200, version: 2, emails: 0 });
    expect(await mailed(r.id, { time: "21:00" })).toEqual({ status: 200, version: 3, emails: 1 });
    expect(await mailed(r.id, { partySize: 4, notifyGuest: true })).toEqual({ status: 200, version: 4, emails: 1 });
    expect(await mailed(r.id, { time: "20:30", notifyGuest: false })).toEqual({ status: 200, version: 5, emails: 0 });
    expect(await mailed(r.id, { partySize: 2, notifyGuest: false })).toEqual({ status: 200, version: 6, emails: 0 });
  });

  it("is not sent for tables, zone, other fields or a refusal", async () => {
    await config({ notificationsEnabled: true });
    const r = await booked({ guest, tables: ["a"] });
    expect(await mailed(r.id, { tables: ["b"] })).toEqual({ status: 200, version: 2, emails: 0 });
    expect(await mailed(r.id, { zone: "terrace" })).toEqual({ status: 200, version: 3, emails: 0 });
    expect(await mailed(r.id, { commentary: "x", reconfirmation: "requested" })).toEqual({ status: 200, version: 4, emails: 0 });
    expect((await mailed(r.id, { time: "18:00" })).emails).toBe(0);
  });
});
