import { eq, sql } from "drizzle-orm";
import { migrateDb } from "../src/db/migrate";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { createReservation } from "../src/lib/reservations";
import { listTables } from "../src/lib/catalog";
import { erase, getConfig, setConfig } from "../src/lib/venue";

async function seedVenue(venueId: string) {
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid" }).onConflictDoNothing();
  await db
    .insert(services)
    .values([
      { venueId, name: "lunch", openStart: "12:00", openEnd: "16:00" },
      { venueId, name: "dinner", openStart: "19:00", openEnd: "23:00" },
    ])
    .onConflictDoNothing();
  await db
    .insert(tables)
    .values([
      { id: "1", venueId, name: "T1", seats: 2 },
      { id: "2", venueId, name: "T2", seats: 4 },
      { id: "3", venueId, name: "T3", seats: 6 },
    ])
    .onConflictDoNothing();
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe("venue config and erasure", () => {
  it("enforces the notice address rule", async () => {
    await seedVenue("config");
    const enable = await setConfig(db, "config", { enabled: true });
    expect(enable).toEqual({ ok: false, code: "notice_address_required" });

    await setConfig(db, "config", { noticeAddress: "owner@example.com" });
    const enableOk = await setConfig(db, "config", { enabled: true });
    expect(enableOk).toEqual({
      ok: true,
      config: {
        enabled: true,
        noticeAddress: "owner@example.com",
        notificationsEnabled: false,
        resendConfigured: false,
        fromEmail: "",
        slotIntervalMinutes: 15,
        leadTimeMinutes: 0,
        lastSeatingOffsetMinutes: 0,
      },
    });

    const clear = await setConfig(db, "config", { noticeAddress: "" });
    expect(clear).toEqual({ ok: false, code: "notice_address_required" });
  });

  it("stores the Resend key without exposing it", async () => {
    await seedVenue("resend");
    const set = await setConfig(db, "resend", {
      resendApiKey: "re_test_123",
      fromEmail: "bookings@venue.com",
    });
    if (!set.ok) throw new Error("setConfig failed");
    expect(set.config.resendConfigured).toBe(true);
    expect(set.config.fromEmail).toBe("bookings@venue.com");
    expect("resendApiKey" in set.config).toBe(false);

    const config = await getConfig(db, "resend");
    expect(config?.resendConfigured).toBe(true);
    expect("resendApiKey" in (config ?? {})).toBe(false);

    const row = (
      await db.select().from(venues).where(eq(venues.id, "resend")).limit(1)
    )[0];
    expect(row.resendApiKey).toBe("re_test_123");
  });

  it("erases personal data and is idempotent", async () => {
    await seedVenue("erase");
    const created = await createReservation(
      db,
      "erase",
      {
        date: "2026-11-12",
        time: "21:00",
        durationMinutes: 120,
        partySize: 2,
        tableIds: ["1"],
        guestName: "Carlos",
        guestContact: "carlos@example.com",
      },
      "k1",
    );
    if (!created.ok) throw new Error("create failed");

    const res = await erase(db, "erase", "carlos@example.com");
    expect(res).toEqual({ erasedReservations: 1, erasedGuests: 1 });

    const config = await getConfig(db, "erase");
    expect(config).toEqual({
      enabled: false,
      noticeAddress: "",
      notificationsEnabled: false,
      resendConfigured: false,
      fromEmail: "",
      slotIntervalMinutes: 15,
      leadTimeMinutes: 0,
      lastSeatingOffsetMinutes: 0,
    });

    const again = await erase(db, "erase", "carlos@example.com");
    expect(again).toEqual({ erasedReservations: 0, erasedGuests: 0 });
  });

  it("lists tables for a venue over the API", async () => {
    await seedVenue("tables-venue");
    const tables = await listTables(db, "tables-venue");
    expect(tables).toEqual([
      { id: "1", name: "T1", seats: 2, zone: "", posX: 0, posY: 0 },
      { id: "2", name: "T2", seats: 4, zone: "", posX: 0, posY: 0 },
      { id: "3", name: "T3", seats: 6, zone: "", posX: 0, posY: 0 },
    ]);

    await addKey(db, "tables-key", "tables-principal", ["tables-venue"], "read");
    const res = await app.request("/v1/venues/tables-venue/tables", {
      headers: { apikey: "tables-key" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tables });
  });
});
