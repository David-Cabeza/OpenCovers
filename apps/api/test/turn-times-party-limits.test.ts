import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { createReservation } from "../src/lib/reservations";

const DATE = "2026-11-12";
const BEFORE_THE_DAY = new Date("2026-11-10T12:00:00Z");
const TURN_TIMES = [
  { upTo: 2, minutes: 90 },
  { upTo: 4, minutes: 120 },
  { upTo: 8, minutes: 150 },
];

let requestCounter = 0;

type Reason = { code: string; message: string; details: Record<string, unknown> };

async function seedVenue(
  venueId: string,
  seats: number[],
  config: { leadTimeMinutes?: number; lastSeatingOffsetMinutes?: number } = {},
) {
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid", ...config });
  await db.insert(services).values([
    { venueId, name: "lunch", openStart: "12:00", openEnd: "16:00" },
    { venueId, name: "dinner", openStart: "19:00", openEnd: "23:00" },
  ]);
  await db.insert(tables).values(seats.map((s, i) => ({ id: String(i + 1), venueId, name: `T${i + 1}`, seats: s })));
  await addKey(db, `read-${venueId}`, "reader", [venueId], "read");
  await addKey(db, `write-${venueId}`, "writer", [venueId], "write");
  await addKey(db, `admin-${venueId}`, "owner", [venueId], "admin");
}

