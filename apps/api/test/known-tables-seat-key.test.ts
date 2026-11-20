import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { events, reservations, services, tableAllocations, tables, venues, waitlist } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { addWaitlist, seatWaitlist } from "../src/lib/waitlist";

const A = "kt-a";
const B = "kt-b";
const DATE = "2026-11-12";
let n = 0;

function post(venueId: string, path: string, body: unknown, key = `kt-${++n}`) {
  return app.request(`/v1/venues/${venueId}${path}`, {
    method: "POST",
    headers: { apikey: `key-${venueId}`, "content-type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}

const create = (venueId: string, extra: Record<string, unknown>, time = "20:00") =>
  post(venueId, "/reservations", { date: DATE, time, partySize: 2, ...extra });

const allocationCount = async (venueId: string) =>
  (await db.select().from(tableAllocations).where(eq(tableAllocations.venueId, venueId))).length;
const eventCount = async (venueId: string) =>
  (await db.select().from(events).where(eq(events.venueId, venueId))).length;

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
  for (const v of [A, B]) {
    await db.insert(venues).values({ id: v, timezone: "Europe/Madrid" });
    await db.insert(services).values([{ venueId: v, name: "all", openStart: "00:00", openEnd: "24:00" }]);
    await db.insert(tables).values([
      { id: v === A ? "1" : "9", venueId: v, name: "T1", seats: 4 },
      { id: v === A ? "2" : "8", venueId: v, name: "T2", seats: 4 },
    ]);
    await addKey(db, `key-${v}`, `p-${v}`, [v], "write");
  }
});

describe("explicit table ids", () => {
  it("refuses an unknown table on create and writes nothing", async () => {
    const res = await create(A, { tables: ["1", "nope"], partySize: 4 });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
    expect(await allocationCount(A)).toBe(0);
    expect(await eventCount(A)).toBe(0);
  });

  it("refuses duplicate ids with a 400, not a 500", async () => {
    const res = await create(A, { tables: ["1", "1"], partySize: 4 });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
  });

  it("treats another venue's table as unknown", async () => {
    const res = await create(A, { tables: ["9"] });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
  });

  it("accepts known tables of the venue", async () => {
    const res = await create(A, { tables: ["1", "2"], partySize: 6 }, "21:00");
    expect(res.status).toBe(200);
    expect((await res.json()).tables).toEqual(["1", "2"]);
  });

  it("refuses unknown, duplicate and foreign tables on modify and keeps the booking", async () => {
    const made = await create(A, { tables: ["1"] }, "18:00");
    expect(made.status).toBe(200);
    const { id } = await made.json();
    for (const bad of [["ghost"], ["2", "2"], ["9"]]) {
      const res = await post(A, `/reservations/${id}/modify`, { tables: bad });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_request");
    }
    const rows = await db.select().from(tableAllocations).where(eq(tableAllocations.reservationId, id));
    expect(rows.map((r) => r.tableId)).toEqual(["1"]);
    const ok = await post(A, `/reservations/${id}/modify`, { tables: ["2"] });
    expect(ok.status).toBe(200);
    expect((await ok.json()).tables).toEqual(["2"]);
  });
});

describe("waitlist seat with a key that already made a create", () => {
  it("refuses a foreign create key and leaves the entry waiting", async () => {
    const made = await create(B, {}, "19:00");
    expect(made.status).toBe(200);
    const old = await made.json();
    const key = "foreign-create-key";
    const first = await create(B, { tables: ["8"] }, "17:00");
    expect(first.status).toBe(200);
    // the key below belongs to an unrelated create
    const keyed = await post(B, "/reservations", { date: DATE, time: "22:00", partySize: 2 }, key);
    expect(keyed.status).toBe(200);
    const unrelated = await keyed.json();

    const added = await addWaitlist(db, B, { partySize: 2, guestName: "Ana" });
    if (!added.ok) throw new Error("add failed");
    const before = await eventCount(B);
    const res = await post(B, `/waitlist/${added.id}/seat`, {}, key);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
    const row = (await db.select().from(waitlist).where(eq(waitlist.id, added.id)))[0];
    expect(row.status).toBe("waiting");
    expect(row.reservationId).toBeNull();
    expect(await eventCount(B)).toBe(before);
    expect(old.id).not.toBe(unrelated.id);
  });

  it("still replays a genuine seat with its own key", async () => {
    const added = await addWaitlist(db, B, { partySize: 2, guestName: "Bea" });
    if (!added.ok) throw new Error("add failed");
    const one = await post(B, `/waitlist/${added.id}/seat`, {}, "own-seat-key");
    expect(one.status).toBe(200);
    const again = await post(B, `/waitlist/${added.id}/seat`, {}, "own-seat-key");
    expect(again.status).toBe(200);
    expect((await again.json()).id).toBe((await one.json()).id);
    const seatedRows = await db
      .select()
      .from(reservations)
      .where(and(eq(reservations.venueId, B), eq(reservations.id, (await db.select().from(waitlist).where(eq(waitlist.id, added.id)))[0].reservationId!)));
    expect(seatedRows).toHaveLength(1);
    expect(await seatWaitlist(db, B, added.id, "own-seat-key", null)).toMatchObject({ ok: true });
  });
});
