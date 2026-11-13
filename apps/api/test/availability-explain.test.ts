import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";

const DATE = "2026-11-12";
const BEFORE_THE_DAY = new Date("2026-11-10T12:00:00Z");

let requestCounter = 0;

async function seedVenue(
  venueId: string,
  config: { leadTimeMinutes?: number; lastSeatingOffsetMinutes?: number } = {},
) {
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid", ...config });
  await db.insert(services).values([
    { venueId, name: "lunch", openStart: "12:00", openEnd: "16:00" },
    { venueId, name: "dinner", openStart: "19:00", openEnd: "23:00" },
  ]);
  await db.insert(tables).values([
    { id: "1", venueId, name: "T1", seats: 2, zone: "Terrace" },
    { id: "2", venueId, name: "T2", seats: 4, zone: "Terrace" },
    { id: "3", venueId, name: "T3", seats: 6, zone: "Lounge" },
  ]);
  await addKey(db, `read-${venueId}`, "reader", [venueId], "read");
  await addKey(db, `write-${venueId}`, "writer", [venueId], "write");
}

function request(venueId: string, path: string, init: { key?: string; method?: string; body?: unknown } = {}) {
  return app.request(`/v1/venues/${venueId}${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: init.key ?? `read-${venueId}`,
      "content-type": "application/json",
      "Idempotency-Key": `explain-${++requestCounter}`,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function explain(venueId: string, time: string, partySize: number, extra = "", date = DATE) {
  const res = await request(venueId, `/availability/explain?date=${date}&time=${time}&partySize=${partySize}${extra}`);
  expect(res.status).toBe(200);
  return (await res.json()) as {
    date: string;
    time: string;
    partySize: number;
    zone?: string;
    available: boolean;
    reasons: { code: string; message: string; details: Record<string, unknown> }[];
    nearest: string[];
  };
}

async function availableTimes(venueId: string, partySize: number) {
  const res = await request(venueId, `/availability?date=${DATE}&partySize=${partySize}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { availability: Record<string, { time: string; available: boolean }[]> };
  return new Set(
    Object.values(body.availability)
      .flat()
      .filter((s) => s.available)
      .map((s) => s.time),
  );
}

async function book(venueId: string, body: Record<string, unknown>) {
  return request(venueId, "/reservations", {
    key: `write-${venueId}`,
    method: "POST",
    body: { date: DATE, partySize: 2, ...body },
  });
}

function setClock(now: Date) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
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

describe("availability explanation reasons", () => {
  it("explains a time outside every service", async () => {
    setClock(BEFORE_THE_DAY);
    await seedVenue("ex-hours");
    const body = await explain("ex-hours", "17:00", 2);
    expect(body).toEqual({
      date: DATE,
      time: "17:00",
      partySize: 2,
      available: false,
      reasons: [
        {
          code: "outside_hours",
          message: expect.any(String),
          details: {
            rule: "hours",
            services: [
              { name: "lunch", openStart: "12:00", openEnd: "16:00" },
              { name: "dinner", openStart: "19:00", openEnd: "23:00" },
            ],
          },
        },
      ],
      nearest: ["15:45", "15:30", "15:15"],
    });
  });

  it("explains a time off the slot grid with the neighbouring grid times", async () => {
    setClock(BEFORE_THE_DAY);
    await seedVenue("ex-grid");
    const body = await explain("ex-grid", "19:10", 2);
    expect(body.available).toBe(false);
    expect(body.reasons).toEqual([
      {
        code: "outside_hours",
        message: expect.any(String),
        details: {
          rule: "slot_grid",
          service: "dinner",
          openStart: "19:00",
          openEnd: "23:00",
          slotIntervalMinutes: 15,
          previous: "19:00",
          next: "19:15",
        },
      },
    ]);
    expect(body.nearest).toEqual(["19:15", "19:00", "19:30"]);
  });

  it("explains a time after the last seating", async () => {
    setClock(BEFORE_THE_DAY);
    await seedVenue("ex-seating", { lastSeatingOffsetMinutes: 30 });
    const body = await explain("ex-seating", "22:45", 2);
    expect(body.reasons).toEqual([
      {
        code: "outside_hours",
        message: expect.any(String),
        details: {
          rule: "last_seating",
          service: "dinner",
          openEnd: "23:00",
          lastSeatingOffsetMinutes: 30,
          lastSeating: "22:30",
        },
      },
    ]);
    expect(body.nearest).toEqual(["22:30", "22:15", "22:00"]);
  });

  it("explains a time within the lead time with the earliest bookable time", async () => {
    setClock(new Date("2026-11-12T18:00:00Z"));
    await seedVenue("ex-lead", { leadTimeMinutes: 90 });
    const body = await explain("ex-lead", "19:30", 2);
    expect(body.reasons).toEqual([
      {
        code: "lead_time_violation",
        message: expect.any(String),
        details: { leadTimeMinutes: 90, earliest: { date: DATE, time: "20:30" } },
      },
    ]);
    expect(body.nearest).toEqual(["20:30", "20:45", "21:00"]);
  });

  it("explains a party larger than the venue and than a zone", async () => {
    setClock(BEFORE_THE_DAY);
    await seedVenue("ex-large");
    const venueWide = await explain("ex-large", "21:00", 13);
    expect(venueWide.reasons).toEqual([
      {
        code: "party_size_too_large",
        message: expect.any(String),
        details: { partySize: 13, largestParty: 12 },
      },
    ]);
    expect(venueWide.nearest).toEqual([]);

    const zoned = await explain("ex-large", "21:00", 7, "&zone=Terrace");
    expect(zoned.zone).toBe("Terrace");
    expect(zoned.reasons).toEqual([
      {
        code: "party_size_too_large",
        message: expect.any(String),
        details: { partySize: 7, largestParty: 6, zone: "Terrace" },
      },
    ]);
  });

  it("explains a slot whose free tables cannot seat the party", async () => {
    setClock(BEFORE_THE_DAY);
    await seedVenue("ex-tables");
    expect((await book("ex-tables", { time: "21:00", partySize: 6, tables: ["3"] })).status).toBe(200);
    const body = await explain("ex-tables", "21:00", 7);
    expect(body.reasons).toEqual([
      {
        code: "no_suitable_table",
        message: expect.any(String),
        details: { partySize: 7, tablesFree: 2, tablesTotal: 3, seatsFree: 6, largestFreeTable: 4 },
      },
    ]);
    expect(body.nearest).toEqual(["19:00", "15:45", "15:30"]);
  });

  it("returns every reason in priority order and create reports the first", async () => {
    setClock(new Date("2026-11-12T21:00:00Z"));
    await seedVenue("ex-many", { leadTimeMinutes: 90, lastSeatingOffsetMinutes: 30 });
    const body = await explain("ex-many", "22:50", 13);
    expect(body.available).toBe(false);
    expect(body.reasons.map((r) => [r.code, r.details.rule])).toEqual([
      ["outside_hours", "slot_grid"],
      ["outside_hours", "last_seating"],
      ["lead_time_violation", undefined],
      ["party_size_too_large", undefined],
    ]);
    expect(body.reasons[0].details).toMatchObject({ previous: "22:45", next: null });
    expect(body.reasons[2].details).toEqual({ leadTimeMinutes: 90, earliest: { date: DATE, time: "23:30" } });

    const created = await book("ex-many", { time: "22:50", partySize: 13 });
    expect(created.status).toBe(400);
    expect(((await created.json()) as { code: string }).code).toBe("outside_hours");
  });

  it("reports an available slot with no reasons", async () => {
    setClock(BEFORE_THE_DAY);
    await seedVenue("ex-open");
    expect(await explain("ex-open", "20:00", 4)).toEqual({
      date: DATE,
      time: "20:00",
      partySize: 4,
      available: true,
      reasons: [],
      nearest: [],
    });
  });
});

describe("availability explanation agrees with booking", () => {
  it("matches create and the availability list over a grid of times and party sizes", { timeout: 120000 }, async () => {
    setClock(new Date("2026-11-12T11:00:00Z"));
    const venueId = "ex-grid-check";
    await seedVenue(venueId, { leadTimeMinutes: 60, lastSeatingOffsetMinutes: 30 });
    expect((await book(venueId, { time: "20:00", partySize: 6, tables: ["3"] })).status).toBe(200);

    const times = [
      "11:45", "12:00", "12:10", "12:30", "13:00", "15:30", "15:45", "16:00", "18:45",
      "19:00", "19:15", "19:30", "20:00", "20:15", "21:00", "22:00", "22:30", "22:45", "23:00",
    ];
    const parties = [2, 6, 7, 13];
    const seen = { available: 0, unavailable: 0 };
    for (const partySize of parties) {
      const listed = await availableTimes(venueId, partySize);
      for (const time of times) {
        const explained = await explain(venueId, time, partySize);
        const created = await book(venueId, { time, partySize });
        const createBody = (await created.json()) as { id?: string; code?: string };
        const label = `${time} party ${partySize}`;
        expect(created.status === 200, label).toBe(explained.available);
        expect(listed.has(time), label).toBe(explained.available);
        if (explained.available) {
          seen.available++;
          const cancelled = await request(venueId, `/reservations/${createBody.id}/cancel`, {
            key: `write-${venueId}`,
            method: "POST",
          });
          expect(cancelled.status).toBe(200);
        } else {
          seen.unavailable++;
          expect(createBody.code, label).toBe(explained.reasons[0].code);
        }
      }
    }
    expect(seen.available).toBeGreaterThan(10);
    expect(seen.unavailable).toBeGreaterThan(10);
  });

  it("offers nearest times that are themselves available", async () => {
    setClock(BEFORE_THE_DAY);
    const venueId = "ex-nearest";
    await seedVenue(venueId);
    expect((await book(venueId, { time: "20:00", partySize: 6, tables: ["3"] })).status).toBe(200);
    const body = await explain(venueId, "20:30", 7);
    expect(body.available).toBe(false);
    expect(body.nearest.length).toBe(3);
    const listed = await availableTimes(venueId, 7);
    for (const time of body.nearest) {
      expect((await explain(venueId, time, 7)).available, time).toBe(true);
      expect(listed.has(time), time).toBe(true);
    }
  });
});

describe("availability explanation access and privacy", () => {
  it("never returns personal data of the booking that blocks the slot", async () => {
    setClock(BEFORE_THE_DAY);
    const venueId = "ex-private";
    await seedVenue(venueId);
    const created = await book(venueId, {
      time: "21:00",
      partySize: 12,
      guest: { name: "Zelda Quixote", contact: "Zelda.Private@Example.com" },
    });
    expect(created.status).toBe(200);
    const reservation = (await created.json()) as { id: string; guest: { guestId: string } };

    const res = await request(venueId, `/availability/explain?date=${DATE}&time=21:00&partySize=2`);
    const text = await res.text();
    const body = JSON.parse(text) as { available: boolean; reasons: { code: string }[] };
    expect(body.available).toBe(false);
    expect(body.reasons.map((r) => r.code)).toEqual(["no_suitable_table"]);
    for (const secret of ["Zelda", "Quixote", "zelda.private@example.com", "Example.com", reservation.id, reservation.guest.guestId]) {
      expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
    }
    const keys: string[] = [];
    (function collect(value: unknown) {
      if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) {
          keys.push(k);
          collect(v);
        }
      }
    })(body);
    expect(keys.filter((k) => /id$|ids$|guest|name|contact/i.test(k))).toEqual([]);
  });

  it("isolates venues and reports an unknown venue as not found", async () => {
    setClock(BEFORE_THE_DAY);
    await seedVenue("ex-iso-a");
    await seedVenue("ex-iso-b");
    const other = await request("ex-iso-b", `/availability/explain?date=${DATE}&time=20:00&partySize=2`, {
      key: "read-ex-iso-a",
    });
    expect(other.status).toBe(404);
    expect(((await other.json()) as { code: string }).code).toBe("venue_not_found");

    await addKey(db, "read-everywhere", "reader", ["*"], "read");
    const unknown = await request("ex-iso-missing", `/availability/explain?date=${DATE}&time=20:00&partySize=2`, {
      key: "read-everywhere",
    });
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { code: string }).code).toBe("venue_not_found");
  });

  it("answers a read key and rejects malformed queries", async () => {
    setClock(BEFORE_THE_DAY);
    await seedVenue("ex-read");
    const ok = await request("ex-read", `/availability/explain?date=${DATE}&time=20:00&partySize=2`, {
      key: "read-ex-read",
    });
    expect(ok.status).toBe(200);
    for (const query of [
      `date=${DATE}&time=20:00`,
      `date=${DATE}&time=20:00&partySize=0`,
      `date=${DATE}&time=20:00&partySize=two`,
      `date=${DATE}&time=8pm&partySize=2`,
      `date=2026-13-40&time=20:00&partySize=2`,
      `time=20:00&partySize=2`,
    ]) {
      const res = await request("ex-read", `/availability/explain?${query}`);
      expect(res.status, query).toBe(400);
      expect(((await res.json()) as { code: string }).code, query).toBe("invalid_request");
    }
  });
});

describe("availability explanation and venue config", () => {
  it("follows a changed slot interval", async () => {
    setClock(BEFORE_THE_DAY);
    await seedVenue("ex-interval");
    await db.update(venues).set({ slotIntervalMinutes: 30 }).where(eq(venues.id, "ex-interval"));
    const body = await explain("ex-interval", "19:15", 2);
    expect(body.reasons[0].details).toMatchObject({ rule: "slot_grid", slotIntervalMinutes: 30, previous: "19:00", next: "19:30" });
  });
});