function call(venueId: string, path: string, init: { key?: string; method?: string; body?: unknown } = {}) {
  return app.request(`/v1/venues/${venueId}${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: init.key ?? `read-${venueId}`,
      "content-type": "application/json",
      "Idempotency-Key": `turn-${++requestCounter}`,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function setConfig(venueId: string, body: Record<string, unknown>, key = `admin-${venueId}`) {
  return call(venueId, "/config", { key, method: "PUT", body });
}

async function getConfig(venueId: string) {
  const res = await call(venueId, "/config");
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

async function setService(venueId: string, body: Record<string, unknown>, key = `admin-${venueId}`) {
  return call(venueId, "/services", {
    key,
    method: "POST",
    body: { name: "dinner", openStart: "19:00", openEnd: "23:00", ...body },
  });
}

async function listServices(venueId: string) {
  const res = await call(venueId, "/services");
  expect(res.status).toBe(200);
  return ((await res.json()) as { services: Record<string, unknown>[] }).services;
}

async function book(venueId: string, time: string, partySize: number) {
  const res = await call(venueId, "/reservations", {
    key: `write-${venueId}`,
    method: "POST",
    body: { date: DATE, time, partySize },
  });
  return { status: res.status, body: (await res.json()) as { id?: string; code?: string } };
}

async function walkIn(venueId: string, time: string, partySize: number) {
  const res = await call(venueId, "/reservations/walk-in", {
    key: `write-${venueId}`,
    method: "POST",
    body: { date: DATE, time, partySize },
  });
  return { status: res.status, body: (await res.json()) as { id?: string; code?: string; status?: string } };
}

async function cancel(venueId: string, id: string | undefined) {
  const res = await call(venueId, `/reservations/${id}/cancel`, { key: `write-${venueId}`, method: "POST" });
  expect(res.status).toBe(200);
}

async function availableTimes(venueId: string, partySize: number) {
  const res = await call(venueId, `/availability?date=${DATE}&partySize=${partySize}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { availability: Record<string, { time: string; available: boolean }[]> };
  return Object.values(body.availability)
    .flat()
    .filter((s) => s.available)
    .map((s) => s.time);
}

async function explain(venueId: string, time: string, partySize: number) {
  const res = await call(venueId, `/availability/explain?date=${DATE}&time=${time}&partySize=${partySize}`);
  expect(res.status).toBe(200);
  return (await res.json()) as { available: boolean; reasons: Reason[]; nearest: string[] };
}

async function firstFreeAfter(venueId: string, time: string) {
  return (await availableTimes(venueId, 1)).filter((t) => t > time).sort()[0];
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, guest_audit, guests, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

function setClock(now: Date) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
}

describe("turn time by party size", () => {
  it("holds the table for the turn time of the party size at each boundary", async () => {
    setClock(BEFORE_THE_DAY);
    const venueId = "tt-boundaries";
    await seedVenue(venueId, [10]);
    expect((await setConfig(venueId, { turnTimes: TURN_TIMES })).status).toBe(200);

    const expected: [number, string][] = [
      [1, "21:30"],
      [2, "21:30"],
      [3, "22:00"],
      [4, "22:00"],
      [5, "22:30"],
      [8, "22:30"],
      [9, "22:30"],
      [10, "22:30"],
    ];
    for (const [partySize, freeAt] of expected) {
      const created = await book(venueId, "20:00", partySize);
      expect(created.status, `party ${partySize}`).toBe(200);
      expect(await firstFreeAfter(venueId, "20:00"), `party ${partySize}`).toBe(freeAt);
      const [hh, mm] = freeAt.split(":").map(Number);
      const justBefore = `${String(mm === 0 ? hh - 1 : hh).padStart(2, "0")}:${mm === 0 ? "45" : String(mm - 15).padStart(2, "0")}`;
      expect((await book(venueId, justBefore, 1)).body.code, `party ${partySize}`).toBe("no_suitable_table");
      const after = await book(venueId, freeAt, 1);
      expect(after.status, `party ${partySize}`).toBe(200);
      await cancel(venueId, after.body.id);
      await cancel(venueId, created.body.id);
    }
  });

  it("keeps the fixed duration of 120 minutes for a venue with no turn times", async () => {
    setClock(BEFORE_THE_DAY);
    const venueId = "tt-none";
    await seedVenue(venueId, [10]);
    expect(await getConfig(venueId)).not.toHaveProperty("turnTimes");
    for (const partySize of [1, 4, 10]) {
      const created = await book(venueId, "20:00", partySize);
      expect(created.status).toBe(200);
      expect(await firstFreeAfter(venueId, "20:00"), `party ${partySize}`).toBe("22:00");
      await cancel(venueId, created.body.id);
    }
  });

  it("sizes the requested booking by its own party, so a big party needs the longer gap", async () => {
    setClock(BEFORE_THE_DAY);
    const venueId = "tt-request";
    await seedVenue(venueId, [10]);
    expect((await setConfig(venueId, { turnTimes: TURN_TIMES })).status).toBe(200);
    expect((await book(venueId, "22:00", 2)).status).toBe(200);

    expect((await explain(venueId, "20:30", 2)).available).toBe(true);
    expect((await explain(venueId, "20:00", 8)).available).toBe(false);
    expect((await explain(venueId, "19:30", 8)).available).toBe(true);
    const listedBig = await availableTimes(venueId, 8);
    expect(listedBig).toContain("19:30");
    expect(listedBig).not.toContain("19:45");
    const listedSmall = await availableTimes(venueId, 2);
    expect(listedSmall).toContain("20:30");
    expect(listedSmall).not.toContain("20:45");

    expect((await book(venueId, "19:45", 8)).body.code).toBe("no_suitable_table");
    expect((await book(venueId, "20:30", 2)).status).toBe(200);
  });

  it("lets an explicit duration win over the turn time", async () => {
    setClock(BEFORE_THE_DAY);
    const venueId = "tt-explicit";
    await seedVenue(venueId, [10]);
    expect((await setConfig(venueId, { turnTimes: TURN_TIMES })).status).toBe(200);
    const created = await createReservation(
      db,
      venueId,
      { date: DATE, time: "20:00", durationMinutes: 60, partySize: 8 },
      "explicit-1",
    );
    expect(created.ok).toBe(true);
    expect(await firstFreeAfter(venueId, "20:00")).toBe("21:00");
  });

  it("gives a walk-in the turn time of its party size", async () => {
    setClock(BEFORE_THE_DAY);
    const venueId = "tt-walkin";
    await seedVenue(venueId, [10]);
    expect((await setConfig(venueId, { turnTimes: TURN_TIMES })).status).toBe(200);
    for (const [partySize, freeAt] of [
      [2, "21:30"],
      [6, "22:30"],
    ] as [number, string][]) {
      const seated = await walkIn(venueId, "20:00", partySize);
      expect(seated.status).toBe(200);
      expect(seated.body.status).toBe("seated");
      expect(await firstFreeAfter(venueId, "20:00"), `party ${partySize}`).toBe(freeAt);
      await cancel(venueId, seated.body.id);
    }
  });

  it("returns to the fixed duration once the turn times are cleared", async () => {
    setClock(BEFORE_THE_DAY);
    const venueId = "tt-clear";
    await seedVenue(venueId, [10]);
    const set = await setConfig(venueId, { turnTimes: TURN_TIMES });
    expect(((await set.json()) as Record<string, unknown>).turnTimes).toEqual(TURN_TIMES);
    expect((await getConfig(venueId)).turnTimes).toEqual(TURN_TIMES);
    expect((await setConfig(venueId, { leadTimeMinutes: 0 })).status).toBe(200);
    expect((await getConfig(venueId)).turnTimes).toEqual(TURN_TIMES);

    const cleared = await setConfig(venueId, { turnTimes: [] });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).not.toHaveProperty("turnTimes");
    expect(await getConfig(venueId)).not.toHaveProperty("turnTimes");
    expect((await book(venueId, "20:00", 2)).status).toBe(200);
    expect(await firstFreeAfter(venueId, "20:00")).toBe("22:00");
  });
});

