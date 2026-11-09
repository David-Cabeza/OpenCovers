import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, tables, venues, waitlist } from "../src/db/schema";
import { getReservation } from "../src/lib/reservations";
import {
  addWaitlist,
  cancelWaitlist,
  listWaitlist,
  seatWaitlist,
} from "../src/lib/waitlist";

async function seedVenue(venueId: string) {
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid" }).onConflictDoNothing();
  await db
    .insert(services)
    .values([{ venueId, name: "all", openStart: "00:00", openEnd: "24:00" }])
    .onConflictDoNothing();
  await db
    .insert(tables)
    .values([
      { id: "1", venueId, name: "T1", seats: 2 },
      { id: "2", venueId, name: "T2", seats: 4 },
    ])
    .onConflictDoNothing();
}

async function entryStatus(entryId: string): Promise<string | null> {
  const row = (
    await db.select().from(waitlist).where(eq(waitlist.id, entryId)).limit(1)
  )[0];
  return row ? row.status : null;
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe("waitlist", () => {
  it("adds and lists waiting guests", async () => {
    await seedVenue("wl-add");
    await addWaitlist(db, "wl-add", { partySize: 2, guestName: "Ana" });
    await addWaitlist(db, "wl-add", { partySize: 4, guestName: "Bea" });
    const entries = await listWaitlist(db, "wl-add");
    expect(entries.map((e) => e.guestName)).toEqual(["Ana", "Bea"]);
    expect(entries.every((e) => e.status === "waiting")).toBe(true);
  });

  it("seats an entry and marks it seated", async () => {
    await seedVenue("wl-seat");
    const added = await addWaitlist(db, "wl-seat", { partySize: 2, guestName: "Carlos" });
    if (!added.ok) throw new Error("add failed");

    const seated = await seatWaitlist(db, "wl-seat", added.id, "seat-k1");
    if (!seated.ok) throw new Error("seat failed");

    const res = await getReservation(db, "wl-seat", seated.reservationId);
    expect(res?.status).toBe("seated");
    expect(res?.guestName).toBe("Carlos");
    expect(await entryStatus(added.id)).toBe("seated");
    expect(await listWaitlist(db, "wl-seat")).toEqual([]);
  });

  it("rejects seating a non-waiting entry", async () => {
    await seedVenue("wl-double");
    const added = await addWaitlist(db, "wl-double", { partySize: 2 });
    if (!added.ok) throw new Error("add failed");
    await seatWaitlist(db, "wl-double", added.id, "k1");
    const again = await seatWaitlist(db, "wl-double", added.id, "k2");
    expect(again).toEqual({ ok: false, code: "invalid_transition" });
  });

  it("cancels an entry", async () => {
    await seedVenue("wl-cancel");
    const added = await addWaitlist(db, "wl-cancel", { partySize: 2 });
    if (!added.ok) throw new Error("add failed");
    const result = await cancelWaitlist(db, "wl-cancel", added.id);
    expect(result).toEqual({ ok: true });
    expect(await entryStatus(added.id)).toBe("cancelled");
    expect(await listWaitlist(db, "wl-cancel")).toEqual([]);
  });

  it("returns not found for an unknown entry", async () => {
    await seedVenue("wl-missing");
    expect(await seatWaitlist(db, "wl-missing", "nope", "k1")).toEqual({
      ok: false,
      code: "waitlist_entry_not_found",
    });
    expect(await cancelWaitlist(db, "wl-missing", "nope")).toEqual({
      ok: false,
      code: "waitlist_entry_not_found",
    });
  });
});
