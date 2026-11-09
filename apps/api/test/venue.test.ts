import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { services, tables, venues } from "../src/db/schema";
import { createReservation } from "../src/lib/reservations";
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
  await migrate(db, { migrationsFolder: "migrations" });
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
      config: { enabled: true, noticeAddress: "owner@example.com" },
    });

    const clear = await setConfig(db, "config", { noticeAddress: "" });
    expect(clear).toEqual({ ok: false, code: "notice_address_required" });
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
    expect(config).toEqual({ enabled: false, noticeAddress: "" });

    const again = await erase(db, "erase", "carlos@example.com");
    expect(again).toEqual({ erasedReservations: 0, erasedGuests: 0 });
  });
});