describe("party size limits per service", () => {
  it("rejects a party below the minimum and clears the limit with null", async () => {
    setClock(BEFORE_THE_DAY);
    const venueId = "pl-min";
    await seedVenue(venueId, [2, 4, 6]);
    expect((await setService(venueId, { minPartySize: 2 })).status).toBe(200);
    expect(await listServices(venueId)).toEqual([
      { name: "lunch", openStart: "12:00", openEnd: "16:00" },
      { name: "dinner", openStart: "19:00", openEnd: "23:00", minPartySize: 2 },
    ]);

    const rejected = await book(venueId, "20:00", 1);
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe("party_size_too_small");
    expect(await availableTimes(venueId, 1)).not.toContain("20:00");
    expect((await explain(venueId, "20:00", 1)).reasons).toEqual([
      {
        code: "party_size_too_small",
        message: expect.any(String),
        details: { rule: "service_limit", service: "dinner", partySize: 1, minPartySize: 2 },
      },
    ]);
    expect((await book(venueId, "13:00", 1)).status).toBe(200);
    expect((await book(venueId, "20:00", 2)).status).toBe(200);

    expect((await setService(venueId, { minPartySize: null })).status).toBe(200);
    expect((await listServices(venueId))[1]).toEqual({ name: "dinner", openStart: "19:00", openEnd: "23:00" });
    expect((await book(venueId, "20:15", 1)).status).toBe(200);
  });

  it("rejects a party above the maximum and clears the limit with null", async () => {
    setClock(BEFORE_THE_DAY);
    const venueId = "pl-max";
    await seedVenue(venueId, [2, 4, 6]);
    expect((await setService(venueId, { maxPartySize: 6 })).status).toBe(200);

    const rejected = await book(venueId, "20:00", 7);
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe("party_size_too_large");
    expect(await availableTimes(venueId, 7)).not.toContain("20:00");
    expect(await availableTimes(venueId, 7)).toContain("13:00");
    expect((await explain(venueId, "20:00", 7)).reasons).toEqual([
      {
        code: "party_size_too_large",
        message: expect.any(String),
        details: { rule: "service_limit", service: "dinner", partySize: 7, maxPartySize: 6 },
      },
    ]);

    expect((await setService(venueId, { maxPartySize: null })).status).toBe(200);
    expect((await book(venueId, "20:00", 7)).status).toBe(200);
  });

  it("keeps the limits when the service is updated without them", async () => {
    setClock(BEFORE_THE_DAY);
    const venueId = "pl-keep";
    await seedVenue(venueId, [2, 4, 6]);
    expect((await setService(venueId, { minPartySize: 2, maxPartySize: 6 })).status).toBe(200);
    expect((await setService(venueId, { openEnd: "23:30" })).status).toBe(200);
    expect((await listServices(venueId))[1]).toEqual({
      name: "dinner",
      openStart: "19:00",
      openEnd: "23:30",
      minPartySize: 2,
      maxPartySize: 6,
    });
    expect((await setService(venueId, { maxPartySize: 2 })).status).toBe(200);
    expect((await listServices(venueId))[1]).toMatchObject({ minPartySize: 2, maxPartySize: 2 });
  });

  it("rejects a minimum above the maximum, also against a stored limit", async () => {
    setClock(BEFORE_THE_DAY);
    const venueId = "pl-order";
    await seedVenue(venueId, [2, 4, 6]);
    const both = await setService(venueId, { minPartySize: 6, maxPartySize: 4 });
    expect(both.status).toBe(400);
    expect(((await both.json()) as { code: string }).code).toBe("invalid_request");

    expect((await setService(venueId, { maxPartySize: 4 })).status).toBe(200);
    expect((await setService(venueId, { minPartySize: 5 })).status).toBe(400);
    expect((await setService(venueId, { minPartySize: 4 })).status).toBe(200);
    expect((await setService(venueId, { maxPartySize: 3 })).status).toBe(400);
    expect((await listServices(venueId))[1]).toMatchObject({ minPartySize: 4, maxPartySize: 4 });
  });

  it("lets a walk-in bypass the service limits, as it bypasses the slot grid and lead time", async () => {
    setClock(BEFORE_THE_DAY);
    const venueId = "pl-walkin";
    await seedVenue(venueId, [2, 4, 6]);
    expect((await setService(venueId, { minPartySize: 2, maxPartySize: 6 })).status).toBe(200);
    expect((await walkIn(venueId, "20:05", 1)).status).toBe(200);
    expect((await walkIn(venueId, "20:05", 7)).status).toBe(200);
    expect((await walkIn(venueId, "17:00", 2)).body.code).toBe("outside_hours");
  });

  it("orders the service limit after lead time and before capacity", async () => {
    setClock(new Date("2026-11-12T21:00:00Z"));
    const venueId = "pl-order-reasons";
    await seedVenue(venueId, [2, 4, 6], { leadTimeMinutes: 90, lastSeatingOffsetMinutes: 30 });
    expect((await setService(venueId, { maxPartySize: 6 })).status).toBe(200);
    const body = await explain(venueId, "22:50", 13);
    expect(body.reasons.map((r) => [r.code, r.details.rule])).toEqual([
      ["outside_hours", "slot_grid"],
      ["outside_hours", "last_seating"],
      ["lead_time_violation", undefined],
      ["party_size_too_large", "service_limit"],
      ["party_size_too_large", undefined],
    ]);
    expect(body.reasons[4].details).toEqual({ partySize: 13, largestParty: 12 });
    expect((await book(venueId, "22:50", 13)).body.code).toBe("outside_hours");
  });

  it("leaves a service without limits as before", async () => {
    setClock(BEFORE_THE_DAY);
    const venueId = "pl-none";
    await seedVenue(venueId, [2, 4, 6]);
    expect(await listServices(venueId)).toEqual([
      { name: "lunch", openStart: "12:00", openEnd: "16:00" },
      { name: "dinner", openStart: "19:00", openEnd: "23:00" },
    ]);
    expect((await book(venueId, "20:00", 1)).status).toBe(200);
    expect((await book(venueId, "20:00", 13)).body.code).toBe("party_size_too_large");
    expect((await explain(venueId, "20:00", 13)).reasons).toEqual([
      { code: "party_size_too_large", message: expect.any(String), details: { partySize: 13, largestParty: 12 } },
    ]);
  });
});

