import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import {
  createReservation,
  getEventsWatermark,
  pruneEvents,
} from "../src/lib/reservations";

async function seedVenue(venueId: string) {
  await db
    .insert(venues)
    .values({ id: venueId, timezone: "Europe/Madrid" })
    .onConflictDoNothing();
  await db
    .insert(services)
    .values([{ venueId, name: "dinner", openStart: "19:00", openEnd: "23:00" }])
    .onConflictDoNothing();
  await db
    .insert(tables)
    .values([
      { id: "1", venueId, name: "T1", seats: 2 },
      { id: "2", venueId, name: "T2", seats: 4 },
    ])
    .onConflictDoNothing();
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe("cursor expiry", () => {
  it("prunes events and advances the watermark", async () => {
    await seedVenue("retention");
    await createReservation(db, "retention", { date: "2026-11-12", time: "21:00", durationMinutes: 120, partySize: 2, tableIds: ["1"] }, "k1");
    await createReservation(db, "retention", { date: "2026-11-12", time: "21:00", durationMinutes: 120, partySize: 2, tableIds: ["2"] }, "k2");

    expect(await getEventsWatermark(db, "retention")).toBe(0);
    await pruneEvents(db, "retention", new Date(Date.now() + 86400000));
    expect(await getEventsWatermark(db, "retention")).toBeGreaterThan(0);
  });

  it("rejects a cursor older than the retention watermark", async () => {
    await seedVenue("retention-route");
    await createReservation(db, "retention-route", { date: "2026-11-12", time: "21:00", durationMinutes: 120, partySize: 2, tableIds: ["1"] }, "k1");
    await createReservation(db, "retention-route", { date: "2026-11-12", time: "21:00", durationMinutes: 120, partySize: 2, tableIds: ["2"] }, "k2");
    await pruneEvents(db, "retention-route", new Date(Date.now() + 86400000));
    const watermark = await getEventsWatermark(db, "retention-route");

    await addKey(db, "ret-key", "ret-principal", ["retention-route"], "read");

    const stale = await app.request(
      `/v1/venues/retention-route/events?cursor=retention-route:${watermark - 1}`,
      { headers: { apikey: "ret-key" } },
    );
    expect(stale.status).toBe(400);
    expect(await stale.json()).toEqual({ code: "expired_cursor", message: "expired_cursor" });

    const ok = await app.request(
      `/v1/venues/retention-route/events?cursor=retention-route:${watermark}`,
      { headers: { apikey: "ret-key" } },
    );
    expect(ok.status).toBe(200);
  });
});
