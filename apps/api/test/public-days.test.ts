import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.RATE_LIMIT = "on";
process.env.TRUST_PROXY = "true";
process.env.RATE_LIMIT_PUBLIC_READ = "3/15m";
process.env.RATE_LIMIT_PUBLIC_DAYS = "2/15m";

const { default: app } = await import("../src/app");
const { db } = await import("../src/db/client");
const { migrateDb } = await import("../src/db/migrate");
const { services, tables, venues } = await import("../src/db/schema");
const { addKey } = await import("../src/lib/api-keys");
const { addDays, isoWeekday, localDateTime, toTimestamp } = await import("../src/lib/time");

afterAll(() => {
  for (const name of ["RATE_LIMIT", "TRUST_PROXY", "RATE_LIMIT_PUBLIC_READ", "RATE_LIMIT_PUBLIC_DAYS"]) {
    delete process.env[name];
  }
});
afterEach(() => vi.useRealTimers());

const today = () => localDateTime(new Date(), "Europe/Madrid").date;

// The default service ends in the evening, so a test that reads today's status must not depend on the hour it runs at.
function atMidday() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(toTimestamp(today(), "12:00", "Europe/Madrid"));
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE events, tombstones, idempotency_keys, table_allocations, reservations, guests, guest_blocklist, grants, api_keys, services, tables, venue_online_booking, sent_emails, venues RESTART IDENTITY CASCADE`,
  );
});

interface Venue {
  id: string;
  admin: string;
  key: string;
}

let venueCount = 0;
async function makeVenue(
  opts: { venue?: Partial<typeof venues.$inferInsert>; settings?: Record<string, unknown> } = {},
): Promise<Venue> {
  venueCount += 1;
  const id = `pd-${venueCount}`;
  await db.insert(venues).values({ id, name: `Casa ${venueCount}`, timezone: "Europe/Madrid", ...opts.venue });
  await db.insert(services).values({ venueId: id, name: "dinner", openStart: "20:00", openEnd: "23:00" });
  await db.insert(tables).values([4, 4].map((s, i) => ({ id: `${id}-t${i}`, venueId: id, name: `T${i}`, seats: s })));
  const admin = `${id}-admin`;
  await addKey(db, admin, `admin-${id}`, [id], "admin");
  const res = await app.request(`/v1/venues/${id}/online-booking`, {
    method: "PUT",
    headers: { apikey: admin, "content-type": "application/json", "x-forwarded-for": nextIp() },
    body: JSON.stringify({ enabled: true, ...opts.settings }),
  });
  if (res.status !== 200) throw new Error(`enable failed: ${await res.text()}`);
  return { id, admin, key: (await res.json()).bookingKey };
}

let ips = 0;
const nextIp = () => `198.51.${Math.floor(++ips / 250)}.${(ips % 250) + 1}`;

const get = (path: string, ip: string = nextIp()) => app.request(path, { headers: { "x-forwarded-for": ip } });

interface Day {
  date: string;
  status: string;
  firstTime: string | null;
}
interface Days {
  from: string;
  partySize: number;
  days: Day[];
}

async function days(v: Venue, query: string, ip?: string) {
  const res = await get(`/v1/public/${v.key}/days?${query}`, ip);
  return { res, body: (await res.json()) as Days };
}

async function times(v: Venue, date: string, partySize: number) {
  const res = await get(`/v1/public/${v.key}/availability?date=${date}&partySize=${partySize}`);
  expect(res.status).toBe(200);
  return (await res.json()) as { times: string[]; reason: string | null };
}

// Holds every table at every start of a date, through the staff route, so no public time is left on it.
async function fill(v: Venue, date: string) {
  for (const time of ["20:00", "20:30", "21:00", "21:30", "22:00", "22:30"]) {
    for (let i = 0; i < 2; i += 1) {
      await app.request(`/v1/venues/${v.id}/reservations`, {
        method: "POST",
        headers: { apikey: v.admin, "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          date,
          time,
          partySize: 4,
          guestName: "Staff Entry",
          guestContact: `fill${++ips}@example.com`,
        }),
      });
    }
  }
  expect((await times(v, date, 2)).times).toEqual([]);
}

describe("C63 public day status", () => {
  it("agrees with availability over a grid of dates and party sizes", async () => {
    const start = today();
    const v = await makeVenue({
      venue: { blockedDates: [{ from: addDays(start, 5), to: addDays(start, 6) }] },
      settings: { weekdays: [2, 3, 4, 5, 6, 7], maxAdvanceDays: 12 },
    });
    await fill(v, addDays(start, 3));
    const seen = new Set<string>();
    for (const partySize of [1, 2, 4, 5, 8]) {
      const { res, body } = await days(v, `from=${addDays(start, -2)}&days=14&partySize=${partySize}`);
      expect(res.status).toBe(200);
      expect(body.days).toHaveLength(14);
      for (const day of body.days) {
        const avail = await times(v, day.date, partySize);
        seen.add(day.status);
        if (avail.times.length > 0) {
          expect(day).toEqual({ date: day.date, status: "available", firstTime: avail.times[0] });
        } else if (avail.reason !== null) {
          expect(day).toEqual({ date: day.date, status: "outside_window", firstTime: null });
        } else {
          expect(["closed", "full"]).toContain(day.status);
          expect(day.firstTime).toBeNull();
        }
        expect(day.status === "available").toBe(avail.times.length > 0);
        expect(day.status === "outside_window").toBe(avail.reason !== null);
      }
    }
    expect([...seen].sort()).toEqual(["available", "closed", "full", "outside_window"]);
  });

  it("gives each status: available, closed (weekday, blocked), full, outside_window", async () => {
    const start = addDays(today(), 7);
    const closedWeekday = isoWeekday(start);
    const v = await makeVenue({
      venue: { blockedDates: [{ from: addDays(start, 1), to: addDays(start, 1) }] },
      settings: { weekdays: [1, 2, 3, 4, 5, 6, 7].filter((d) => d !== closedWeekday) },
    });
    await fill(v, addDays(start, 2));
    const { body } = await days(v, `from=${start}&days=4&partySize=2`);
    expect(body.days.map((d) => d.status)).toEqual(["closed", "closed", "full", "available"]);
    expect(body.days[3]!.firstTime).toBe("20:00");
    expect(body.days.slice(0, 3).every((d) => d.firstTime === null)).toBe(true);
    const past = await days(v, `from=${addDays(today(), -1)}&days=1&partySize=2`);
    expect(past.body.days).toEqual([{ date: addDays(today(), -1), status: "outside_window", firstTime: null }]);
  });

  it("a blocked date before today is outside_window, the first status that applies", async () => {
    atMidday();
    const v = await makeVenue({ venue: { blockedDates: [{ from: addDays(today(), -5), to: addDays(today(), -1) }] } });
    const { body } = await days(v, `from=${addDays(today(), -2)}&days=3&partySize=2`);
    expect(body.days.map((d) => d.status)).toEqual(["outside_window", "outside_window", "available"]);
  });

  it("late evening today is closed, not full, and tomorrow is available", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(toTimestamp(today(), "23:30", "Europe/Madrid"));
    const v = await makeVenue();
    const { body } = await days(v, "days=2&partySize=2");
    expect(body.from).toBe(today());
    expect(body.days.map((d) => d.status)).toEqual(["closed", "available"]);
    expect((await times(v, today(), 2)).times).toEqual([]);
  });

  it("every start inside the lead time is closed, a start left to the clock but with no table is full", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(toTimestamp(today(), "12:00", "Europe/Madrid"));
    const lead = await makeVenue({ settings: { leadTimeMinutes: 720 } });
    const a = await days(lead, "days=2&partySize=2");
    expect(a.body.days.map((d) => d.status)).toEqual(["closed", "available"]);
    const held = await makeVenue();
    await fill(held, today());
    const b = await days(held, "days=2&partySize=2");
    expect(b.body.days.map((d) => d.status)).toEqual(["full", "available"]);
  });

  it("today with the early starts past but later starts held is full", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(toTimestamp(today(), "21:00", "Europe/Madrid"));
    const v = await makeVenue();
    // Starts from 21:00 on are still open to the clock. Hold them all.
    for (const time of ["21:00", "21:30", "22:00", "22:30"]) {
      for (let i = 0; i < 2; i += 1) {
        await app.request(`/v1/venues/${v.id}/reservations`, {
          method: "POST",
          headers: { apikey: v.admin, "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ date: today(), time, partySize: 4, guestName: "S", guestContact: `t${++ips}@example.com` }),
        });
      }
    }
    expect((await times(v, today(), 2)).times).toEqual([]);
    const { body } = await days(v, "days=1&partySize=2");
    expect(body.days[0]!.status).toBe("full");
  });

  it("defaults to 12 dates from today, and days 1 and 14 give 1 and 14", async () => {
    const v = await makeVenue();
    const dflt = await days(v, "partySize=2");
    expect(dflt.res.status).toBe(200);
    expect(dflt.body.from).toBe(today());
    expect(dflt.body.partySize).toBe(2);
    expect(dflt.body.days).toHaveLength(12);
    expect(dflt.body.days.map((d) => d.date)).toEqual(Array.from({ length: 12 }, (_, i) => addDays(today(), i)));
    expect((await days(v, "days=1&partySize=2")).body.days).toHaveLength(1);
    expect((await days(v, "days=14&partySize=2")).body.days).toHaveLength(14);
  });

  it("fails with invalid_request on bad days, from and partySize", async () => {
    const v = await makeVenue({ settings: { minPartySize: 2, maxPartySize: 6 } });
    const bad = [
      "days=0&partySize=2",
      "days=15&partySize=2",
      "days=1.5&partySize=2",
      "days=abc&partySize=2",
      "days=&partySize=2",
      "from=2026-02-30&partySize=2",
      "from=2026-1-1&partySize=2",
      "from=1899-12-31&partySize=2",
      "from=9999-01-01&partySize=2",
      "from=&partySize=2",
      "",
      "days=3",
      "partySize=",
      "partySize=0",
      "partySize=-1",
      "partySize=2.5",
      "partySize=abc",
      "partySize=1",
      "partySize=7",
      "partySize=1000000",
    ];
    for (const query of bad) {
      const res = await get(`/v1/public/${v.key}/days?${query}`);
      expect(res.status, query).toBe(400);
      expect((await res.json()).code, query).toBe("invalid_request");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect((await days(v, "partySize=2")).res.status).toBe(200);
    expect((await days(v, "partySize=6")).res.status).toBe(200);
    // Availability answers an empty list for the same small party, the days route does not.
    expect(await times(v, addDays(today(), 3), 1)).toMatchObject({ times: [], reason: null });
  });

  it("from in the past gives outside_window before today, and a range past the horizon is outside_window from there", async () => {
    atMidday();
    const v = await makeVenue({ settings: { maxAdvanceDays: 10 } });
    const past = await days(v, `from=${addDays(today(), -3)}&days=5&partySize=2`);
    expect(past.body.days.map((d) => d.status)).toEqual([
      "outside_window",
      "outside_window",
      "outside_window",
      "available",
      "available",
    ]);
    const far = await days(v, `from=${addDays(today(), 8)}&days=5&partySize=2`);
    expect(far.body.days.map((d) => d.status)).toEqual([
      "available",
      "available",
      "available",
      "outside_window",
      "outside_window",
    ]);
    const old = await days(v, "from=2020-01-01&days=2&partySize=2");
    expect(old.body.days.map((d) => d.status)).toEqual(["outside_window", "outside_window"]);
  });

  it("leaks no table, zone, service, count, venue or guest data, errors included", async () => {
    const v = await makeVenue();
    await fill(v, addDays(today(), 2));
    const allowed = new Set(["from", "partySize", "days", "date", "status", "firstTime"]);
    const keys = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.flatMap(keys)
        : value && typeof value === "object"
          ? Object.entries(value).flatMap(([k, x]) => [k, ...keys(x)])
          : [];
    for (const query of ["days=6&partySize=2", "days=6&partySize=8", "days=0&partySize=2"]) {
      const res = await get(`/v1/public/${v.key}/days?${query}`);
      const text = await res.text();
      const used = res.status === 200 ? keys(JSON.parse(text)) : [];
      expect(used.filter((k) => !allowed.has(k))).toEqual([]);
      for (const word of [v.id, `${v.id}-t`, "dinner", "Casa", "T0", "zone", "tables", "covers", "seats", "guest", v.admin]) {
        expect(text, `${query} ${word}`).not.toContain(word);
      }
    }
  });

  it("an unknown, malformed or disabled key gives the same 404 as the other public routes, with no-store", async () => {
    const v = await makeVenue();
    const off = await makeVenue();
    await app.request(`/v1/venues/${off.id}/online-booking`, {
      method: "PUT",
      headers: { apikey: off.admin, "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    for (const key of ["pk_aaaaaaaaaaaaaaaaaaaaaa", "nope", off.key]) {
      const d = await get(`/v1/public/${key}/days?partySize=2`);
      const a = await get(`/v1/public/${key}/availability?date=${addDays(today(), 1)}&partySize=2`);
      expect(d.status).toBe(404);
      expect((await d.json()).code).toBe("venue_not_found");
      expect(d.headers.get("cache-control")).toBe("no-store");
      expect(await get(`/v1/public/${key}/days?partySize=2`).then((r) => r.text())).toBe(await a.text());
      expect(Object.fromEntries(d.headers)).toMatchObject({ "cache-control": a.headers.get("cache-control") });
    }
    // A bad query on an unknown key is still the 404, so the key decides first.
    expect((await get(`/v1/public/pk_aaaaaaaaaaaaaaaaaaaaaa/days?days=99`)).status).toBe(404);
    expect(v.key).toBeTruthy();
  });

  it("sends no-store, sets no cookie and ignores staff credentials", async () => {
    const v = await makeVenue();
    const plain = await get(`/v1/public/${v.key}/days?days=3&partySize=2`);
    expect(plain.headers.get("cache-control")).toBe("no-store");
    expect(plain.headers.get("set-cookie")).toBeNull();
    expect(plain.headers.get("access-control-allow-origin")).toBeNull();
    const withKey = await app.request(`/v1/public/${v.key}/days?days=3&partySize=2`, {
      headers: { apikey: v.admin, "x-forwarded-for": nextIp() },
    });
    expect(await withKey.text()).toBe(await plain.text());
  });

  it("keeps venues apart: each key sees only its own venue", async () => {
    const a = await makeVenue({ venue: { blockedDates: [{ from: addDays(today(), 1), to: addDays(today(), 1) }] } });
    const b = await makeVenue();
    await fill(a, addDays(today(), 2));
    const fromA = (await days(a, `from=${addDays(today(), 1)}&days=3&partySize=2`)).body;
    const fromB = (await days(b, `from=${addDays(today(), 1)}&days=3&partySize=2`)).body;
    expect(fromA.days.map((d) => d.status)).toEqual(["closed", "full", "available"]);
    expect(fromB.days.map((d) => d.status)).toEqual(["available", "available", "available"]);
    expect(await db.select().from(venues).where(eq(venues.id, b.id))).toHaveLength(1);
  });
});

describe("C52 the public_days rule", () => {
  it("is 60 per 15 minutes by default and RATE_LIMIT_PUBLIC_DAYS sets it", async () => {
    const { DEFAULT_RULES, rateLimitConfigFromEnv, rulesFor } = await import("../src/lib/rate-limit");
    expect(DEFAULT_RULES.public_days).toEqual({ max: 60, windowMs: 15 * 60_000 });
    expect(rateLimitConfigFromEnv({ RATE_LIMIT_PUBLIC_DAYS: "7/1h" }).rules.public_days).toEqual({
      max: 7,
      windowMs: 3_600_000,
    });
    expect(() => rateLimitConfigFromEnv({ RATE_LIMIT_PUBLIC_DAYS: "lots" })).toThrow(/RATE_LIMIT_PUBLIC_DAYS/);
    expect(rulesFor("GET", "/v1/public/pk_x/days", false)).toEqual(["public_read", "public_days"]);
    expect(rulesFor("GET", "/v1/public//pk_x/days/", false)).toEqual(["public_read", "public_days"]);
    expect(rulesFor("GET", "/v1/public/pk_x/availability", false)).toEqual(["public_read"]);
  });

  it("refuses at the budget with 429, rate_limited, Retry-After and no-store", async () => {
    const v = await makeVenue();
    const ip = "203.0.113.10";
    expect((await get(`/v1/public/${v.key}/days?partySize=2`, ip)).status).toBe(200);
    expect((await get(`/v1/public/${v.key}/days?partySize=2`, ip)).status).toBe(200);
    const refused = await get(`/v1/public/${v.key}/days?partySize=2`, ip);
    expect(refused.status).toBe(429);
    expect((await refused.json()).code).toBe("rate_limited");
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(refused.headers.get("cache-control")).toBe("no-store");
    // Another address, and the same address on another public read, are not stopped by it.
    expect((await get(`/v1/public/${v.key}/days?partySize=2`, "203.0.113.11")).status).toBe(200);
    expect((await get(`/v1/public/${v.key}/availability?date=${addDays(today(), 1)}&partySize=2`, ip)).status).toBe(200);
  });

  it("a days read is also charged on public_read", async () => {
    const v = await makeVenue();
    const ip = "203.0.113.20";
    expect((await get(`/v1/public/${v.key}/days?partySize=2`, ip)).status).toBe(200);
    expect((await get(`/v1/public/${v.key}/availability?date=${addDays(today(), 1)}&partySize=2`, ip)).status).toBe(200);
    expect((await get(`/v1/public/${v.key}/availability?date=${addDays(today(), 1)}&partySize=2`, ip)).status).toBe(200);
    // public_read (3) is spent although public_days (2) is not.
    expect((await get(`/v1/public/${v.key}/days?partySize=2`, ip)).status).toBe(429);
  });

  it("a refused request charges neither rule", async () => {
    const v = await makeVenue();
    const ip = "203.0.113.30";
    expect((await get(`/v1/public/${v.key}/days?partySize=2`, ip)).status).toBe(200);
    expect((await get(`/v1/public/${v.key}/days?partySize=2`, ip)).status).toBe(200);
    // public_days is spent: these are refused and must not charge public_read (2 of 3 used).
    expect((await get(`/v1/public/${v.key}/days?partySize=2`, ip)).status).toBe(429);
    expect((await get(`/v1/public/${v.key}/days?partySize=2`, ip)).status).toBe(429);
    expect((await get(`/v1/public/${v.key}/availability?date=${addDays(today(), 1)}&partySize=2`, ip)).status).toBe(200);
    expect((await get(`/v1/public/${v.key}/availability?date=${addDays(today(), 1)}&partySize=2`, ip)).status).toBe(429);
  });

  it("the other direction: a refusal by public_read does not charge public_days", async () => {
    const { Hono } = await import("hono");
    const { createRateLimiter, rateLimitConfigFromEnv } = await import("../src/lib/rate-limit");
    let at = 0;
    const config = rateLimitConfigFromEnv({
      RATE_LIMIT: "on",
      RATE_LIMIT_PUBLIC_READ: "1/1m",
      RATE_LIMIT_PUBLIC_DAYS: "2/10m",
    });
    const probe = new Hono();
    probe.use("*", createRateLimiter(config, { now: () => at }).middleware);
    probe.get("/v1/public/:key/days", (c) => c.json({}));
    const status = async () => (await probe.request("/v1/public/pk_x/days")).status;
    expect(await status()).toBe(200);
    for (let i = 0; i < 5; i += 1) expect(await status()).toBe(429);
    at = 61_000;
    expect(await status()).toBe(200); // public_days is at 2 of 2, so the five refusals were not charged
    expect(await status()).toBe(429);
    at = 122_000;
    expect(await status()).toBe(429); // now public_days is spent
  });
});