describe("availability, create, and explain agree with turn times and limits", () => {
  it("matches over a grid of times and party sizes", { timeout: 120000 }, async () => {
    setClock(new Date("2026-11-12T11:00:00Z"));
    const venueId = "tl-grid";
    await seedVenue(venueId, [2, 4, 6], { leadTimeMinutes: 60, lastSeatingOffsetMinutes: 30 });
    expect((await setConfig(venueId, { turnTimes: TURN_TIMES })).status).toBe(200);
    expect((await setService(venueId, { minPartySize: 2, maxPartySize: 6 })).status).toBe(200);
    expect((await setService(venueId, { name: "lunch", openStart: "12:00", openEnd: "16:00", maxPartySize: 10 })).status).toBe(200);
    const held = await call(venueId, "/reservations", {
      key: `write-${venueId}`,
      method: "POST",
      body: { date: DATE, time: "20:00", partySize: 6, tables: ["3"] },
    });
    expect(held.status).toBe(200);

    const times = [
      "11:45", "12:00", "12:10", "13:00", "15:30", "15:45", "16:00", "19:00", "19:30",
      "20:00", "20:30", "21:15", "21:30", "22:00", "22:15", "22:30", "22:45",
    ];
    const parties = [1, 2, 4, 6, 7, 11, 13];
    const seen = new Map<string, number>();
    for (const partySize of parties) {
      const listed = new Set(await availableTimes(venueId, partySize));
      for (const time of times) {
        const explained = await explain(venueId, time, partySize);
        const created = await book(venueId, time, partySize);
        const label = `${time} party ${partySize}`;
        expect(created.status === 200, label).toBe(explained.available);
        expect(listed.has(time), label).toBe(explained.available);
        for (const r of explained.reasons) {
          const key = `${r.code}/${r.details.rule ?? ""}`;
          seen.set(key, (seen.get(key) ?? 0) + 1);
        }
        if (explained.available) {
          seen.set("available", (seen.get("available") ?? 0) + 1);
          await cancel(venueId, created.body.id);
        } else {
          expect(created.body.code, label).toBe(explained.reasons[0].code);
        }
      }
    }
    expect(seen.get("available")).toBeGreaterThan(10);
    for (const key of [
      "party_size_too_small/service_limit",
      "party_size_too_large/service_limit",
      "party_size_too_large/",
      "no_suitable_table/",
      "lead_time_violation/",
    ]) {
      expect(seen.get(key), key).toBeGreaterThan(0);
    }
  });
});

