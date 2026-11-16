import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";

// 2026-11-09 is a Monday (ISO 1) and 2026-11-15 a Sunday (ISO 7).
const MON = "2026-11-09";
const THU = "2026-11-12";
const FRI = "2026-11-13";
const SAT = "2026-11-14";
const SUN = "2026-11-15";
const BEFORE = new Date("2026-11-02T12:00:00Z");

let counter = 0;

type Reason = { code: string; message: string; details: Record<string, unknown> };

async function seedVenue(id: string, timezone: string, svc: Record<string, unknown>[], seats = [4]) {
  await db.insert(venues).values({ id, timezone, name: `Venue ${id}` });
  if (svc.length > 0) {
    await db.insert(services).values(svc.map((s) => ({ venueId: id, ...s })) as (typeof services.$inferInsert)[]);
  }
  await db.insert(tables).values(seats.map((s, i) => ({ id: String(i + 1), venueId: id, name: `T${i + 1}`, seats: s })));
  await addKey(db, `read-${id}`, "reader", [id], "read");
  await addKey(db, `write-${id}`, "writer", [id], "write");
  await addKey(db, `admin-${id}`, "owner", [id], "admin");
}

function call(venue: string, path: string, init: { key?: string; method?: string; body?: unknown } = {}) {
  return app.request(`/v1/venues/${venue}${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: init.key ?? `read-${venue}`,
      "content-type": "application/json",
      "Idempotency-Key": `wd-${++counter}`,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const setService = (venue: string, body: Record<string, unknown>, key = `admin-${venue}`) =>
  call(venue, "/services", { key, method: "POST", body });

async function listServices(venue: string) {
  const res = await call(venue, "/services");
  expect(res.status).toBe(200);
  return ((await res.json()) as { services: { name: string; days: number[] }[] }).services;
}

async function book(venue: string, date: string, time: string, path = "/reservations") {
  const res = await call(venue, path, {
    key: `write-${venue}`,
    method: "POST",
    body: { date, time, partySize: 2 },
  });
  return { status: res.status, body: (await res.json()) as { id?: string; code?: string } };
}

async function cancel(venue: string, id: string | undefined) {
  const res = await call(venue, `/reservations/${id}/cancel`, { key: `write-${venue}`, method: "POST" });
  expect(res.status).toBe(200);
}

async function availability(venue: string, date: string) {
  const res = await call(venue, `/availability?date=${date}&partySize=2`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { availability: Record<string, { time: string; available: boolean }[]> }).availability;
}

async function explain(venue: string, date: string, time: string) {
  const res = await call(venue, `/availability/explain?date=${date}&time=${time}&partySize=2`);
  expect(res.status).toBe(200);
  return (await res.json()) as { available: boolean; reasons: Reason[] };
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

function setClock() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BEFORE);
}

describe("service weekdays", () => {
  it("serves all seven days by default and keeps current behavior", async () => {
    setClock();
    await seedVenue("wd-default", "Europe/Madrid", [{ name: "dinner", openStart: "19:00", openEnd: "23:00" }]);
    expect((await listServices("wd-default"))[0].days).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const created = await setService("wd-default", { name: "lunch", openStart: "12:00", openEnd: "16:00" });
    expect(created.status).toBe(200);
    expect((await listServices("wd-default")).map((s) => s.days)).toEqual([
      [1, 2, 3, 4, 5, 6, 7],
      [1, 2, 3, 4, 5, 6, 7],
    ]);
    for (const date of [MON, THU, SAT, SUN]) {
      const r = await book("wd-default", date, "20:00");
      expect(r.status).toBe(200);
      await cancel("wd-default", r.body.id);
      expect(Object.keys(await availability("wd-default", date)).sort()).toEqual(["dinner", "lunch"]);
    }
  });

  it("blocks create, availability and the explanation on a closed weekday", async () => {
    setClock();
    await seedVenue("wd-closed", "Europe/Madrid", [{ name: "dinner", openStart: "19:00", openEnd: "23:00" }]);
    expect((await setService("wd-closed", { name: "dinner", openStart: "19:00", openEnd: "23:00", days: [4, 5, 6] })).status).toBe(200);

    expect((await book("wd-closed", THU, "20:00")).status).toBe(200);
    const closed = await book("wd-closed", MON, "20:00");
    expect(closed.status).toBe(400);
    expect(closed.body.code).toBe("outside_hours");

    expect(await availability("wd-closed", MON)).toEqual({});
    expect((await availability("wd-closed", SAT)).dinner.length).toBeGreaterThan(0);

    const e = await explain("wd-closed", MON, "20:00");
    expect(e.available).toBe(false);
    expect(e.reasons[0]).toMatchObject({
      code: "outside_hours",
      details: {
        rule: "weekday",
        date: MON,
        weekday: 1,
        services: [{ name: "dinner", openStart: "19:00", openEnd: "23:00", days: [4, 5, 6] }],
      },
    });
    // A time no service covers by hours keeps the hours rule.
    const off = await explain("wd-closed", MON, "03:00");
    expect(off.reasons[0].details.rule).toBe("hours");
    expect((await explain("wd-closed", SAT, "20:00")).available).toBe(true);
  });

  it("updates keep days when omitted, and restoring all seven works", async () => {
    await seedVenue("wd-keep", "Europe/Madrid", []);
    await setService("wd-keep", { name: "dinner", openStart: "19:00", openEnd: "23:00", days: [7, 1] });
    expect((await listServices("wd-keep"))[0].days).toEqual([1, 7]);
    await setService("wd-keep", { name: "dinner", openStart: "19:30", openEnd: "23:00", maxPartySize: 6 });
    expect((await listServices("wd-keep"))[0].days).toEqual([1, 7]);
    await setService("wd-keep", { name: "dinner", openStart: "19:30", openEnd: "23:00", days: [1, 2, 3, 4, 5, 6, 7] });
    expect((await listServices("wd-keep"))[0].days).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("uses the venue time zone, not the UTC date", async () => {
    setClock();
    // Auckland (UTC+13): Friday 08:00 local is Thursday 19:00 UTC.
    await seedVenue("wd-nz", "Pacific/Auckland", [{ name: "breakfast", openStart: "07:00", openEnd: "11:00", days: [5] }]);
    expect((await book("wd-nz", FRI, "08:00")).status).toBe(200);
    expect((await book("wd-nz", THU, "08:00")).body.code).toBe("outside_hours");
    expect(Object.keys(await availability("wd-nz", FRI))).toEqual(["breakfast"]);
    expect(await availability("wd-nz", THU)).toEqual({});
    expect((await explain("wd-nz", FRI, "10:30")).available).toBe(true);
    expect((await explain("wd-nz", THU, "08:00")).reasons[0].details.rule).toBe("weekday");

    // Los Angeles (UTC-8): Thursday 21:00 local is Friday 05:00 UTC.
    await seedVenue("wd-la", "America/Los_Angeles", [{ name: "dinner", openStart: "20:00", openEnd: "23:00", days: [4] }]);
    expect((await book("wd-la", THU, "21:00")).status).toBe(200);
    expect((await book("wd-la", FRI, "21:00")).body.code).toBe("outside_hours");
    expect((await explain("wd-la", THU, "20:00")).reasons.filter((r) => r.code === "outside_hours")).toEqual([]);
  });

  it("gives an overnight service to the day it opens", async () => {
    setClock();
    await seedVenue("wd-night", "Europe/Madrid", [{ name: "late", openStart: "18:00", openEnd: "01:00", days: [5] }], [4, 4]);
    expect((await book("wd-night", FRI, "23:30")).status).toBe(200);
    expect((await book("wd-night", SAT, "00:30")).status).toBe(200);
    expect((await book("wd-night", SAT, "18:00")).body.code).toBe("outside_hours");
    expect((await book("wd-night", SUN, "00:30")).body.code).toBe("outside_hours");
    expect((await book("wd-night", THU, "00:30")).body.code).toBe("outside_hours");

    const fri = (await availability("wd-night", FRI)).late.map((s) => s.time);
    expect(fri).toContain("00:30");
    expect(await availability("wd-night", SAT)).toEqual({});
    expect((await explain("wd-night", SAT, "00:30")).reasons.filter((r) => r.code === "outside_hours")).toEqual([]);
    expect((await explain("wd-night", SUN, "00:30")).reasons[0].details.rule).toBe("weekday");
    expect((await explain("wd-night", SAT, "18:00")).reasons[0].details.rule).toBe("weekday");
  });

  it("holds walk-ins to the weekday and still skips the slot grid", async () => {
    setClock();
    await seedVenue("wd-walk", "Europe/Madrid", [{ name: "dinner", openStart: "19:00", openEnd: "23:00", days: [4] }]);
    expect((await book("wd-walk", THU, "20:07", "/reservations/walk-in")).status).toBe(200);
    const closed = await book("wd-walk", MON, "20:00", "/reservations/walk-in");
    expect(closed.status).toBe(400);
    expect(closed.body.code).toBe("outside_hours");
  });

  it("publishes each service only for its own days in the JSON-LD", async () => {
    await seedVenue("wd-ld", "Europe/Madrid", [
      { name: "lunch", openStart: "13:00", openEnd: "16:00", days: [6, 7] },
      { name: "dinner", openStart: "20:00", openEnd: "23:30" },
      { name: "late", openStart: "22:00", openEnd: "02:00", days: [5] },
    ]);
    await db
      .update(venues)
      .set({ publicProfileEnabled: true, publicStreet: "Calle 1", publicLocality: "Madrid", publicCountry: "ES" })
      .where(eq(venues.id, "wd-ld"));
    const res = await app.request("/v1/venues/wd-ld/public.jsonld");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openingHoursSpecification: { dayOfWeek: string[]; opens: string; closes: string }[] };
    const s = "https://schema.org/";
    const byOpen = Object.fromEntries(doc.openingHoursSpecification.map((e) => [e.opens, e]));
    expect(byOpen["13:00"].dayOfWeek).toEqual([`${s}Saturday`, `${s}Sunday`]);
    expect(byOpen["20:00"].dayOfWeek).toHaveLength(7);
    expect(byOpen["22:00"]).toMatchObject({ dayOfWeek: [`${s}Friday`], closes: "02:00" });
  });

  it("rejects an invalid days list and changes nothing", async () => {
    await seedVenue("wd-val", "Europe/Madrid", [{ name: "dinner", openStart: "19:00", openEnd: "23:00", days: [2] }]);
    for (const days of [[], [0], [8], [1, 1], [1.5], ["1"], null, "1", {}, [1, 2, 3, 4, 5, 6, 7, 7]]) {
      const res = await setService("wd-val", { name: "dinner", openStart: "10:00", openEnd: "11:00", days });
      expect(res.status, JSON.stringify(days)).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe("invalid_request");
    }
    const [dinner] = await listServices("wd-val");
    expect(dinner).toMatchObject({ openStart: "19:00", days: [2] });
  });

  it("lets only an admin write days, and keeps venues apart", async () => {
    await seedVenue("wd-a", "Europe/Madrid", [{ name: "dinner", openStart: "19:00", openEnd: "23:00" }]);
    await seedVenue("wd-b", "Europe/Madrid", [{ name: "dinner", openStart: "19:00", openEnd: "23:00" }]);
    const body = { name: "dinner", openStart: "19:00", openEnd: "23:00", days: [1] };
    for (const key of ["write-wd-a", "read-wd-a"]) {
      const res = await setService("wd-a", body, key);
      expect(res.status).toBe(403);
    }
    expect((await setService("wd-a", body, "admin-wd-b")).status).toBeGreaterThanOrEqual(400);
    expect((await listServices("wd-a"))[0].days).toHaveLength(7);
    expect((await setService("wd-a", body)).status).toBe(200);
    expect((await listServices("wd-a"))[0].days).toEqual([1]);
    expect((await listServices("wd-b"))[0].days).toHaveLength(7);
    expect((await book("wd-b", THU, "20:00")).status).toBe(200);
  });

  it("agrees across create, availability and the explanation over a grid", async () => {
    setClock();
    await seedVenue(
      "wd-grid",
      "Europe/Madrid",
      [
        { name: "lunch", openStart: "12:00", openEnd: "16:00", days: [1, 2, 3, 4, 5] },
        { name: "dinner", openStart: "19:00", openEnd: "23:00", days: [4, 5, 6, 7] },
        { name: "late", openStart: "22:00", openEnd: "01:00", days: [5] },
      ],
      [4],
    );
    const dates = [MON, "2026-11-10", "2026-11-11", THU, FRI, SAT, SUN];
    const times = ["00:00", "00:30", "11:30", "12:00", "14:30", "15:45", "16:00", "19:00", "21:30", "22:30", "23:30"];
    let checked = 0;
    for (const date of dates) {
      const avail = await availability("wd-grid", date);
      const free = new Set(
        Object.values(avail)
          .flat()
          .filter((s) => s.available)
          .map((s) => s.time),
      );
      for (const time of times) {
        const e = await explain("wd-grid", date, time);
        const r = await book("wd-grid", date, time);
        expect(r.status === 200, `create ${date} ${time}`).toBe(e.available);
        if (r.status === 200) await cancel("wd-grid", r.body.id);
        else expect(r.body.code).toBe(e.reasons[0].code);
        // A time past midnight belongs to the previous date's grid, so only the
        // evening times are compared with that date's availability.
        if (time >= "11:00") expect(free.has(time), `availability ${date} ${time}`).toBe(e.available);
        checked++;
      }
    }
    expect(checked).toBe(dates.length * times.length);
  });
});
