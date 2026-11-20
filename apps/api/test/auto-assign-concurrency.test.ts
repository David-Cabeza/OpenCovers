import { eq, sql } from "drizzle-orm";
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
import { saturdayAhead } from "./dates";

const DATE = saturdayAhead();
const ROUNDS = 8;
const config = challengeConfigFromEnv();

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE events, tombstones, idempotency_keys, table_allocations, reservations, guests, guest_blocklist, grants, api_keys, services, tables, venue_online_booking, venues RESTART IDENTITY CASCADE`,
  );
});

let venueCount = 0;
async function makeVenue(tableCount: number) {
  const id = `aac-${++venueCount}`;
  await db.insert(venues).values({ id, name: `Casa ${id}`, timezone: "Europe/Madrid" });
  await db.insert(services).values({ venueId: id, name: "dinner", openStart: "20:00", openEnd: "23:00" });
  await db.insert(tables).values(
    Array.from({ length: tableCount }, (_, i) => ({ id: `${id}-t${i}`, venueId: id, name: `T${i}`, seats: 4 })),
  );
  const admin = `${id}-admin`;
  await addKey(db, admin, `admin-${id}`, [id], "admin");
  const res = await app.request(`/v1/venues/${id}/online-booking`, {
    method: "PUT",
    headers: { apikey: admin, "content-type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });
  if (res.status !== 200) throw new Error(`enable failed: ${await res.text()}`);
  return { id, admin, bookingKey: (await res.json()).bookingKey as string };
}

type Venue = Awaited<ReturnType<typeof makeVenue>>;
type Outcome = { status: number; code?: string };

async function outcome(res: Response): Promise<Outcome> {
  const body = await res.json();
  return { status: res.status, code: body.code };
}

function staffBook(v: Venue, n: number) {
  return app
    .request(`/v1/venues/${v.id}/reservations`, {
      method: "POST",
      headers: { apikey: v.admin, "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ date: DATE, time: "20:00", partySize: 2, guestName: `Guest ${n}` }),
    })
    .then(outcome);
}

let contacts = 0;
function publicBook(v: Venue) {
  const challenge = issueChallenge(config, v.bookingKey, Date.now() - 10_000);
  return app
    .request(`/v1/public/${v.bookingKey}/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        date: DATE,
        time: "20:00",
        partySize: 2,
        guest: { name: "Ana", contact: `aac${++contacts}@example.com` },
        challenge,
        solution: solve(challenge),
      }),
    })
    .then(outcome);
}

const channels = [
  { name: "staff route", full: "no_suitable_table", book: (v: Venue, n: number) => staffBook(v, n) },
  { name: "public channel", full: "slot_taken", book: (v: Venue) => publicBook(v) },
];

describe.each(channels)("concurrent auto-assign on the $name", ({ book, full }) => {
  it("books every request when there are as many free tables as requests", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const v = await makeVenue(4);
      const results = await Promise.all([0, 1, 2, 3].map((n) => book(v, n)));
      expect(results.filter((r) => r.code === "slot_taken")).toEqual([]);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      const held = await db.select().from(tableAllocations).where(eq(tableAllocations.venueId, v.id));
      expect(new Set(held.map((a) => a.tableId)).size).toBe(4);
    }
  });

  it("books exactly the free tables and refuses the rest once the tables are gone", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const v = await makeVenue(2);
      const results = await Promise.all([0, 1, 2, 3].map((n) => book(v, n)));
      expect(results.filter((r) => r.status === 200)).toHaveLength(2);
      expect(results.filter((r) => r.status !== 200).map((r) => r.code)).toEqual([full, full]);
      const held = await db.select().from(tableAllocations).where(eq(tableAllocations.venueId, v.id));
      expect(new Set(held.map((a) => a.tableId)).size).toBe(2);
      expect(await db.select().from(reservations).where(eq(reservations.venueId, v.id))).toHaveLength(2);
    }
  });
});

describe("the exclusion constraint stays the final arbiter", () => {
  it("rejects an overlapping allocation written around the planner", async () => {
    const v = await makeVenue(1);
    expect((await staffBook(v, 0)).status).toBe(200);
    const [held] = await db.select().from(tableAllocations).where(eq(tableAllocations.venueId, v.id));
    const [other] = await db.select().from(reservations).where(eq(reservations.venueId, v.id));
    await expect(
      db.insert(tableAllocations).values({
        reservationId: other.id,
        venueId: v.id,
        tableId: held.tableId,
        startsAt: held.startsAt,
        endsAt: held.endsAt,
      }),
    ).rejects.toThrow();
  });
});