describe("turn time and limit settings", () => {
  it("rejects malformed turn times and leaves the config unchanged", async () => {
    setClock(BEFORE_THE_DAY);
    const venueId = "ts-invalid";
    await seedVenue(venueId, [10]);
    expect((await setConfig(venueId, { turnTimes: TURN_TIMES })).status).toBe(200);
    const tooMany = Array.from({ length: 11 }, (_, i) => ({ upTo: i + 1, minutes: 60 }));
    for (const turnTimes of [
      null,
      "90",
      { upTo: 2, minutes: 90 },
      [null],
      [{ upTo: 0, minutes: 90 }],
      [{ upTo: 2.5, minutes: 90 }],
      [{ upTo: "2", minutes: 90 }],
      [{ upTo: 2, minutes: 14 }],
      [{ upTo: 2, minutes: 481 }],
      [{ upTo: 2, minutes: 90.5 }],
      [{ upTo: 2 }],
      [{ upTo: 2, minutes: 90, zone: "x" }],
      [{ upTo: 4, minutes: 120 }, { upTo: 2, minutes: 90 }],
      [{ upTo: 2, minutes: 90 }, { upTo: 2, minutes: 120 }],
      tooMany,
    ]) {
      const res = await setConfig(venueId, { turnTimes });
      const label = JSON.stringify(turnTimes);
      expect(res.status, label).toBe(400);
      expect(((await res.json()) as { code: string }).code, label).toBe("invalid_request");
    }
    expect((await getConfig(venueId)).turnTimes).toEqual(TURN_TIMES);
    expect(
      (await setConfig(venueId, { turnTimes: [{ upTo: 1, minutes: 15 }, { upTo: 100, minutes: 480 }] })).status,
    ).toBe(200);
  });

  it("rejects malformed party limits and leaves the service unchanged", async () => {
    setClock(BEFORE_THE_DAY);
    const venueId = "ts-limits";
    await seedVenue(venueId, [2, 4, 6]);
    expect((await setService(venueId, { minPartySize: 2, maxPartySize: 6 })).status).toBe(200);
    for (const value of [0, -1, 2.5, "2", true, [], {}]) {
      for (const field of ["minPartySize", "maxPartySize"]) {
        const res = await setService(venueId, { [field]: value });
        const label = `${field} ${JSON.stringify(value)}`;
        expect(res.status, label).toBe(400);
        expect(((await res.json()) as { code: string }).code, label).toBe("invalid_request");
      }
    }
    expect((await listServices(venueId))[1]).toMatchObject({ minPartySize: 2, maxPartySize: 6 });
  });

  it("keeps each venue's settings to itself", async () => {
    setClock(BEFORE_THE_DAY);
    await seedVenue("ts-iso-a", [10]);
    await seedVenue("ts-iso-b", [10]);
    expect((await setConfig("ts-iso-a", { turnTimes: [{ upTo: 10, minutes: 60 }] })).status).toBe(200);
    expect((await setService("ts-iso-a", { name: "lunch", openStart: "12:00", openEnd: "16:00", minPartySize: 4 })).status).toBe(200);
    expect((await book("ts-iso-a", "13:00", 2)).body.code).toBe("party_size_too_small");

    expect(await getConfig("ts-iso-b")).not.toHaveProperty("turnTimes");
    expect((await listServices("ts-iso-b"))[0]).toEqual({ name: "lunch", openStart: "12:00", openEnd: "16:00" });
    expect((await book("ts-iso-b", "13:00", 2)).status).toBe(200);
    expect((await book("ts-iso-b", "20:00", 2)).status).toBe(200);
    expect(await firstFreeAfter("ts-iso-b", "20:00")).toBe("22:00");
    expect((await book("ts-iso-a", "20:00", 4)).status).toBe(200);
    expect(await firstFreeAfter("ts-iso-a", "20:00")).toBe("21:00");

    const crossConfig = await setConfig("ts-iso-b", { turnTimes: TURN_TIMES }, "admin-ts-iso-a");
    expect(crossConfig.status).toBe(404);
    expect(((await crossConfig.json()) as { code: string }).code).toBe("venue_not_found");
    const crossService = await setService("ts-iso-b", { maxPartySize: 2 }, "admin-ts-iso-a");
    expect(crossService.status).toBe(404);
    expect(await getConfig("ts-iso-b")).not.toHaveProperty("turnTimes");
    expect((await listServices("ts-iso-b"))[1]).not.toHaveProperty("maxPartySize");
  });

  it("does not let a read key change turn times or limits", async () => {
    setClock(BEFORE_THE_DAY);
    const venueId = "ts-read";
    await seedVenue(venueId, [10]);
    const config = await setConfig(venueId, { turnTimes: TURN_TIMES }, `read-${venueId}`);
    expect(config.status).toBe(403);
    expect(((await config.json()) as { code: string }).code).toBe("forbidden");
    const service = await setService(venueId, { minPartySize: 2 }, `read-${venueId}`);
    expect(service.status).toBe(403);
    expect(await getConfig(venueId)).not.toHaveProperty("turnTimes");
    expect((await listServices(venueId))[1]).not.toHaveProperty("minPartySize");
  });
});
