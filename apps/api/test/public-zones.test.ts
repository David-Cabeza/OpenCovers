import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.PUBLIC_CHALLENGE_SECRET = "test-secret-for-the-public-form-challenge";
  process.env.PUBLIC_POW_DIFFICULTY = "4";
});

import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { reservations, services, tableAllocations, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { challengeConfigFromEnv, issueChallenge, solve } from "../src/lib/public-challenge";
import { addDays, localDateTime } from "../src/lib/time";

// ADR-0021 stage 5, C66. Every date is a fixed offset from today in a venue open on every weekday, with no lead
// time, so nothing here depends on the weekday or the hour the suite runs at.
const config = challengeConfigFromEnv();
const DATE = addDays(localDateTime(new Date(), "Europe/Madrid").date, 20);
const TIMES = ["20:00", "21:00", "22:00"];

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE events, tombstones, idempotency_keys, table_allocations, reservations, guests, guest_blocklist, grants, api_keys, services, tables, venue_online_booking, venues RESTART IDENTITY CASCADE`,
  );
});

interface Venue {
  id: string;
  admin: string;
  write: string;
  read: string;
  key: string;
}

// Sala has a 4 and a 2, Terraza a 4, Bar a 2, and Privado (not a public zone) an 8.
const LAYOUT: [string, string, number][] = [
  ["s1", "Sala", 4],
  ["s2", "Sala", 2],
  ["t1", "Terraza", 4],
  ["b1", "Bar", 2],
  ["p1", "Privado", 8],
];

let venueCount = 0;
async function makeVenue(
  opts: { settings?: Record<string, unknown>; layout?: [string, string, number][]; serviceNames?: string[] } = {},
): Promise<Venue> {
  venueCount += 1;
  const id = `zn-${venueCount}`;
  await db.insert(venues).values({ id, name: `Casa ${venueCount}`, timezone: "Europe/Madrid", slotIntervalMinutes: 60,
    // Every booking lasts one slot, so a hold at one time never touches the next.
    turnTimes: [{ upTo: 1000, minutes: 60 }],
  });
  const names = opts.serviceNames ?? ["dinner"];
  await db.insert(services).values(
    names.map((name, i) => ({
      venueId: id,
      name,
      openStart: "20:00",
      openEnd: "23:00",
      days: [1, 2, 3, 4, 5, 6, 7],
    })),
  );
  await db.insert(tables).values(
    (opts.layout ?? LAYOUT).map(([t, zone, seats]) => ({ id: `${id}-${t}`, venueId: id, name: t, seats, zone })),
  );
  const keys = { admin: `${id}-admin`, write: `${id}-write`, read: `${id}-read` };
  await addKey(db, keys.admin, `admin-${id}`, [id], "admin");
  await addKey(db, keys.write, `write-${id}`, [id], "write");
  await addKey(db, keys.read, `read-${id}`, [id], "read");
  const res = await app.request(`/v1/venues/${id}/online-booking`, {
    method: "PUT",
    headers: { apikey: keys.admin, "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, maxOpenBookingsPerContact: null, ...opts.settings }),
  });
  if (res.status !== 200) throw new Error(`enable failed: ${await res.text()}`);
  return { id, ...keys, key: (await res.json()).bookingKey };
}

const put = (v: Venue, body: unknown, key: string = v.admin) =>
  app.request(`/v1/venues/${v.id}/online-booking`, {
    method: "PUT",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const read = async (v: Venue) =>
  (await app.request(`/v1/venues/${v.id}/online-booking`, { headers: { apikey: v.admin } })).json();

const ZONES = ["Sala", "Terraza", "Bar"];
const withZones = (settings: Record<string, unknown> = {}) => makeVenue({ settings: { publicZones: ZONES, ...settings } });

const getPublic = (path: string) => app.request(`/v1/public/${path}`);
const configOf = async (v: Venue) => (await getPublic(v.key)).json();
const availability = (v: Venue, partySize: number, zone?: string, date: string = DATE) =>
  getPublic(
    `${v.key}/availability?date=${date}&partySize=${partySize}${zone === undefined ? "" : `&zone=${encodeURIComponent(zone)}`}`,
  );

let contacts = 0;
function createBody(v: Venue, time: string, partySize: number, zone?: unknown) {
  const challenge = issueChallenge(config, v.key, Date.now() - 10_000);
  return {
    date: DATE,
    time,
    partySize,
    ...(zone === undefined ? {} : { zone }),
    guest: { name: "Ana García", contact: `zn${++contacts}@example.com` },
    challenge,
    solution: solve(challenge),
  };
}
const create = (v: Venue, payload: unknown, key: string = crypto.randomUUID()) =>
  app.request(`/v1/public/${v.key}/reservations`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(payload),
  });

async function hold(v: Venue, table: string, time: string) {
  const res = await app.request(`/v1/venues/${v.id}/reservations`, {
    method: "POST",
    headers: { apikey: v.admin, "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({
      date: DATE,
      time,
      partySize: 1,
      tables: [`${v.id}-${table}`],
      guest: { name: "Staff", contact: `hold${++contacts}@example.com` },
    }),
  });
  expect(res.status).toBe(200);
}

async function cancel(v: Venue, id: string) {
  const res = await app.request(`/v1/venues/${v.id}/reservations/${id}/cancel`, {
    method: "POST",
    headers: { apikey: v.admin, "Idempotency-Key": crypto.randomUUID() },
  });
  expect(res.status).toBe(200);
}

const INVALID = { code: "invalid_request", message: "invalid_request", retryable: false };

describe("C66 settings", () => {
  it("reads [] and false for a venue that never set them", async () => {
    const v = await makeVenue();
    expect(await read(v)).toMatchObject({ publicZones: [], showServiceNames: false });
    const saved = await put(v, { enabled: true });
    expect(await saved.json()).toMatchObject({ publicZones: [], showServiceNames: false });
  });

  it("stores 2 to 10 distinct zones of the venue's tables, in the order sent, and [] clears", async () => {
    const v = await makeVenue();
    const res = await put(v, { publicZones: ["Terraza", "Sala"], showServiceNames: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ publicZones: ["Terraza", "Sala"], showServiceNames: true });
    expect(await read(v)).toMatchObject({ publicZones: ["Terraza", "Sala"], showServiceNames: true });
    // A PUT without them keeps both, and does not check the list again.
    await db.update(tables).set({ zone: "Otra" }).where(eq(tables.id, `${v.id}-t1`));
    expect((await put(v, { maxPartySize: 6 })).status).toBe(200);
    expect(await read(v)).toMatchObject({ publicZones: ["Terraza", "Sala"], showServiceNames: true, maxPartySize: 6 });
    expect((await put(v, { publicZones: [] })).status).toBe(200);
    expect(await read(v)).toMatchObject({ publicZones: [], showServiceNames: true });
    expect((await put(v, { showServiceNames: false })).status).toBe(200);
    expect(await read(v)).toMatchObject({ publicZones: [], showServiceNames: false });
  });

  it("refuses every invalid form and changes nothing", async () => {
    await makeVenue({ layout: [["x1", "Patio", 4], ["x2", "Jardin", 4]] });
    const v = await makeVenue();
    await put(v, { publicZones: ["Sala", "Bar"], showServiceNames: true });
    const eleven = Array.from({ length: 11 }, (_, i) => `Z${i}`);
    const invalid: unknown[] = [
      ["Sala"],
      eleven,
      ["Sala", "Sala"],
      ["Sala", ""],
      ["Sala", "Nada"],
      ["Sala", "sala"],
      ["Sala", "Patio"],
      null,
      "Sala",
      ["Sala", 3],
      { 0: "Sala", 1: "Bar" },
      [["Sala"], "Bar"],
    ];
    for (const publicZones of invalid) {
      const res = await put(v, { publicZones });
      expect(res.status, JSON.stringify(publicZones)).toBe(400);
      expect(await res.json()).toEqual(INVALID);
    }
    for (const showServiceNames of [null, "true", 1, "yes"]) {
      expect((await put(v, { showServiceNames })).status).toBe(400);
    }
    // A bad zone next to a good field changes neither.
    expect((await put(v, { maxPartySize: 3, publicZones: ["Sala", "Patio"] })).status).toBe(400);
    expect(await read(v)).toMatchObject({ publicZones: ["Sala", "Bar"], showServiceNames: true, maxPartySize: 8 });
  });

  it("is admin only, and another venue cannot read or write it", async () => {
    const v = await makeVenue();
    for (const key of [v.write, v.read]) {
      const res = await put(v, { publicZones: ZONES, showServiceNames: true }, key);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("forbidden");
    }
    expect(await read(v)).toMatchObject({ publicZones: [], showServiceNames: false });
    const b = await makeVenue();
    const foreign = await app.request(`/v1/venues/${v.id}/online-booking`, {
      method: "PUT",
      headers: { apikey: b.admin, "content-type": "application/json" },
      body: JSON.stringify({ publicZones: ZONES }),
    });
    expect([403, 404]).toContain(foreign.status);
    expect(await read(v)).toMatchObject({ publicZones: [] });
  });
});

describe("C66 effective zones and the config", () => {
  it("lists them in order in the config, and drops a zone no table has any more", async () => {
    const v = await withZones();
    expect((await configOf(v)).zones).toEqual(ZONES);
    // Renamed: the table of Bar now sits in another zone.
    await db.update(tables).set({ zone: "Barra" }).where(eq(tables.id, `${v.id}-b1`));
    expect((await configOf(v)).zones).toEqual(["Sala", "Terraza"]);
    expect(await read(v)).toMatchObject({ publicZones: ZONES });
    // A second table of Sala going away leaves Sala (s1 stays).
    await db.delete(tables).where(eq(tables.id, `${v.id}-s2`));
    expect((await configOf(v)).zones).toEqual(["Sala", "Terraza"]);
    // Terraza deleted: one effective zone is none.
    await db.delete(tables).where(eq(tables.id, `${v.id}-t1`));
    expect((await configOf(v)).zones).toEqual([]);
    // Renamed back: it works again.
    await db.update(tables).set({ zone: "Terraza" }).where(eq(tables.id, `${v.id}-s1`));
    await db.update(tables).set({ zone: "Sala" }).where(eq(tables.id, `${v.id}-b1`));
    expect((await configOf(v)).zones).toEqual(["Sala", "Terraza"]);
  });

  it("has zones [] when none are set, and nothing else changes in the config", async () => {
    const v = await makeVenue();
    const c = await configOf(v);
    expect(c.zones).toEqual([]);
    expect(Object.keys(c).sort()).toContain("zones");
  });

  it("with fewer than two effective zones behaves as without them", async () => {
    const plain = await makeVenue();
    const v = await withZones();
    await db.update(tables).set({ zone: "Nada" }).where(sql`${tables.venueId} = ${v.id} AND ${tables.zone} <> 'Sala'`);
    expect((await configOf(v)).zones).toEqual([]);
    const a = await availability(v, 2);
    const b = await availability(plain, 2);
    expect(Object.keys(await a.json()).sort()).toEqual(["date", "partySize", "reason", "times"]);
    expect(await (await availability(v, 2)).text()).toBe(await b.text());
    expect((await availability(v, 2, "Sala")).status).toBe(400);
    expect((await create(v, createBody(v, "20:00", 2, "Sala"))).status).toBe(400);
  });
});

describe("C66 availability", () => {
  it("is byte for byte the old answer without public zones and service names", async () => {
    const a = await makeVenue();
    const b = await makeVenue();
    for (const party of [1, 2, 4, 6, 8, 9]) {
      const ta = await (await availability(a, party)).text();
      expect(ta).toBe(await (await availability(b, party)).text());
      expect(Object.keys(JSON.parse(ta)).sort()).toEqual(["date", "partySize", "reason", "times"]);
    }
  });

  it("adds slots with zones and keeps times as their union", async () => {
    const v = await withZones();
    await hold(v, "t1", "21:00"); // Terraza has no table at 21:00
    await hold(v, "b1", "22:00");
    await hold(v, "s2", "22:00");
    const res = await availability(v, 2);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slots).toEqual([
      { time: "20:00", zones: ["Sala", "Terraza", "Bar"] },
      { time: "21:00", zones: ["Sala", "Bar"] },
      { time: "22:00", zones: ["Sala", "Terraza"] },
    ]);
    expect(body.times).toEqual(body.slots.map((s: { time: string }) => s.time));
    // A party only the table outside the public zones holds: listed with zones [].
    const big = await (await availability(v, 8)).json();
    expect(big.slots).toEqual(TIMES.map((time) => ({ time, zones: [] })));
    expect(big.times).toEqual(TIMES);
    // The times are those of a venue without public zones.
    const plain = await makeVenue();
    await hold(plain, "t1", "21:00");
    await hold(plain, "b1", "22:00");
    await hold(plain, "s2", "22:00");
    expect((await (await availability(plain, 2)).json()).times).toEqual(body.times);
  });

  it("filters by zone, keeping the full zones of each slot", async () => {
    const v = await withZones();
    await hold(v, "t1", "21:00");
    const t = await (await availability(v, 2, "Terraza")).json();
    expect(t.times).toEqual(["20:00", "22:00"]);
    expect(t.slots.map((s: { time: string }) => s.time)).toEqual(["20:00", "22:00"]);
    expect(t.slots[0].zones).toEqual(ZONES);
    expect((await (await availability(v, 8, "Sala")).json()).times).toEqual([]);
  });

  it("refuses a zone that is not an effective public zone, with one body", async () => {
    const v = await withZones();
    const bodies = new Set<string>();
    for (const zone of ["Privado", "Nada", "", "sala", " Sala", "Sala,Bar"]) {
      const res = await availability(v, 2, zone);
      expect(res.status, zone).toBe(400);
      bodies.add(await res.text());
    }
    expect([...bodies]).toEqual([JSON.stringify(INVALID)]);
  });

  it("names the service only while showServiceNames is on", async () => {
    const v = await makeVenue({ settings: { showServiceNames: true } });
    const body = await (await availability(v, 2)).json();
    expect(body.slots).toEqual(TIMES.map((time) => ({ time, service: "dinner" })));
    expect(body.times).toEqual(TIMES);
    expect((await availability(v, 2, "Sala")).status).toBe(400);
    const both = await makeVenue({ settings: { publicZones: ZONES, showServiceNames: true } });
    const slots = (await (await availability(both, 2)).json()).slots;
    expect(slots[0]).toEqual({ time: "20:00", zones: ZONES, service: "dinner" });
    await put(both, { showServiceNames: false });
    expect((await (await availability(both, 2)).json()).slots[0]).toEqual({ time: "20:00", zones: ZONES });
    const off = await makeVenue({ settings: { showServiceNames: false } });
    expect(JSON.stringify(await (await availability(off, 2)).json())).not.toContain("dinner");
  });

  it("names the service the create books under", async () => {
    const v = await makeVenue({ settings: { showServiceNames: true } });
    const body = await (await availability(v, 2)).json();
    const res = await create(v, createBody(v, "21:00", 2));
    expect(res.status).toBe(200);
    const [row] = await db.select().from(reservations).where(eq(reservations.venueId, v.id));
    expect(body.slots.find((s: { time: string }) => s.time === "21:00").service).toBe(row!.service);
  });

  it("agrees with a create in each zone over zones, party sizes and times", async () => {
    const v = await withZones();
    await hold(v, "s1", "20:00");
    await hold(v, "t1", "21:00");
    await hold(v, "b1", "21:00");
    await hold(v, "s2", "22:00");
    let listed = 0;
    let refused = 0;
    for (const zone of ZONES) {
      for (const party of [1, 2, 3, 4, 5, 6, 8]) {
        const open = (await (await availability(v, party, zone)).json()).times as string[];
        for (const time of TIMES) {
          const res = await create(v, createBody(v, time, party, zone));
          if (open.includes(time)) {
            expect(res.status, `${zone} ${party} ${time}`).toBe(200);
            listed += 1;
            const [row] = await db
              .select()
              .from(reservations)
              .where(and(eq(reservations.venueId, v.id), eq(reservations.bookedVia, "widget")))
              .orderBy(sql`${reservations.createdAt} desc`)
              .limit(1);
            const booked = await db
              .select({ zone: tables.zone })
              .from(tableAllocations)
              .innerJoin(tables, eq(tables.id, tableAllocations.tableId))
              .where(eq(tableAllocations.reservationId, row!.id));
            expect(booked.length).toBeGreaterThan(0);
            expect(booked.every((t) => t.zone === zone)).toBe(true);
            expect(row!.zone).toBe(zone);
            await cancel(v, row!.id);
          } else {
            expect(res.status, `${zone} ${party} ${time}`).toBe(409);
            expect((await res.json()).code).toBe("slot_taken");
            refused += 1;
          }
        }
      }
    }
    expect(listed).toBeGreaterThan(10);
    expect(refused).toBeGreaterThan(10);
  });
});

describe("C66 public create", () => {
  it("books a table of the zone, and fails slot_taken when none there is free, whatever is free elsewhere", async () => {
    const v = await withZones();
    const ok = await create(v, createBody(v, "20:00", 4, "Terraza"));
    expect(ok.status).toBe(200);
    const taken = await create(v, createBody(v, "20:00", 4, "Terraza"));
    expect(taken.status).toBe(409);
    const err = await taken.json();
    expect(err).toEqual({ code: "slot_taken", message: "slot_taken", retryable: false });
    // A party the zone's seats cannot hold is also slot_taken, with no count in the answer.
    const big = await create(v, createBody(v, "21:00", 5, "Bar"));
    expect(big.status).toBe(409);
    expect(await big.json()).toEqual(err);
    // Sala still has tables, and without a zone the create uses every table.
    expect((await create(v, createBody(v, "20:00", 4))).status).toBe(200);
  });

  it("refuses a zone that is not an effective public zone, writing nothing", async () => {
    const v = await withZones();
    for (const zone of ["Privado", "Nada", "", "sala", 3, null, ["Sala"], { a: 1 }]) {
      const res = await create(v, createBody(v, "20:00", 2, zone));
      expect(res.status, JSON.stringify(zone)).toBe(400);
      expect(await res.json()).toEqual(INVALID);
    }
    expect(await db.select().from(reservations).where(eq(reservations.venueId, v.id))).toHaveLength(0);
  });

  it("a create without zone is as before, and the guest view and answers show no zone", async () => {
    const v = await withZones({ showServiceNames: true });
    const res = await create(v, createBody(v, "20:00", 2, "Sala"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/Sala|Terraza|Bar|Privado|zone/);
    const link = await app.request("/v1/public/self-service", { headers: { "X-Self-Service-Token": body.selfServiceToken } });
    expect(JSON.stringify(await link.json())).not.toMatch(/Sala|Terraza|Bar|Privado|zone|dinner/);
    const plain = await create(v, createBody(v, "21:00", 2));
    expect(plain.status).toBe(200);
    const rows = await db.select().from(reservations).where(eq(reservations.venueId, v.id)).orderBy(reservations.startsAt);
    expect(rows.map((r) => r.zone)).toEqual(["Sala", ""]);
  });

  it("replays an idempotent create in a zone: one booking, the same reservation", async () => {
    const v = await withZones();
    const payload = createBody(v, "20:00", 2, "Terraza");
    const key = crypto.randomUUID();
    const first = await create(v, payload, key);
    const again = await create(v, payload, key);
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect((await again.json()).reservation).toEqual((await first.json()).reservation);
    expect(await db.select().from(reservations).where(eq(reservations.venueId, v.id))).toHaveLength(1);
  });

  it("still refuses zone on a guest modify", async () => {
    const v = await withZones();
    const made = await (await create(v, createBody(v, "20:00", 2, "Sala"))).json();
    const res = await app.request("/v1/public/self-service/modify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Self-Service-Token": made.selfServiceToken,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ version: 1, zone: "Bar", partySize: 2 }),
    });
    expect(res.status).toBe(400);
  });
});

describe("C66 isolation and leaks", () => {
  it("never shows the zones of one venue to another, and ignores a stray zone on /days", async () => {
    const a = await withZones();
    const b = await makeVenue({ layout: [["q1", "Patio", 4], ["q2", "Jardin", 4]] });
    expect((await configOf(b)).zones).toEqual([]);
    const body = await (await availability(b, 2)).text();
    expect(body).not.toMatch(/Sala|Terraza|Bar|zones|slots/);
    expect((await availability(b, 2, "Sala")).status).toBe(400);
    expect((await create(b, createBody(b, "20:00", 2, "Sala"))).status).toBe(400);
    const key = await app.request(`/v1/venues/${b.id}/online-booking`, {
      method: "PUT",
      headers: { apikey: b.admin, "content-type": "application/json" },
      body: JSON.stringify({ publicZones: ["Sala", "Bar"] }),
    });
    expect(key.status).toBe(400);
    // /days takes no zone: the same answer with or without it.
    const days = (q: string) => getPublic(`${a.key}/days?partySize=2&from=${DATE}&days=3${q}`).then((r) => r.text());
    expect(await days("&zone=Sala")).toBe(await days(""));
    expect(await days("&zone=Nada")).toBe(await days(""));
  });

  it("holds no table id, count, or zone name beyond the effective ones in any public answer", async () => {
    const v = await withZones({ showServiceNames: true });
    await hold(v, "s1", "20:00");
    const answers = [
      await (await getPublic(v.key)).text(),
      ...(await Promise.all([1, 2, 5, 8].map(async (n) => (await availability(v, n)).text()))),
      await (await availability(v, 2, "Terraza")).text(),
      await (await availability(v, 2, "Privado")).text(),
      await (await create(v, createBody(v, "20:00", 9, "Bar"))).text(),
      await (await create(v, createBody(v, "20:00", 2, "Privado"))).text(),
    ];
    for (const text of answers) {
      expect(text).not.toContain(v.id);
      expect(text).not.toContain("Privado");
      for (const t of ["s1", "s2", "t1", "b1", "p1"]) expect(text).not.toContain(`${v.id}-${t}`);
      expect(text).not.toMatch(/tablesFree|tablesTotal|seatsFree|largestFreeTable|largestParty/);
    }
    // The zone names that do appear are the effective ones only.
    const config = JSON.parse(answers[0]!);
    expect(config.zones).toEqual(ZONES);
  });
});
