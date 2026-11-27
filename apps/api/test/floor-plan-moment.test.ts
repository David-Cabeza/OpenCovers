import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";

const VENUE = "floor-moment";
const KEY = "floor-moment-key";

async function occupiedAt(time: string): Promise<boolean> {
  const res = await app.request(`/v1/venues/${VENUE}/floor?date=2027-06-12&time=${time}`, { headers: { apikey: KEY } });
  expect(res.status).toBe(200);
  return (await res.json()).tables[0].occupied;
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(sql`TRUNCATE TABLE events, idempotency_keys, table_allocations, reservations, api_keys, services, tables, venues RESTART IDENTITY CASCADE`);
  await db.insert(venues).values({ id: VENUE, timezone: "Europe/Madrid" });
  await db.insert(services).values([{ venueId: VENUE, name: "dinner", openStart: "19:00", openEnd: "23:59" }]);
  await db.insert(tables).values([{ id: "1", venueId: VENUE, name: "T1", seats: 4 }]);
  await addKey(db, KEY, "floor-moment", [VENUE], "write");
  const res = await app.request(`/v1/venues/${VENUE}/reservations`, {
    method: "POST",
    headers: { apikey: KEY, "content-type": "application/json", "Idempotency-Key": "floor-moment-1" },
    body: JSON.stringify({ date: "2027-06-12", time: "21:00", partySize: 2 }),
  });
  expect(res.status).toBe(200);
});

describe("which moments a booking holds its table on the floor plan", () => {
  it("holds it from the exact start minute until just before the end", async () => {
    expect(await occupiedAt("20:59")).toBe(false);
    expect(await occupiedAt("21:00")).toBe(true);
    expect(await occupiedAt("22:59")).toBe(true);
    expect(await occupiedAt("23:00")).toBe(false);
  });
});
