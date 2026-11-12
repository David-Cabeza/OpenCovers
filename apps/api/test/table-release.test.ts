import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, tableAllocations, tables, venues } from "../src/db/schema";
import {
  createReservation,
  getAvailability,
  getFloorPlan,
  getReservation,
  modifyReservation,
  setStatus,
  walkIn,
} from "../src/lib/reservations";

async function seedTwoTopVenue(venueId: string) {
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid" });
  await db
    .insert(services)
    .values([{ venueId, name: "dinner", openStart: "19:00", openEnd: "23:00" }]);
  await db.insert(tables).values([
    { id: "1", venueId, name: "T1", seats: 2 },
    { id: "2", venueId, name: "T2", seats: 2 },
  ]);
}

async function seedSingleTableVenue(venueId: string) {
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid" });
  await db
    .insert(services)
    .values([{ venueId, name: "dinner", openStart: "19:00", openEnd: "23:00" }]);
  await db.insert(tables).values([{ id: "1", venueId, name: "T1", seats: 2 }]);
}

const booking = {
  date: "2026-11-12",
  time: "21:00",
  durationMinutes: 120,
  partySize: 2,
  tableIds: ["1"],
};

async function allocatedTableIds(reservationId: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(tableAllocations)
    .where(eq(tableAllocations.reservationId, reservationId));
  return rows.map((r) => r.tableId).sort();
}

async function bookOnTableOne(venueId: string, key: string): Promise<string> {
  const created = await createReservation(db, venueId, booking, key);
  if (!created.ok) throw new Error(`create failed: ${created.code}`);
  return created.id;
}

async function attend(venueId: string, id: string) {
  expect((await setStatus(db, venueId, id, "seated", `${id}-seat`)).ok).toBe(true);
  expect((await setStatus(db, venueId, id, "attended", `${id}-attend`)).ok).toBe(true);
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe("tables released after the visit", () => {
  it("seats walk-ins on every table once the earlier party attended", async () => {
    await seedTwoTopVenue("release-attended");
    const earlier = await bookOnTableOne("release-attended", "k1");
    await attend("release-attended", earlier);

    const first = await walkIn(
      db,
      "release-attended",
      { date: "2026-11-12", time: "21:30", partySize: 2 },
      "w1",
    );
    const second = await walkIn(
      db,
      "release-attended",
      { date: "2026-11-12", time: "21:30", partySize: 2 },
      "w2",
    );
    if (!first.ok || !second.ok) throw new Error("walk-in failed");
    const seated = [
      ...(await allocatedTableIds(first.id)),
      ...(await allocatedTableIds(second.id)),
    ].sort();
    expect(seated).toEqual(["1", "2"]);
  });

  it("lets a no-show's table be booked again for an overlapping time", async () => {
    await seedSingleTableVenue("release-no-show");
    const missed = await bookOnTableOne("release-no-show", "k1");
    expect((await setStatus(db, "release-no-show", missed, "no_show", "k2")).ok).toBe(true);

    const again = await createReservation(
      db,
      "release-no-show",
      { ...booking, time: "21:30" },
      "k3",
    );
    expect(again).toEqual({ ok: true, id: expect.any(String), version: 1 });
  });

  it("shows a released table as free in availability and the floor view", async () => {
    await seedSingleTableVenue("release-reads");
    const missed = await bookOnTableOne("release-reads", "k1");

    const before = await getAvailability(db, "release-reads", "2026-11-12", 2);
    expect(before.dinner.find((s) => s.time === "21:00")?.available).toBe(false);

    await setStatus(db, "release-reads", missed, "no_show", "k2");

    const after = await getAvailability(db, "release-reads", "2026-11-12", 2);
    expect(after.dinner.find((s) => s.time === "21:00")?.available).toBe(true);
    const floor = await getFloorPlan(db, "release-reads", "2026-11-12", "21:30");
    expect(floor.find((t) => t.id === "1")?.occupied).toBe(false);
  });

  it("moves a booked reservation onto a table an attended party left", async () => {
    await seedTwoTopVenue("release-modify");
    const earlier = await bookOnTableOne("release-modify", "k1");
    await attend("release-modify", earlier);
    const later = await createReservation(
      db,
      "release-modify",
      { ...booking, time: "21:30", tableIds: ["2"] },
      "k2",
    );
    if (!later.ok) throw new Error("create failed");

    const moved = await modifyReservation(db, "release-modify", later.id, { tableIds: ["1"] }, "k3");
    expect(moved).toEqual({ ok: true, id: later.id, version: 2 });
    expect(await allocatedTableIds(later.id)).toEqual(["1"]);
  });

  it("books a free table at most once under concurrency", async () => {
    await seedSingleTableVenue("release-concurrent");
    const missed = await bookOnTableOne("release-concurrent", "k1");
    await setStatus(db, "release-concurrent", missed, "no_show", "k2");

    const results = await Promise.all([
      createReservation(db, "release-concurrent", booking, "c1"),
      createReservation(db, "release-concurrent", booking, "c2"),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code === "slot_taken")).toHaveLength(1);
  });

  it("keeps the tables of an attended reservation", async () => {
    await seedTwoTopVenue("release-keeps");
    const earlier = await bookOnTableOne("release-keeps", "k1");
    await attend("release-keeps", earlier);

    expect((await getReservation(db, "release-keeps", earlier))?.status).toBe("attended");
    expect(await allocatedTableIds(earlier)).toEqual(["1"]);
  });

  it("still blocks an overlapping booking on a booked table", async () => {
    await seedSingleTableVenue("hold-booked");
    await bookOnTableOne("hold-booked", "k1");

    const overlap = await createReservation(
      db,
      "hold-booked",
      { ...booking, time: "21:30" },
      "k2",
    );
    expect(overlap).toEqual({ ok: false, code: "slot_taken" });
  });

  it("still blocks an overlapping booking on a seated table", async () => {
    await seedSingleTableVenue("hold-seated");
    const id = await bookOnTableOne("hold-seated", "k1");
    expect((await setStatus(db, "hold-seated", id, "seated", "k2")).ok).toBe(true);

    const overlap = await createReservation(
      db,
      "hold-seated",
      { ...booking, time: "21:30" },
      "k3",
    );
    expect(overlap).toEqual({ ok: false, code: "slot_taken" });
    const walk = await walkIn(
      db,
      "hold-seated",
      { date: "2026-11-12", time: "21:30", partySize: 2 },
      "k4",
    );
    expect(walk).toEqual({ ok: false, code: "no_suitable_table" });
  });
});
