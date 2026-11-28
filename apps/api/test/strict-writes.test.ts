// C94, rule (a) of ADR-0029: a staff reservation or waitlist write that is not fully understood answers
// `invalid_request`, names the fields and writes nothing. Never a 500, never a silent 200.
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { CREATE_FIELDS, MODIFY_FIELDS, WAITLIST_ADD_FIELDS, WALK_IN_FIELDS } from "../src/lib/staff-writes";
import { saturdayAhead } from "./dates";

const VENUE = "strict";
const KEY = "strict-write";
const DATE = saturdayAhead();

beforeAll(async () => {
  await migrateDb();
});

afterAll(() => {
  delete process.env.DIETARY;
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE events, tombstones, idempotency_keys, table_allocations, reservations, waitlist, guests, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
  await db.insert(venues).values({ id: VENUE, name: "Casa Strict", timezone: "Europe/Madrid" });
  await db.insert(services).values({ venueId: VENUE, name: "all", openStart: "00:00", openEnd: "23:59" });
  await db.insert(tables).values(["1", "2", "3"].map((id) => ({ id, venueId: VENUE, name: id, seats: 4 })));
  await addKey(db, KEY, "staff", [VENUE], "write");
});

const SNAPSHOT_TABLES = ["reservations", "table_allocations", "waitlist", "idempotency_keys", "events", "tombstones", "guests"];

/** Every row a reservation or waitlist write can touch. */
async function snapshot(): Promise<unknown[]> {
  const rows = [];
  for (const table of SNAPSHOT_TABLES) {
    rows.push((await db.execute(sql.raw(`SELECT t::text AS row FROM ${table} t ORDER BY 1`))).rows);
  }
  return rows;
}

/** `body` is sent as JSON. A string is sent as it is, and undefined sends no body. */
async function post(path: string, body?: unknown, key: string = crypto.randomUUID()) {
  const res = await app.request(`/v1/venues/${VENUE}${path}`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json", "Idempotency-Key": key },
    body: body === undefined || typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) };
}

const json = (value: unknown) => JSON.stringify(value);
const guest = { name: "Lia Soto", contact: "lia@example.com" };
const booking = { date: DATE, time: "21:00", partySize: 2 };

async function booked(extra: object = {}) {
  const res = await post("/reservations", { ...booking, ...extra });
  expect(res.status).toBe(200);
  return res.body as { id: string; date: string; time: string; zone: string; partySize: number; version: number };
}

async function waiting(): Promise<string> {
  const res = await post("/waitlist", { partySize: 2, guest });
  expect(res.status).toBe(201);
  return res.body.entries.at(-1).id;
}

async function expectRefused(send: () => ReturnType<typeof post>, fields?: string[]) {
  const before = await snapshot();
  const res = await send();
  expect(res.status).toBe(400);
  expect(res.body).toMatchObject({ code: "invalid_request", retryable: false });
  expect(res.body.details?.fields.map((f: { path: string; problem: string }) => `${f.path}:${f.problem}`)).toEqual(fields);
  expect(await snapshot()).toEqual(before);
}

/** Bodies no route with fields takes. None of them names a field. */
const NOT_OBJECTS: [string, string | undefined][] = [
  ["no body", undefined],
  ["an empty body", ""],
  ["malformed JSON", "{not json"],
  ["null", "null"],
  ["an array", json([booking])],
  ["a string", json("x")],
  ["a number", "5"],
];

