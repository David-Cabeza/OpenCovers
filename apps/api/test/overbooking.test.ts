import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, tableAllocations, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";

const DATE = "2026-11-12";
let requestCounter = 0;
let venueCounter = 0;

async function seedVenue(ceiling = 0) {
  const venueId = `ob-${++venueCounter}`;
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

function call(venueId: string, path: string, init: { key?: string; method?: string; body?: unknown } = {}) {
  return app.request(`/v1/venues/${venueId}${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: init.key ?? `write-${venueId}`,
      "content-type": "application/json",
      "Idempotency-Key": `ob-${++requestCounter}`,
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

async function fill(venueId: string, time = "21:00") {
  for (const table of ["1", "2"]) {
    const res = await book(venueId, { time, partySize: 4, tables: [table] });
    expect(res.status).toBe(200);
  }
}

async function modify(venueId: string, id: string, body: Record<string, unknown>) {
  return call(venueId, `/reservations/${id}/modify`, { method: "POST", body });
}

async function setCeiling(venueId: string, overbookingCeiling: unknown) {
  return call(venueId, "/config", { method: "PUT", key: `admin-${venueId}`, body: { overbookingCeiling } });
}

async function explain(venueId: string, time: string, partySize: number) {
  const res = await call(venueId, `/availability/explain?date=${DATE}&time=${time}&partySize=${partySize}`);
  expect(res.status).toBe(200);
  return (await res.json()) as { available: boolean; reasons: { code: string }[] };
}

async function listed(venueId: string, time: string, partySize: number) {
  const res = await call(venueId, `/availability?date=${DATE}&partySize=${partySize}`);
  const body = (await res.json()) as { availability: Record<string, { time: string; available: boolean }[]> };
  return Object.values(body.availability)
    .flat()
    .find((s) => s.time === time)?.available;
}

async function held(id: string) {
  return (await db.select().from(tableAllocations).where(eq(tableAllocations.reservationId, id))).map((a) => a.tableId);
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, guest_audit, guests, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe("overbooking ceiling setting", () => {
  it("defaults to 0 and reads back after a change", async () => {
    const venueId = await seedVenue();
    expect((await (await call(venueId, "/config")).json()).overbookingCeiling).toBe(0);
    const res = await setCeiling(venueId, 6);
    expect(res.status).toBe(200);
    expect((await res.json()).overbookingCeiling).toBe(6);
    expect((await (await call(venueId, "/config")).json()).overbookingCeiling).toBe(6);
  });

  it("keeps the value when another setting changes", async () => {
    const venueId = await seedVenue(5);
    const res = await call(venueId, "/config", { method: "PUT", key: `admin-${venueId}`, body: { leadTimeMinutes: 10 } });
    expect((await res.json()).overbookingCeiling).toBe(5);
  });

  it("rejects values that are not integers from 0 to 1000 and changes nothing", async () => {
    const venueId = await seedVenue(3);
    for (const bad of [-1, 1.5, "4", null, 1001, true]) {
      const res = await setCeiling(venueId, bad);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_request");
    }
    expect((await (await call(venueId, "/config")).json()).overbookingCeiling).toBe(3);
  });

  it("needs an admin key", async () => {
    const venueId = await seedVenue();
    const res = await call(venueId, "/config", { method: "PUT", body: { overbookingCeiling: 9 } });
    expect(res.status).toBe(403);
    expect((await (await call(venueId, "/config")).json()).overbookingCeiling).toBe(0);
  });

  it("keeps the database bound when the application is bypassed", async () => {
    const venueId = await seedVenue();
    await expect(db.update(venues).set({ overbookingCeiling: -1 }).where(eq(venues.id, venueId))).rejects.toThrow();
    await expect(db.update(venues).set({ overbookingCeiling: 1001 }).where(eq(venues.id, venueId))).rejects.toThrow();
  });
});

describe("overbooking at the default ceiling of 0", () => {
  it("refuses a booking when no table is free, as before", async () => {
    const venueId = await seedVenue();
    await fill(venueId);
    const res = await book(venueId);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("no_suitable_table");
    expect(await listed(venueId, "21:00", 2)).toBe(false);
    expect((await explain(venueId, "21:00", 2)).reasons.map((r) => r.code)).toEqual(["no_suitable_table"]);
  });

  it("refuses a modify that would leave a booking without tables", async () => {
    const venueId = await seedVenue();
    const created = await (await book(venueId)).json();
    expect(created.tables).toHaveLength(1);
    const res = await modify(venueId, created.id, { tables: [] });
    expect((await res.json()).code).toBe("no_suitable_table");
    expect(await held(created.id)).toEqual(created.tables);
  });
});

describe("overbooking with a ceiling", () => {
  it("accepts a booking without tables up to the ceiling and then refuses", async () => {
    const venueId = await seedVenue(4);
    await fill(venueId);

    const first = await book(venueId, { partySize: 3 });
    expect(first.status).toBe(200);
    const over = await first.json();
    expect(over).toMatchObject({ status: "booked", partySize: 3, tables: [], version: 1 });
    expect(await held(over.id)).toEqual([]);

    const tooMany = await book(venueId, { partySize: 2 });
    expect(tooMany.status).toBe(409);
    expect((await tooMany.json()).code).toBe("no_suitable_table");

    const last = await book(venueId, { partySize: 1 });
    expect(last.status).toBe(200);
    expect((await book(venueId, { partySize: 1 })).status).toBe(409);
  });

  it("reads the overbooked booking back with no tables on every read", async () => {
    const venueId = await seedVenue(2);
    await fill(venueId);
    const over = await (await book(venueId)).json();
    const lists = [
      (await (await call(venueId, "/reservations")).json()).reservations,
      (await (await call(venueId, `/agenda?date=${DATE}`)).json()).reservations,
    ];
    for (const list of lists) {
      expect(list.find((r: { id: string }) => r.id === over.id).tables).toEqual([]);
    }
    expect((await (await call(venueId, `/reservations/${over.id}`)).json()).tables).toEqual([]);
  });

  it("makes availability and the explanation agree with create", async () => {
    const venueId = await seedVenue(2);
    await fill(venueId);
    expect(await listed(venueId, "21:00", 2)).toBe(true);
    expect(await explain(venueId, "21:00", 2)).toMatchObject({ available: true, reasons: [], nearest: [] });
    expect(await listed(venueId, "21:00", 3)).toBe(false);
    expect((await explain(venueId, "21:00", 3)).reasons.map((r) => r.code)).toEqual(["no_suitable_table"]);

    expect((await book(venueId)).status).toBe(200);
    expect(await listed(venueId, "21:00", 1)).toBe(false);
    expect((await explain(venueId, "21:00", 1)).available).toBe(false);
  });

  it("counts only bookings that overlap the new one", async () => {
    const venueId = await seedVenue(2);
    await fill(venueId, "19:00");
    await fill(venueId, "21:00");
    expect((await book(venueId, { time: "19:00" })).status).toBe(200);
    expect((await book(venueId, { time: "19:00" })).status).toBe(409);
    expect((await book(venueId, { time: "21:00" })).status).toBe(200);
  });

  it("frees the ceiling when the overbooked booking is cancelled or over", async () => {
    const venueId = await seedVenue(2);
    await fill(venueId);
    const first = await (await book(venueId)).json();
    expect((await book(venueId)).status).toBe(409);
    expect((await call(venueId, `/reservations/${first.id}/cancel`, { method: "POST", body: {} })).status).toBe(200);
    const second = await (await book(venueId)).json();
    expect((await call(venueId, `/reservations/${second.id}/status`, { method: "POST", body: { status: "no_show" } })).status).toBe(200);
    expect((await book(venueId)).status).toBe(200);
  });

  it("keeps a party larger than the venue an error", async () => {
    const venueId = await seedVenue(50);
    const res = await book(venueId, { partySize: 9 });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("party_size_too_large");
  });

  it("keeps naming a taken table a conflict", async () => {
    const venueId = await seedVenue(50);
    await fill(venueId);
    const res = await book(venueId, { tables: ["1"] });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("slot_taken");
  });

  it("never overbooks a walk-in", async () => {
    const venueId = await seedVenue(50);
    await fill(venueId);
    const res = await call(venueId, "/reservations/walk-in", {
      method: "POST",
      body: { date: DATE, time: "21:00", partySize: 2 },
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("no_suitable_table");
  });

  it("keeps one venue's ceiling out of another", async () => {
    const open = await seedVenue(4);
    const closed = await seedVenue(0);
    await fill(open);
    await fill(closed);
    expect((await book(open)).status).toBe(200);
    expect((await book(closed)).status).toBe(409);
  });

  it("never exceeds the ceiling under concurrent creates", async () => {
    const venueId = await seedVenue(4);
    await fill(venueId);
    const results = await Promise.all(Array.from({ length: 8 }, () => book(venueId)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 409, 409, 409, 409, 409, 409]);
    const list = (await (await call(venueId, "/reservations")).json()).reservations as { tables: string[]; partySize: number }[];
    const unseated = list.filter((r) => r.tables.length === 0).reduce((sum, r) => sum + r.partySize, 0);
    expect(unseated).toBe(4);
  });

  it("replays an idempotent create without taking more of the ceiling", async () => {
    const venueId = await seedVenue(2);
    await fill(venueId);
    const send = () =>
      app.request(`/v1/venues/${venueId}/reservations`, {
        method: "POST",
        headers: { apikey: `write-${venueId}`, "content-type": "application/json", "Idempotency-Key": "replay-1" },
        body: JSON.stringify({ date: DATE, time: "21:00", partySize: 2 }),
      });
    const first = await (await send()).json();
    const second = await (await send()).json();
    expect(second.id).toBe(first.id);
  });
});

describe("overbooked bookings and the tables", () => {
  it("assigns a table through modify only where the database allows it", async () => {
    const venueId = await seedVenue(2);
    await fill(venueId);
    const over = await (await book(venueId)).json();

    const taken = await modify(venueId, over.id, { tables: ["1"] });
    expect(taken.status).toBe(409);
    expect((await taken.json()).code).toBe("slot_taken");
    expect(await held(over.id)).toEqual([]);

    const all = (await (await call(venueId, "/reservations")).json()).reservations as { id: string; tables: string[] }[];
    const holder = all.find((r) => r.tables.includes("1"))!;
    expect((await call(venueId, `/reservations/${holder.id}/cancel`, { method: "POST", body: {} })).status).toBe(200);

    const assigned = await modify(venueId, over.id, { tables: ["1"] });
    expect(assigned.status).toBe(200);
    expect((await assigned.json())).toMatchObject({ tables: ["1"], version: 2 });
    expect(await held(over.id)).toEqual(["1"]);
  });

  it("keeps the exclusion constraint in force for a held table", async () => {
    const venueId = await seedVenue(2);
    await fill(venueId);
    const over = await (await book(venueId)).json();
    await expect(
      db.insert(tableAllocations).values({
        reservationId: over.id,
        venueId,
        tableId: "1",
        startsAt: new Date("2026-11-12T20:00:00Z"),
        endsAt: new Date("2026-11-12T22:00:00Z"),
      }),
    ).rejects.toThrow();
  });

  it("limits a party size increase on a booking without tables", async () => {
    const venueId = await seedVenue(3);
    await fill(venueId);
    const over = await (await book(venueId)).json();
    const tooBig = await modify(venueId, over.id, { partySize: 4 });
    expect((await tooBig.json()).code).toBe("no_suitable_table");
    const ok = await modify(venueId, over.id, { partySize: 3 });
    expect(ok.status).toBe(200);
    expect((await ok.json()).partySize).toBe(3);
    expect((await modify(venueId, over.id, { partySize: 1 })).status).toBe(200);
  });

  it("lets a booking give up its tables within the ceiling and not beyond it", async () => {
    const venueId = await seedVenue(3);
    const created = await (await book(venueId)).json();
    const released = await modify(venueId, created.id, { tables: [] });
    expect(released.status).toBe(200);
    expect(await released.json()).toMatchObject({ tables: [], version: 2 });

    const second = await (await book(venueId, { partySize: 2 })).json();
    const refused = await modify(venueId, second.id, { tables: [] });
    expect((await refused.json()).code).toBe("no_suitable_table");
    expect(await held(second.id)).toEqual(second.tables);
  });

  it("refuses to seat a booking that has no table", async () => {
    const venueId = await seedVenue(2);
    await fill(venueId);
    const over = await (await book(venueId)).json();
    const res = await call(venueId, `/reservations/${over.id}/status`, { method: "POST", body: { status: "seated" } });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("table_required");
    expect((await book(venueId)).status).toBe(409);
  });
});
