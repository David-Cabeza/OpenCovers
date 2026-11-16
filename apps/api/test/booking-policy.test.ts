import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { reservations, services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";

const NOON_MADRID = new Date("2026-11-10T12:00:00Z");
const TODAY = "2026-11-10";
const GUEST = "ana@example.com";

let requestCounter = 0;
let venueCounter = 0;

type Policy = {
  maxAdvanceDays?: number | null;
  maxActivePerGuestPerDay?: number | null;
  blockedDates?: { from: string; to: string }[];
};

async function seedVenue(policy: Policy = {}) {
  const venueId = `bp-${++venueCounter}`;
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid", ...policy });
  await db.insert(services).values([{ venueId, name: "dinner", openStart: "19:00", openEnd: "23:00" }]);
  await db.insert(tables).values(
    Array.from({ length: 8 }, (_, i) => ({ id: String(i + 1), venueId, name: `T${i + 1}`, seats: 4 })),
  );
  await addKey(db, `read-${venueId}`, "reader", [venueId], "read");
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
      "Idempotency-Key": `bp-${++requestCounter}`,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function book(venueId: string, date: string, body: Record<string, unknown> = {}) {
  return call(venueId, "/reservations", {
    method: "POST",
    body: { date, time: "21:00", partySize: 2, ...body },
  });
}

function bookFor(venueId: string, date: string, contact = GUEST, time = "21:00") {
  return book(venueId, date, { time, guest: { name: "Ana", contact } });
}

async function expectRefused(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(await res.json()).toMatchObject({ code, retryable: false });
}

function setConfig(venueId: string, body: Record<string, unknown>, key = `admin-${venueId}`) {
  return call(venueId, "/config", { method: "PUT", key, body });
}

async function getConfig(venueId: string) {
  return (await (await call(venueId, "/config")).json()) as Record<string, unknown>;
}

async function explain(venueId: string, date: string, time: string, partySize = 2) {
  const res = await call(venueId, `/availability/explain?date=${date}&time=${time}&partySize=${partySize}`);
  expect(res.status).toBe(200);
  return (await res.json()) as { available: boolean; reasons: { code: string; details: unknown }[] };
}

async function listed(venueId: string, date: string, time: string, partySize = 2) {
  const res = await call(venueId, `/availability?date=${date}&partySize=${partySize}`);
  const body = (await res.json()) as { availability: Record<string, { time: string; available: boolean }[]> };
  return Object.values(body.availability)
    .flat()
    .find((s) => s.time === time)?.available;
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

beforeEach(() => setClock(NOON_MADRID));
afterEach(() => vi.useRealTimers());

describe("defaults", () => {
  it("leave every rule off and the behavior unchanged", async () => {
    const venueId = await seedVenue();
    expect(await getConfig(venueId)).toMatchObject({
      maxAdvanceDays: null,
      maxActivePerGuestPerDay: null,
      blockedDates: [],
    });
    for (const date of ["2026-11-10", "2027-06-01", "2031-12-25"]) {
      expect((await bookFor(venueId, date, GUEST, "19:00")).status).toBe(200);
      expect((await bookFor(venueId, date, GUEST, "20:00")).status).toBe(200);
      expect((await bookFor(venueId, date, GUEST, "21:00")).status).toBe(200);
      expect((await explain(venueId, date, "21:00")).available).toBe(true);
    }
  });

  it("keeps the policy when another setting changes, and clears it on request", async () => {
    const venueId = await seedVenue();
    await setConfig(venueId, { maxAdvanceDays: 5, maxActivePerGuestPerDay: 2, blockedDates: ["2026-12-25"] });
    const other = await (await setConfig(venueId, { leadTimeMinutes: 10 })).json();
    expect(other).toMatchObject({
      maxAdvanceDays: 5,
      maxActivePerGuestPerDay: 2,
      blockedDates: [{ from: "2026-12-25", to: "2026-12-25" }],
    });
    const cleared = await (
      await setConfig(venueId, { maxAdvanceDays: null, maxActivePerGuestPerDay: null, blockedDates: [] })
    ).json();
    expect(cleared).toMatchObject({ maxAdvanceDays: null, maxActivePerGuestPerDay: null, blockedDates: [] });
  });
});

describe("the config", () => {
  it("round-trips the three settings", async () => {
    const venueId = await seedVenue();
    const res = await setConfig(venueId, {
      maxAdvanceDays: 90,
      maxActivePerGuestPerDay: 2,
      blockedDates: ["2026-12-25", { from: "2026-08-01", to: "2026-08-31" }],
    });
    expect(res.status).toBe(200);
    const expected = {
      maxAdvanceDays: 90,
      maxActivePerGuestPerDay: 2,
      blockedDates: [
        { from: "2026-08-01", to: "2026-08-31" },
        { from: "2026-12-25", to: "2026-12-25" },
      ],
    };
    expect(await res.json()).toMatchObject(expected);
    expect(await getConfig(venueId)).toMatchObject(expected);
  });

  it("merges duplicate, overlapping and adjacent entries", async () => {
    const venueId = await seedVenue();
    const res = await setConfig(venueId, {
      blockedDates: [
        "2026-12-24",
        "2026-12-24",
        { from: "2026-12-20", to: "2026-12-23" },
        { from: "2026-12-22", to: "2026-12-25" },
        "2026-12-30",
      ],
    });
    expect((await res.json()).blockedDates).toEqual([
      { from: "2026-12-20", to: "2026-12-25" },
      { from: "2026-12-30", to: "2026-12-30" },
    ]);
  });

  it("accepts the largest allowed list and values at the bounds", async () => {
    const venueId = await seedVenue();
    const dates = Array.from({ length: 366 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + 2 * i)).toISOString().slice(0, 10));
    expect((await setConfig(venueId, { blockedDates: dates })).status).toBe(200);
    expect((await setConfig(venueId, { maxAdvanceDays: 0, maxActivePerGuestPerDay: 1 })).status).toBe(200);
    expect((await setConfig(venueId, { maxAdvanceDays: 1000, maxActivePerGuestPerDay: 100 })).status).toBe(200);
  });

  it("rejects invalid values with invalid_request and changes nothing", async () => {
    const venueId = await seedVenue({ maxAdvanceDays: 30, maxActivePerGuestPerDay: 3, blockedDates: [{ from: "2026-12-25", to: "2026-12-25" }] });
    const tooMany = Array.from({ length: 367 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
    const bad: Record<string, unknown>[] = [
      { maxAdvanceDays: -1 },
      { maxAdvanceDays: 1001 },
      { maxAdvanceDays: 1.5 },
      { maxAdvanceDays: "7" },
      { maxActivePerGuestPerDay: 0 },
      { maxActivePerGuestPerDay: 101 },
      { maxActivePerGuestPerDay: 2.5 },
      { maxActivePerGuestPerDay: true },
      { blockedDates: null },
      { blockedDates: "2026-12-25" },
      { blockedDates: tooMany },
      { blockedDates: ["2026-02-30"] },
      { blockedDates: ["2026-13-01"] },
      { blockedDates: ["2026-12-32"] },
      { blockedDates: [{ from: "2026-13-01", to: "2026-13-02" }] },
      { blockedDates: ["2026-12-5"] },
      { blockedDates: ["25/12/2026"] },
      { blockedDates: [20261225] },
      { blockedDates: [{ from: "2026-12-26", to: "2026-12-25" }] },
      { blockedDates: [{ from: "2026-12-25" }] },
      { blockedDates: [{ from: "2026-12-25", to: "2026-12-26", note: "x" }] },
      { blockedDates: [["2026-12-25"]] },
      { maxAdvanceDays: 5, blockedDates: ["nope"] },
    ];
    for (const body of bad) {
      const res = await setConfig(venueId, body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect((await res.json()).code).toBe("invalid_request");
    }
    expect(await getConfig(venueId)).toMatchObject({
      maxAdvanceDays: 30,
      maxActivePerGuestPerDay: 3,
      blockedDates: [{ from: "2026-12-25", to: "2026-12-25" }],
    });
  });

  it("keeps the database bound when the application is bypassed", async () => {
    const venueId = await seedVenue();
    await expect(db.update(venues).set({ maxAdvanceDays: -1 }).where(eq(venues.id, venueId))).rejects.toThrow();
    await expect(db.update(venues).set({ maxActivePerGuestPerDay: 0 }).where(eq(venues.id, venueId))).rejects.toThrow();
  });

  it("needs an admin key and stays in its venue", async () => {
    const venueId = await seedVenue();
    const other = await seedVenue();
    for (const key of [`read-${venueId}`, `write-${venueId}`]) {
      const res = await setConfig(venueId, { maxAdvanceDays: 3, blockedDates: ["2026-12-25"] }, key);
      expect(res.status).toBe(403);
    }
    expect(await getConfig(venueId)).toMatchObject({ maxAdvanceDays: null, blockedDates: [] });
    const foreign = await setConfig(other, { maxAdvanceDays: 3 }, `admin-${venueId}`);
    expect(foreign.status).toBe(404);
    expect((await getConfig(other)).maxAdvanceDays).toBeNull();
  });
});

describe("the booking horizon", () => {
  it("allows exactly maxAdvanceDays ahead and refuses the next day", async () => {
    const venueId = await seedVenue({ maxAdvanceDays: 7 });
    expect((await book(venueId, "2026-11-17")).status).toBe(200);
    await expectRefused(await book(venueId, "2026-11-18"), 400, "beyond_booking_horizon");
    await expectRefused(await book(venueId, "2027-11-18"), 400, "beyond_booking_horizon");
  });

  it("allows today at 0 days and nothing later", async () => {
    const venueId = await seedVenue({ maxAdvanceDays: 0 });
    expect((await book(venueId, TODAY)).status).toBe(200);
    await expectRefused(await book(venueId, "2026-11-11"), 400, "beyond_booking_horizon");
  });

  it("counts days from today in the venue time zone, not in UTC", async () => {
    const venueId = await seedVenue({ maxAdvanceDays: 1 });
    // 23:30 UTC on the 10th is 00:30 on the 11th in Madrid.
    setClock(new Date("2026-11-10T23:30:00Z"));
    expect((await book(venueId, "2026-11-12")).status).toBe(200);
    await expectRefused(await book(venueId, "2026-11-13"), 400, "beyond_booking_horizon");
    const reason = (await explain(venueId, "2026-11-13", "21:00")).reasons[0];
    expect(reason).toMatchObject({ code: "beyond_booking_horizon", details: { maxAdvanceDays: 1, latest: "2026-11-12" } });
    // One hour earlier it is still the 10th in Madrid, so the 12th is a day too far.
    setClock(new Date("2026-11-10T22:30:00Z"));
    expect((await book(venueId, "2026-11-11")).status).toBe(200);
    await expectRefused(await book(venueId, "2026-11-12"), 400, "beyond_booking_horizon");
  });

  it("does not hold a walk-in", async () => {
    const venueId = await seedVenue({ maxAdvanceDays: 1 });
    const res = await call(venueId, "/reservations/walk-in", {
      method: "POST",
      body: { date: "2026-12-01", time: "21:00", partySize: 2 },
    });
    expect(res.status).toBe(200);
  });

  it("shows the days past the horizon as unavailable", async () => {
    const venueId = await seedVenue({ maxAdvanceDays: 2 });
    expect(await listed(venueId, "2026-11-12", "21:00")).toBe(true);
    expect(await listed(venueId, "2026-11-13", "21:00")).toBe(false);
    expect((await explain(venueId, "2026-11-13", "21:00")).available).toBe(false);
  });
});

describe("blocked dates", () => {
  const policy = { blockedDates: [{ from: "2026-12-24", to: "2026-12-26" }, { from: "2026-12-31", to: "2026-12-31" }] };

  it("refuses a blocked single date and each end of a range, and allows the dates around them", async () => {
    const venueId = await seedVenue(policy);
    for (const date of ["2026-12-24", "2026-12-25", "2026-12-26", "2026-12-31"]) {
      await expectRefused(await book(venueId, date), 400, "date_blocked");
    }
    for (const date of ["2026-12-23", "2026-12-27", "2026-12-30", "2027-01-01"]) {
      expect((await book(venueId, date)).status, date).toBe(200);
    }
  });

  it("reports the blocked range in the explanation and lists no time that day", async () => {
    const venueId = await seedVenue(policy);
    const answer = await explain(venueId, "2026-12-25", "21:00");
    expect(answer.available).toBe(false);
    expect(answer.reasons[0]).toMatchObject({ code: "date_blocked", details: { from: "2026-12-24", to: "2026-12-26" } });
    expect(await listed(venueId, "2026-12-25", "21:00")).toBe(false);
    expect(await listed(venueId, "2026-12-27", "21:00")).toBe(true);
  });

  it("does not hold a walk-in", async () => {
    const venueId = await seedVenue(policy);
    const res = await call(venueId, "/reservations/walk-in", {
      method: "POST",
      body: { date: "2026-12-25", time: "21:00", partySize: 2 },
    });
    expect(res.status).toBe(200);
  });

  it("leaves a booking made before the block alone, and lets other fields change", async () => {
    const venueId = await seedVenue();
    const id = (await (await book(venueId, "2026-12-25", { partySize: 2 })).json()).id as string;
    await setConfig(venueId, { blockedDates: ["2026-12-25"] });
    const res = await call(venueId, `/reservations/${id}/modify`, { method: "POST", body: { partySize: 3, commentary: "window" } });
    expect(res.status).toBe(200);
    const read = await (await call(venueId, `/reservations/${id}`)).json();
    expect(read).toMatchObject({ status: "booked", date: "2026-12-25", partySize: 3 });
  });

  it("applies a date set through the config route and stops applying it once cleared", async () => {
    const venueId = await seedVenue();
    await setConfig(venueId, { blockedDates: ["2026-12-25"] });
    await expectRefused(await book(venueId, "2026-12-25"), 400, "date_blocked");
    await setConfig(venueId, { blockedDates: [] });
    expect((await book(venueId, "2026-12-25")).status).toBe(200);
  });
});

describe("the per-guest daily cap", () => {
  it("allows exactly the cap and refuses the next booking on that date with a 409", async () => {
    const venueId = await seedVenue({ maxActivePerGuestPerDay: 2 });
    expect((await bookFor(venueId, "2026-11-12", GUEST, "19:00")).status).toBe(200);
    expect((await bookFor(venueId, "2026-11-12", GUEST, "21:00")).status).toBe(200);
    await expectRefused(await bookFor(venueId, "2026-11-12", GUEST, "22:00"), 409, "guest_booking_limit");
    expect((await bookFor(venueId, "2026-11-13", GUEST, "21:00")).status).toBe(200);
  });

  it("refuses the second booking at a cap of 1", async () => {
    const venueId = await seedVenue({ maxActivePerGuestPerDay: 1 });
    expect((await bookFor(venueId, "2026-11-12")).status).toBe(200);
    await expectRefused(await bookFor(venueId, "2026-11-12", GUEST, "19:00"), 409, "guest_booking_limit");
  });

  it("does not count cancelled bookings, and counts a seated one", async () => {
    const venueId = await seedVenue({ maxActivePerGuestPerDay: 1 });
    const id = (await (await bookFor(venueId, "2026-11-12")).json()).id as string;
    await expectRefused(await bookFor(venueId, "2026-11-12", GUEST, "19:00"), 409, "guest_booking_limit");
    expect((await call(venueId, `/reservations/${id}/cancel`, { method: "POST" })).status).toBe(200);
    const again = await bookFor(venueId, "2026-11-12", GUEST, "19:00");
    expect(again.status).toBe(200);
    const next = (await again.json()).id as string;
    expect((await call(venueId, `/reservations/${next}/status`, { method: "POST", body: { status: "seated" } })).status).toBe(200);
    await expectRefused(await bookFor(venueId, "2026-11-12", GUEST, "22:00"), 409, "guest_booking_limit");
  });

  it("counts per guest, reading the same email in another case as the same guest", async () => {
    const venueId = await seedVenue({ maxActivePerGuestPerDay: 1 });
    expect((await bookFor(venueId, "2026-11-12", GUEST)).status).toBe(200);
    await expectRefused(await bookFor(venueId, "2026-11-12", "ANA@Example.com", "19:00"), 409, "guest_booking_limit");
    expect((await bookFor(venueId, "2026-11-12", "bea@example.com", "19:00")).status).toBe(200);
  });

  it("counts per venue", async () => {
    const venueId = await seedVenue({ maxActivePerGuestPerDay: 1 });
    const other = await seedVenue({ maxActivePerGuestPerDay: 1 });
    const free = await seedVenue();
    expect((await bookFor(venueId, "2026-11-12")).status).toBe(200);
    expect((await bookFor(other, "2026-11-12")).status).toBe(200);
    expect((await bookFor(free, "2026-11-12")).status).toBe(200);
    expect((await bookFor(free, "2026-11-12", GUEST, "19:00")).status).toBe(200);
    await expectRefused(await bookFor(other, "2026-11-12", GUEST, "19:00"), 409, "guest_booking_limit");
  });

  it("does not apply to a booking without a usable contact", async () => {
    const venueId = await seedVenue({ maxActivePerGuestPerDay: 1 });
    for (const time of ["19:00", "20:00", "21:00"]) {
      expect((await book(venueId, "2026-11-12", { time })).status).toBe(200);
    }
    for (const time of ["19:15", "20:15"]) {
      expect((await book(venueId, "2026-11-12", { time, guest: { name: "Ana", contact: "not a contact" } })).status).toBe(200);
    }
  });

  it("does not hold a walk-in, and a walk-in does not block the guest from booking", async () => {
    const venueId = await seedVenue({ maxActivePerGuestPerDay: 1 });
    expect((await bookFor(venueId, "2026-11-12")).status).toBe(200);
    const walk = await call(venueId, "/reservations/walk-in", {
      method: "POST",
      body: { date: "2026-11-12", time: "19:00", partySize: 2, guest: { contact: GUEST } },
    });
    expect(walk.status).toBe(200);
  });

  it("is not applied by availability and the explanation, which do not know the guest", async () => {
    const venueId = await seedVenue({ maxActivePerGuestPerDay: 1 });
    expect((await bookFor(venueId, "2026-11-12")).status).toBe(200);
    expect((await explain(venueId, "2026-11-12", "19:00")).available).toBe(true);
    expect(await listed(venueId, "2026-11-12", "19:00")).toBe(true);
  });

  it("replays an idempotent create without counting it twice", async () => {
    const venueId = await seedVenue({ maxActivePerGuestPerDay: 1 });
    const send = () =>
      app.request(`/v1/venues/${venueId}/reservations`, {
        method: "POST",
        headers: { apikey: `write-${venueId}`, "content-type": "application/json", "Idempotency-Key": "bp-replay" },
        body: JSON.stringify({ date: "2026-11-12", time: "21:00", partySize: 2, guest: { contact: GUEST } }),
      });
    const first = await (await send()).json();
    const second = await send();
    expect(second.status).toBe(200);
    expect((await second.json()).id).toBe(first.id);
  });

  it("never exceeds the cap under concurrent creates by one guest", async () => {
    const venueId = await seedVenue({ maxActivePerGuestPerDay: 2 });
    const times = ["19:00", "19:15", "19:30", "19:45", "20:00", "20:15", "20:30", "20:45"];
    const results = await Promise.all(times.map((time) => bookFor(venueId, "2026-11-12", GUEST, time)));
    const bodies = await Promise.all(results.map(async (r) => ({ status: r.status, code: (await r.json()).code })));
    expect(bodies.filter((b) => b.status === 200)).toHaveLength(2);
    expect(bodies.filter((b) => b.code === "guest_booking_limit")).toHaveLength(6);
    const rows = await db.select().from(reservations).where(eq(reservations.venueId, venueId));
    expect(rows).toHaveLength(2);
  });
});

describe("create, availability and the explanation agree", () => {
  it("over a grid of dates, times and rules", async () => {
    const venueId = await seedVenue();
    const put = await setConfig(venueId, {
      maxAdvanceDays: 4,
      blockedDates: [{ from: "2026-11-11", to: "2026-11-11" }, "2026-11-13"],
    });
    expect(put.status).toBe(200);
    const dates = Array.from({ length: 8 }, (_, i) => new Date(Date.UTC(2026, 10, 9 + i)).toISOString().slice(0, 10));
    const outcomes = new Set<string>();
    for (const date of dates) {
      for (const time of ["19:00", "21:00", "22:45"]) {
        const answer = await explain(venueId, date, time);
        const free = await listed(venueId, date, time);
        const res = await book(venueId, date, { time });
        const created = res.status === 200;
        expect(answer.available, `${date} ${time} explain`).toBe(created);
        expect(free, `${date} ${time} availability`).toBe(created);
        if (!created) expect((await res.json()).code, `${date} ${time} code`).toBe(answer.reasons[0].code);
        outcomes.add(created ? "created" : answer.reasons[0].code);
      }
    }
    expect([...outcomes].sort()).toEqual(["beyond_booking_horizon", "created", "date_blocked"]);
  });
});