/** One bad value for each rule, as [name, the body's difference from a good one, the fields named]. */
const BAD_VALUES: [string, object, string[]][] = [
  ["an unknown field", { foo: 1 }, ["foo:unknown"]],
  ["attribution", { bookedVia: "x", basis: "x", ownerPrincipal: "x" }, ["bookedVia:unknown", "basis:unknown", "ownerPrincipal:unknown"]],
  ["service, source and status", { service: "all", source: "x", status: "seated" }, ["service:unknown", "source:unknown", "status:unknown"]],
  ["an unknown guest field", { guest: { ...guest, guestId: "g1" } }, ["guest.guestId:unknown"]],
  ["a null guest", { guest: null }, ["guest:invalid"]],
  ["a guest that is a string", { guest: "Lia" }, ["guest:invalid"]],
  ["a numeric guest name", { guest: { name: 5 } }, ["guest.name:invalid"]],
  ["a null contact", { guest: { contact: null } }, ["guest.contact:invalid"]],
  ["a contact over 254 characters", { guest: { contact: `${"a".repeat(250)}@example.com` } }, ["guest.contact:invalid"]],
  ["a NUL in the name", { guest: { name: "a\u0000b" } }, ["guest.name:invalid"]],
  ["a NUL in the zone", { zone: "a\u0000b" }, ["zone:invalid"]],
  ["a NUL in a table id", { tables: ["a\u0000b"] }, ["tables:invalid"]],
  ["a null zone", { zone: null }, ["zone:invalid"]],
  ["a numeric zone", { zone: 3 }, ["zone:invalid"]],
  ["tables as a string", { tables: "2" }, ["tables:invalid"]],
  ["tables of numbers", { tables: [2] }, ["tables:invalid"]],
  ["null tables", { tables: null }, ["tables:invalid"]],
  ["a party of zero", { partySize: 0 }, ["partySize:invalid"]],
  ["a negative party", { partySize: -2 }, ["partySize:invalid"]],
  ["a fractional party", { partySize: 2.5 }, ["partySize:invalid"]],
  ["a party as a string", { partySize: "2" }, ["partySize:invalid"]],
  ["a party over 10000", { partySize: 10001 }, ["partySize:invalid"]],
];

describe("POST /reservations", () => {
  it.each(NOT_OBJECTS)("refuses %s", async (_name, body) => {
    await expectRefused(() => post("/reservations", body));
  });

  it.each([
    ...BAD_VALUES,
    ["a numeric date", { date: 20270312 }, ["date:invalid"]],
    ["a date that is not on the calendar", { date: "2027-02-30" }, ["date:invalid"]],
    ["a time with seconds", { time: "21:00:00" }, ["time:invalid"]],
    ["a null commentary", { commentary: null }, ["commentary:invalid"]],
    ["a rating of 6", { rating: 6 }, ["rating:invalid"]],
    ["two bad fields at once", { partySize: 0, foo: 1 }, ["foo:unknown", "partySize:invalid"]],
  ] as [string, object, string[]][])("refuses %s", async (_name, diff, fields) => {
    await expectRefused(() => post("/reservations", { ...booking, ...diff }), fields);
  });

  it("names every missing required field", async () => {
    await expectRefused(() => post("/reservations", {}), ["date:missing", "time:missing", "partySize:missing"]);
  });

  it("says what is wrong in the message", async () => {
    const res = await post("/reservations", { ...booking, source: "x" });
    expect(res.body.message).toBe("Unknown field: source");
  });

  it("keeps no key for a refused body, so the same key books the fixed one", async () => {
    await post("/reservations", { ...booking, source: "x" }, "k-fix");
    const res = await post("/reservations", booking, "k-fix");
    expect(res.status).toBe(200);
  });

  // The shapes the first-party clients and the known integrator send.
  it.each([
    ["date, time, partySize, guest name and contact", { ...booking, guest }],
    ["the same with commentary", { ...booking, guest, commentary: "window" }],
    ["the staff app with chosen tables", { ...booking, tables: ["2"], guest, commentary: "window" }],
    ["the staff app with no name or contact", { ...booking, guest: {} }],
    ["every field the MCP tool sends", { ...booking, tables: ["3"], zone: "", guest: { ...guest, consent: "granted" }, rating: null, commentary: "", reconfirmation: "none" }],
    ["a null dietary", { ...booking, dietary: null }],
  ])("books %s", async (_name, body) => {
    const res = await post("/reservations", body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ date: DATE, time: "21:00", partySize: 2, status: "booked" });
  });

  it("refuses the same shape once it carries source", async () => {
    await expectRefused(() => post("/reservations", { ...booking, guest, source: "partner" }), ["source:unknown"]);
  });
});

