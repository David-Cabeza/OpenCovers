import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";

const ROUNDS = 15;
let requestCounter = 0;

async function seedVenue(venueId: string) {
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid" });
  await db.insert(services).values([{ venueId, name: "dinner", openStart: "19:00", openEnd: "23:00" }]);
  await db.insert(tables).values([{ id: "1", venueId, name: "T1", seats: 4 }]);
  await addKey(db, `admin-${venueId}`, "boss", [venueId], "admin");
  await addKey(db, `write-${venueId}`, "writer", [venueId], "write");
}

function call(venueId: string, path: string, method: string, body: unknown, key = `admin-${venueId}`) {
  return app.request(`/v1/venues/${venueId}${path}`, {
    method,
    headers: { apikey: key, "content-type": "application/json", "Idempotency-Key": `cc-${++requestCounter}` },
    body: JSON.stringify(body),
  });
}

const putConfig = (venueId: string, body: Record<string, unknown>) => call(venueId, "/config", "PUT", body);

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe("concurrent config updates", () => {
  it("keeps both changes when two updates touch different fields", async () => {
    const venueId = "cfg-race";
    await seedVenue(venueId);
    for (let round = 1; round <= ROUNDS; round++) {
      const range = [{ from: `2027-01-${String(round).padStart(2, "0")}`, to: `2027-01-${String(round).padStart(2, "0")}` }];
      const [a, b] = await Promise.all([
        putConfig(venueId, { blockedDates: range }),
        putConfig(venueId, { leadTimeMinutes: 10 + round }),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      const row = (await db.select().from(venues).where(eq(venues.id, venueId)))[0];
      expect(row.blockedDates, `round ${round}`).toEqual(range);
      expect(row.leadTimeMinutes, `round ${round}`).toBe(10 + round);
    }
  });

  it("keeps both changes for a second pair of fields", async () => {
    const venueId = "cfg-race-2";
    await seedVenue(venueId);
    for (let round = 1; round <= ROUNDS; round++) {
      const [a, b] = await Promise.all([
        putConfig(venueId, { overbookingCeiling: round }),
        putConfig(venueId, { slotIntervalMinutes: 5 + round }),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      const row = (await db.select().from(venues).where(eq(venues.id, venueId)))[0];
      expect(row.overbookingCeiling, `round ${round}`).toBe(round);
      expect(row.slotIntervalMinutes, `round ${round}`).toBe(5 + round);
    }
  });

  it("does not make bookings wait while a config update holds the venue row", async () => {
    const venueId = "cfg-race-3";
    await seedVenue(venueId);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const held = new Promise<void>((resolve) => (locked = resolve));
    // A transaction holding the same row lock setConfig takes.
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM venues WHERE id = ${venueId} FOR NO KEY UPDATE`);
      locked();
      await gate;
    });
    await held;
    try {
      const res = await Promise.race([
        call(venueId, "/reservations", "POST", { date: "2027-02-10", time: "21:00", partySize: 2 }, `write-${venueId}`),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ]);
      expect(res, "booking blocked behind the venue row lock").not.toBeNull();
      expect(res?.status).toBe(200);
    } finally {
      release();
      await holder;
    }
  });
});
