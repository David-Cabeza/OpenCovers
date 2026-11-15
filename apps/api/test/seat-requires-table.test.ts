import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { events, reservations, services, tableAllocations, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";

const DATE = "2026-11-12";
let requestCounter = 0;
let venueCounter = 0;

async function seedVenue(ceiling = 2) {
  const venueId = `st-${++venueCounter}`;
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid", overbookingCeiling: ceiling });
  await db.insert(services).values([{ venueId, name: "dinner", openStart: "19:00", openEnd: "23:00" }]);
  await db.insert(tables).values([
    { id: "1", venueId, name: "T1", seats: 4 },
    { id: "2", venueId, name: "T2", seats: 4 },
  ]);
  await addKey(db, `write-${venueId}`, "writer", [venueId], "write");
  await addKey(db, `admin-${venueId}`, "boss", [venueId], "admin");
  return venueId;
}

function call(venueId: string, path: string, init: { key?: string; method?: string; body?: unknown; idem?: string } = {}) {
  return app.request(`/v1/venues/${venueId}${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: init.key ?? `write-${venueId}`,
      "content-type": "application/json",
      "Idempotency-Key": init.idem ?? `st-${++requestCounter}`,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function book(venueId: string, body: Record<string, unknown> = {}) {
  return call(venueId, "/reservations", {
    method: "POST",
    body: { date: DATE, time: "21:00", partySize: 2, ...body },
  });
}

async function fill(venueId: string) {
  for (const table of ["1", "2"]) {
    const res = await book(venueId, { partySize: 4, tables: [table] });
    expect(res.status).toBe(200);
  }
}

async function overbooked(venueId: string) {
  await fill(venueId);
  const res = await book(venueId);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.tables).toEqual([]);
  return body as { id: string; version: number };
}

function post(venueId: string, id: string, action: "status" | "modify" | "cancel", body: unknown = {}, idem?: string) {
  return call(venueId, `/reservations/${id}/${action}`, { method: "POST", body, idem });
}

function seat(venueId: string, id: string, idem?: string) {
  return post(venueId, id, "status", { status: "seated" }, idem);
}

async function held(id: string) {
  return (await db.select().from(tableAllocations).where(eq(tableAllocations.reservationId, id))).map((a) => a.tableId);
}

async function rowOf(id: string) {
  return (await db.select().from(reservations).where(eq(reservations.id, id)))[0];
}

async function eventCount(id: string, type: string) {
  return (await db.select().from(events).where(and(eq(events.reservationId, id), eq(events.type, type)))).length;
}

async function freeTable(venueId: string, tableId: string) {
  const all = (await (await call(venueId, "/reservations")).json()).reservations as { id: string; tables: string[] }[];
  const holder = all.find((r) => r.tables.includes(tableId))!;
  expect((await post(venueId, holder.id, "cancel")).status).toBe(200);
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, guest_audit, guests, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe("seating needs a table", () => {
  it("refuses to seat an overbooked booking and changes nothing", async () => {
    const venueId = await seedVenue();
    const over = await overbooked(venueId);
    const res = await seat(venueId, over.id);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("table_required");
    const row = await rowOf(over.id);
    expect(row.status).toBe("booked");
    expect(row.version).toBe(over.version);
    expect(await eventCount(over.id, "seated")).toBe(0);
    expect(await held(over.id)).toEqual([]);
  });

  it("seats once staff assign a free table", async () => {
    const venueId = await seedVenue();
    const over = await overbooked(venueId);
    await freeTable(venueId, "1");
    const assigned = await post(venueId, over.id, "modify", { tables: ["1"] });
    expect(assigned.status).toBe(200);
    const res = await seat(venueId, over.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "seated", tables: ["1"] });
    expect(await held(over.id)).toEqual(["1"]);
  });

  it("refuses a table another booking holds, through the exclusion constraint", async () => {
    const venueId = await seedVenue();
    const over = await overbooked(venueId);
    const taken = await post(venueId, over.id, "modify", { tables: ["1"] });
    expect(taken.status).toBe(409);
    expect((await taken.json()).code).toBe("slot_taken");
    expect(await held(over.id)).toEqual([]);
    const res = await seat(venueId, over.id);
    expect((await res.json()).code).toBe("table_required");
  });

  it("still seats a booked reservation that holds tables", async () => {
    const venueId = await seedVenue();
    const created = await (await book(venueId)).json();
    expect(created.tables).toHaveLength(1);
    const res = await seat(venueId, created.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "seated", version: 2, tables: created.tables });
  });

  it("keeps a walk-in seated immediately with its tables", async () => {
    const venueId = await seedVenue();
    const auto = await call(venueId, "/reservations/walk-in", { method: "POST", body: { date: DATE, time: "21:00", partySize: 2 } });
    expect(auto.status).toBe(200);
    const autoBody = await auto.json();
    expect(autoBody.status).toBe("seated");
    expect(autoBody.tables).toHaveLength(1);
    const named = await call(venueId, "/reservations/walk-in", {
      method: "POST",
      body: { date: DATE, time: "21:00", partySize: 2, tables: [autoBody.tables[0] === "1" ? "2" : "1"] },
    });
    expect(named.status).toBe(200);
    expect(await named.json()).toMatchObject({ status: "seated" });
  });

  it("leaves attended and no_show unchanged", async () => {
    const venueId = await seedVenue();
    const over = await overbooked(venueId);
    const noShow = await post(venueId, over.id, "status", { status: "no_show" });
    expect(noShow.status).toBe(200);
    expect(await noShow.json()).toMatchObject({ status: "no_show" });

    const normal = await (await book(venueId, { time: "19:00" })).json();
    expect((await seat(venueId, normal.id)).status).toBe(200);
    const attended = await post(venueId, normal.id, "status", { status: "attended" });
    expect(attended.status).toBe(200);
    expect(await attended.json()).toMatchObject({ status: "attended" });

    const early = await (await book(venueId, { time: "19:00" })).json();
    const skipped = await post(venueId, early.id, "status", { status: "attended" });
    expect((await skipped.json()).code).toBe("invalid_transition");
  });

  it("reports invalid_transition before table_required", async () => {
    const venueId = await seedVenue();
    const over = await overbooked(venueId);
    expect((await post(venueId, over.id, "cancel")).status).toBe(200);
    const res = await seat(venueId, over.id);
    expect((await res.json()).code).toBe("invalid_transition");
  });

  it("replays a seat with the same key without a second write", async () => {
    const venueId = await seedVenue();
    const created = await (await book(venueId)).json();
    const first = await (await seat(venueId, created.id, "seat-once")).json();
    const again = await seat(venueId, created.id, "seat-once");
    expect(again.status).toBe(200);
    expect((await again.json()).version).toBe(first.version);
    expect(await eventCount(created.id, "seated")).toBe(1);
  });

  it("lets a refused seat retry under the same key once a table is assigned", async () => {
    const venueId = await seedVenue();
    const over = await overbooked(venueId);
    const refused = await seat(venueId, over.id, "seat-retry");
    expect((await refused.json()).code).toBe("table_required");
    await freeTable(venueId, "2");
    expect((await post(venueId, over.id, "modify", { tables: ["2"] })).status).toBe(200);
    const retried = await seat(venueId, over.id, "seat-retry");
    expect(retried.status).toBe(200);
    expect(await eventCount(over.id, "seated")).toBe(1);
  });

  it("keeps a seated booking from giving up its last table", async () => {
    const venueId = await seedVenue();
    const created = await (await book(venueId)).json();
    expect((await seat(venueId, created.id)).status).toBe(200);
    const res = await post(venueId, created.id, "modify", { tables: [] });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("table_required");
    expect(await held(created.id)).toEqual(created.tables);
    expect((await rowOf(created.id)).version).toBe(2);
  });

  it("keeps a booked reservation able to give up its tables within the ceiling", async () => {
    const venueId = await seedVenue();
    const created = await (await book(venueId)).json();
    const res = await post(venueId, created.id, "modify", { tables: [] });
    expect(res.status).toBe(200);
    expect(await held(created.id)).toEqual([]);
  });
});