describe("POST /reservations/walk-in", () => {
  it.each(NOT_OBJECTS)("refuses %s", async (_name, body) => {
    await expectRefused(() => post("/reservations/walk-in", body));
  });

  it.each([
    ...BAD_VALUES,
    ["a numeric date", { date: 5 }, ["date:invalid"]],
    ["a numeric time", { time: 5 }, ["time:invalid"]],
    ["a null date", { date: null }, ["date:invalid"]],
    ["reconfirmation", { reconfirmation: "none" }, ["reconfirmation:unknown"]],
  ] as [string, object, string[]][])("refuses %s", async (_name, diff, fields) => {
    await expectRefused(() => post("/reservations/walk-in", { partySize: 2, ...diff }), fields);
  });

  it.each([
    ["the staff app dialog", { partySize: 2, guest: { consent: "unknown" } }],
    ["the staff app at a table", { partySize: 2, tables: ["1"], guest: { consent: "unknown" } }],
    ["the MCP tool", { partySize: 2, guest: {} }],
  ])("seats the shape of %s", async (_name, body) => {
    expect((await post("/reservations/walk-in", body)).body.status).toBe("seated");
  });
});

describe("POST /reservations/{id}/modify", () => {
  it.each(NOT_OBJECTS)("refuses %s", async (_name, body) => {
    const { id } = await booked();
    await expectRefused(() => post(`/reservations/${id}/modify`, body));
  });

  it("refuses an empty object", async () => {
    const { id } = await booked();
    await expectRefused(() => post(`/reservations/${id}/modify`, {}));
  });

  it.each([
    ["an unknown field", { foo: 1 }, ["foo:unknown"]],
    ["an unknown field next to a good one", { partySize: 3, source: "x" }, ["source:unknown"]],
    ["notifyGuest, not built", { partySize: 3, notifyGuest: false }, ["notifyGuest:unknown"]],
    ["status", { status: "seated" }, ["status:unknown"]],
    ["a guest name", { guest: { name: "New" } }, ["guest.name:unknown"]],
    ["a guest contact", { guest: { contact: "new@example.com" } }, ["guest.contact:unknown"]],
    ["a null guest", { guest: null }, ["guest:invalid"]],
    ["a party of zero", { partySize: 0 }, ["partySize:invalid"]],
    ["a negative party", { partySize: -3 }, ["partySize:invalid"]],
    ["a party as a string", { partySize: "3" }, ["partySize:invalid"]],
    ["a fractional party", { partySize: 2.5 }, ["partySize:invalid"]],
    ["a null party", { partySize: null }, ["partySize:invalid"]],
    ["null tables", { tables: null }, ["tables:invalid"]],
    ["tables as a string", { tables: "2" }, ["tables:invalid"]],
    ["a null time", { time: null }, ["time:invalid"]],
    ["a numeric date", { date: 5 }, ["date:invalid"]],
    ["a null zone", { zone: null }, ["zone:invalid"]],
  ] as [string, object, string[]][])("refuses %s", async (_name, body, fields) => {
    const { id } = await booked();
    await expectRefused(() => post(`/reservations/${id}/modify`, body), fields);
  });

  it.each([
    ["the staff app's edit dialog", { guest: { consent: "granted" }, rating: null, commentary: "" }],
    ["the staff app's table move", { tables: ["3"] }],
    ["the MCP tool's party size", { partySize: 3 }],
    ["an empty guest", { guest: {} }],
  ])("takes %s", async (_name, body) => {
    const { id } = await booked({ guest });
    expect((await post(`/reservations/${id}/modify`, body)).status).toBe(200);
  });
});

