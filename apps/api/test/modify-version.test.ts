// C87, the part that is built: a staff modify that sends `version` writes only over the version it names.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { saturdayAhead } from "./dates";

const VENUE = "modify-version";
const KEY = `${VENUE}-writer`;
const DATE = saturdayAhead();

beforeAll(async () => {
  process.env.DIETARY = "on";
  await migrateDb();
});

afterAll(() => {
  delete process.env.DIETARY;
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE events, tombstones, idempotency_keys, table_allocations, reservations, waitlist, guests, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
  await db.insert(venues).values({ id: VENUE, name: "Casa Version", timezone: "Europe/Madrid" });
  await db.insert(services).values({ venueId: VENUE, name: "all", openStart: "00:00", openEnd: "23:59" });
  await db.insert(tables).values(["1", "2", "3"].map((id) => ({ id, venueId: VENUE, name: id, seats: 4 })));
  await addKey(db, KEY, "staff", [VENUE], "write");
});

async function post(path: string, body?: unknown, key: string = crypto.randomUUID()) {
  const res = await app.request(`/v1/venues/${VENUE}${path}`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json", "Idempotency-Key": key },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const modify = (id: string, body: object, key?: string) => post(`/reservations/${id}/modify`, body, key);

async function booked(extra: object = {}): Promise<{ id: string; version: number }> {
  const res = await post("/reservations", { date: DATE, time: "21:00", partySize: 2, tables: ["1"], ...extra });
  expect(res.status).toBe(200);
  return res.body;
}

/** Every row a modify can touch. */
async function snapshot(): Promise<unknown[]> {
  const rows = [];
  for (const table of ["reservations", "table_allocations", "idempotency_keys", "events"]) {
    rows.push((await db.execute(sql.raw(`SELECT t::text AS row FROM ${table} t ORDER BY 1`))).rows);
  }
  return rows;
}

async function expectChanged(send: () => ReturnType<typeof post>) {
  const before = await snapshot();
  const res = await send();
  expect(res.status).toBe(409);
  expect(res.body).toMatchObject({ code: "reservation_changed", retryable: false });
  expect(await snapshot()).toEqual(before);
}

const lockWaiters = async () =>
  (await db.execute(sql`SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)).rows.length;

/** Sends both while the row is held, so both are in flight before either can compare. */
async function together(id: string, send: () => ReturnType<typeof post>[]) {
  let pending!: ReturnType<typeof post>[];
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM reservations WHERE id = ${id} FOR UPDATE`);
    pending = send();
    await expect.poll(lockWaiters).toBe(pending.length);
  });
  return Promise.all(pending);
}

describe("POST /reservations/{id}/modify with version", () => {
  it("writes when the version is the stored one", async () => {
    const { id } = await booked();
    const res = await modify(id, { partySize: 3, version: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ partySize: 3, version: 2 });
  });

  it.each([
    ["party size", { partySize: 3 }],
    ["tables", { tables: ["2"] }],
    ["the note", { commentary: "window" }],
  ])("refuses a stale change of %s and writes nothing", async (_name, change) => {
    const { id } = await booked();
    expect((await modify(id, { rating: 5 })).body.version).toBe(2);
    await expectChanged(() => modify(id, { ...change, version: 1 }));
  });

  it("refuses a version the booking has not reached", async () => {
    const { id } = await booked();
    await expectChanged(() => modify(id, { partySize: 3, version: 2 }));
  });

  it("stores no key for a refusal, so the same key writes with the version read again", async () => {
    const { id } = await booked();
    await modify(id, { rating: 5 });
    await expectChanged(() => modify(id, { partySize: 3, version: 1 }, "retry"));
    const res = await modify(id, { partySize: 3, version: 2 }, "retry");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ partySize: 3, rating: 5, version: 3 });
  });

  it("answers a repeat of a key as the booking reads now, whatever version it carries", async () => {
    const { id } = await booked();
    expect((await modify(id, { partySize: 3, version: 1 }, "once")).body.version).toBe(2);
    await modify(id, { partySize: 4 });
    const before = await snapshot();
    for (const version of [1, 99]) {
      const res = await modify(id, { partySize: 3, version }, "once");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ partySize: 4, version: 3 });
    }
    expect(await snapshot()).toEqual(before);
  });

  it("checks the version of a modify that would change nothing", async () => {
    const { id } = await booked();
    await modify(id, { rating: 5 });
    await expectChanged(() => modify(id, { partySize: 2, version: 1 }));
    const res = await modify(id, { partySize: 2, version: 2 });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
  });

  it("answers reservation_not_found before it compares", async () => {
    const res = await modify("nope", { partySize: 3, version: 1 });
    expect(res.body.code).toBe("reservation_not_found");
  });

  it("answers reservation_changed before invalid_transition and before a restated value", async () => {
    const { id } = await booked();
    expect((await post(`/reservations/${id}/cancel`)).status).toBe(200);
    await expectChanged(() => modify(id, { partySize: 3, version: 1 }));
    expect((await modify(id, { partySize: 3, version: 2 })).body.code).toBe("invalid_transition");

    const other = await booked({ tables: ["2"] });
    await modify(other.id, { rating: 5 });
    await expectChanged(() => modify(other.id, { time: "22:00", version: 1 }));
    const res = await modify(other.id, { time: "22:00", version: 2 });
    expect(res.body.details).toEqual({ fields: [{ path: "time", problem: "unchangeable" }] });
  });

  it("holds a dietary withdrawal to the version it names, on any status", async () => {
    const { id } = await booked({ dietary: { allergens: ["eggs"], consented: true } });
    expect((await post(`/reservations/${id}/cancel`)).status).toBe(200);
    await expectChanged(() => modify(id, { dietary: null, version: 1 }));
    const res = await modify(id, { dietary: null, version: 2 });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(3);
    expect(res.body).not.toHaveProperty("dietary");
  });

  it("refuses a body that holds only a version", async () => {
    const { id } = await booked();
    const before = await snapshot();
    const res = await modify(id, { version: 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_request");
    expect(res.body.details).toBeUndefined();
    expect(await snapshot()).toEqual(before);
  });

  it.each([0, -1, 1.5, "1", null])("refuses the version %j", async (version) => {
    const { id } = await booked();
    const before = await snapshot();
    const res = await modify(id, { partySize: 3, version });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual({ fields: [{ path: "version", problem: "invalid" }] });
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    ["party size and note", { partySize: 3 }, { commentary: "window" }],
    ["two tables", { tables: ["2"] }, { tables: ["3"] }],
  ])("lets exactly one of two concurrent modifies with one version write (%s)", async (_name, first, second) => {
    const { id } = await booked();
    const answers = await together(id, () => [modify(id, { ...first, version: 1 }), modify(id, { ...second, version: 1 })]);
    expect(answers.map((a) => a.status).sort()).toEqual([200, 409]);
    expect(answers.find((a) => a.status === 409)!.body.code).toBe("reservation_changed");
    const winner = answers[0].status === 200 ? first : second;
    const stored = await db.execute(sql`SELECT version, party_size, commentary FROM reservations WHERE id = ${id}`);
    expect(stored.rows[0]).toEqual({
      version: 2,
      party_size: "partySize" in winner ? winner.partySize : 2,
      commentary: "commentary" in winner ? winner.commentary : "",
    });
    const held = await db.execute(sql`SELECT table_id FROM table_allocations WHERE reservation_id = ${id}`);
    expect(held.rows).toEqual(("tables" in winner ? winner.tables : ["1"]).map((table_id) => ({ table_id })));
    const modified = await db.execute(sql`SELECT version FROM events WHERE reservation_id = ${id} AND type = 'modified'`);
    expect(modified.rows).toEqual([{ version: 2 }]);
  });
});