describe("a modify may repeat date, time and zone and never change them", () => {
  it("answers 200 and writes nothing when the body holds only the current values", async () => {
    const r = await booked();
    const before = await snapshot();
    const res = await post(`/reservations/${r.id}/modify`, { date: r.date, time: r.time, zone: r.zone });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ date: r.date, time: r.time, zone: r.zone, partySize: 2, version: 1 });
    expect(await snapshot()).toEqual(before);
  });

  it("applies a new party size sent with the current date and time, and asks for no version", async () => {
    const r = await booked();
    const res = await post(`/reservations/${r.id}/modify`, { date: r.date, time: r.time, partySize: 3 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ date: r.date, time: r.time, partySize: 3, version: 2 });
  });

  it.each([
    ["another date", () => ({ date: "2031-01-04" }), ["date:unchangeable"]],
    ["another time", () => ({ time: "22:00" }), ["time:unchangeable"]],
    ["another zone", () => ({ zone: "terraza" }), ["zone:unchangeable"]],
    ["another date and time", () => ({ date: "2031-01-04", time: "22:00" }), ["date:unchangeable", "time:unchangeable"]],
    ["the same time with seconds", () => ({ time: "21:00:00" }), ["time:unchangeable"]],
    ["the same time with a space", () => ({ time: " 21:00" }), ["time:unchangeable"]],
    ["the same date as a timestamp", () => ({ date: `${DATE}T00:00:00Z` }), ["date:unchangeable"]],
    ["an empty date", () => ({ date: "" }), ["date:unchangeable"]],
    ["another time next to a new party size", () => ({ date: DATE, time: "22:00", partySize: 3 }), ["time:unchangeable"]],
    ["another date next to every other field", () => ({ date: "2031-01-04", partySize: 3, tables: ["3"], commentary: "x", rating: 4 }), ["date:unchangeable"]],
  ] as [string, () => object, string[]][])("refuses %s and applies nothing else", async (_name, body, fields) => {
    const { id } = await booked();
    await expectRefused(() => post(`/reservations/${id}/modify`, body()), fields);
  });

  it("compares the zone with its case", async () => {
    await db.execute(sql`UPDATE tables SET zone = 'Terraza' WHERE venue_id = ${VENUE}`);
    const { id } = await booked({ zone: "Terraza" });
    expect((await post(`/reservations/${id}/modify`, { zone: "Terraza" })).status).toBe(200);
    await expectRefused(() => post(`/reservations/${id}/modify`, { zone: "terraza" }), ["zone:unchangeable"]);
  });

  it("compares the time as the venue reads it, not as UTC", async () => {
    const r = await booked({ time: "13:30" });
    expect((await post(`/reservations/${r.id}/modify`, { time: "13:30" })).status).toBe(200);
  });

  it("keeps the status rule for a body of current values", async () => {
    const { id } = await booked();
    await post(`/reservations/${id}/cancel`);
    const res = await post(`/reservations/${id}/modify`, { date: DATE, time: "21:00" });
    expect(res.body.code).toBe("invalid_transition");
  });

  it("answers a repeat of an applied key as before, without comparing", async () => {
    const { id } = await booked();
    const first = await post(`/reservations/${id}/modify`, { time: "21:00", partySize: 3 }, "k-applied");
    const repeat = await post(`/reservations/${id}/modify`, { time: "23:00", partySize: 3 }, "k-applied");
    expect(first.status).toBe(200);
    expect(repeat.status).toBe(200);
    expect(repeat.body).toEqual(first.body);
  });

  it("reads the booking under its row lock, so a change that commits first is the one compared", async () => {
    const { id } = await booked();
    let pending!: ReturnType<typeof post>;
    await db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE reservations SET zone = 'patio' WHERE id = ${id}`);
      pending = post(`/reservations/${id}/modify`, { zone: "" });
      // Commit only once the modify waits on the row this transaction holds.
      await expect
        .poll(async () => (await db.execute(sql`SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)).rows.length)
        .toBeGreaterThan(0);
    });
    const res = await pending;
    expect(res.body.details).toEqual({ fields: [{ path: "zone", problem: "unchangeable" }] });
  });

  it("answers reservation_not_found before it compares", async () => {
    const res = await post("/reservations/nope/modify", { time: "22:00" });
    expect(res.body.code).toBe("reservation_not_found");
  });
});

describe("POST /reservations/{id}/status", () => {
  it.each([
    ["an extra field", { status: "seated", foo: 1 }, ["foo:unknown"]],
    ["no status", {}, ["status:missing"]],
    ["a status it does not take", { status: "cancelled" }, ["status:invalid"]],
  ] as [string, object, string[]][])("refuses %s", async (_name, body, fields) => {
    const { id } = await booked();
    await expectRefused(() => post(`/reservations/${id}/status`, body), fields);
  });

  it.each(NOT_OBJECTS)("refuses %s", async (_name, body) => {
    const { id } = await booked();
    await expectRefused(() => post(`/reservations/${id}/status`, body));
  });
});

describe.each([
  ["cancel", async () => `/reservations/${(await booked()).id}/cancel`, 200],
  ["waitlist seat", async () => `/waitlist/${await waiting()}/seat`, 200],
  ["waitlist cancel", async () => `/waitlist/${await waiting()}/cancel`, 200],
])("a %s takes no field", (_route, target, ok) => {
  it.each([
    ["no body", undefined],
    ["an empty body", ""],
    ["an empty object", "{}"],
  ])("accepts %s", async (_name, body) => {
    expect((await post(await target(), body)).status).toBe(ok);
  });

  it("refuses a field and names it", async () => {
    const path = await target();
    await expectRefused(() => post(path, { reason: "x" }), ["reason:unknown"]);
  });

  it.each(NOT_OBJECTS.filter(([, body]) => body))("refuses %s", async (_name, body) => {
    const path = await target();
    await expectRefused(() => post(path, body));
  });
});

describe("POST /waitlist", () => {
  it.each(NOT_OBJECTS)("refuses %s", async (_name, body) => {
    await expectRefused(() => post("/waitlist", body));
  });

  it.each([
    ["a party of zero", { partySize: 0 }, ["partySize:invalid"]],
    ["a negative party", { partySize: -1 }, ["partySize:invalid"]],
    ["a fractional party", { partySize: 2.5 }, ["partySize:invalid"]],
    ["a party as a string", { partySize: "2" }, ["partySize:invalid"]],
    ["a party beyond the column", { partySize: 3e9 }, ["partySize:invalid"]],
    ["a date", { partySize: 2, date: DATE }, ["date:unknown"]],
    ["a guest consent", { partySize: 2, guest: { consent: "granted" } }, ["guest.consent:unknown"]],
    ["a null zone", { partySize: 2, zone: null }, ["zone:invalid"]],
    ["a null guest name", { partySize: 2, guest: { name: null } }, ["guest.name:invalid"]],
  ] as [string, object, string[]][])("refuses %s", async (_name, body, fields) => {
    await expectRefused(() => post("/waitlist", body), fields);
  });
});

describe("a refusal repeats no sent value", () => {
  it("reads ? for an unknown name that is not an identifier", async () => {
    const res = await post("/reservations", { ...booking, "lia@example.com": 1, guest: { "+34 600 111 222": 1 } });
    expect(res.body.details.fields).toEqual([
      { path: "?", problem: "unknown" },
      { path: "guest.?", problem: "unknown" },
    ]);
    expect(res.text).not.toMatch(/lia@|600/);
  });

  it("holds no guest value and no allergy value, and names nothing inside dietary", async () => {
    process.env.DIETARY = "on";
    const res = await post("/reservations", {
      ...booking,
      partySize: "Secret Party",
      guest: { name: 1234567, contact: "secret@example.com", phone: "600999888" },
      dietary: { allergens: ["peanuts"], note: "secret onion", consented: true, sesame: "secret" },
    });
    expect(res.body.details.fields.map((f: { path: string }) => f.path)).toEqual(["partySize", "guest.phone", "guest.name", "dietary"]);
    expect(res.text).not.toMatch(/secret|peanuts|onion|sesame|1234567|600999888/i);
    delete process.env.DIETARY;
  });
});

// The incident behind C94 was a schema that listed fields the route dropped, so the two lists are held together.
describe("openapi.yaml lists the fields the routes take", () => {
  const yaml = readFileSync(path.resolve(import.meta.dirname, "../../../docs/contract/openapi.yaml"), "utf8");

  /** The property names and `additionalProperties: false` of one component schema, read by indentation. */
  function schema(name: string) {
    const from = yaml.slice(yaml.indexOf(`\n    ${name}:\n`) + 1).split("\n").slice(1);
    const end = from.findIndex((line) => /^ {0,4}\S/.test(line));
    const block = from.slice(0, end).join("\n");
    const properties = block.slice(block.indexOf("\n      properties:"));
    return {
      names: [...properties.matchAll(/^ {8}([A-Za-z]+):/gm)].map((m) => m[1]).sort(),
      closed: block.includes("\n      additionalProperties: false"),
    };
  }

  const taken = (fields: object) => ({ names: Object.keys(fields).sort(), closed: true });

  it.each([
    ["ReservationCreate", taken(CREATE_FIELDS)],
    ["WalkInCreate", taken(WALK_IN_FIELDS)],
    ["ReservationModify", taken(MODIFY_FIELDS)],
    ["GuestInput", taken(CREATE_FIELDS.guest.fields!)],
    ["GuestModify", taken(MODIFY_FIELDS.guest.fields!)],
    ["WaitlistGuestInput", taken(WAITLIST_ADD_FIELDS.guest.fields!)],
  ])("%s", (name, expected) => {
    expect(schema(name)).toEqual(expected);
  });
});
