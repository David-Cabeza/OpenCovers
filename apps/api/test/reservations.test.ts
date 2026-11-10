import { eq, sql } from "drizzle-orm";
import { migrateDb } from "../src/db/migrate";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { services, tableAllocations, tables, venues } from "../src/db/schema";
import {
  cancelReservation,
  createReservation,
  getFloorPlan,
  getPacing,
  getReservation,
  listByPrincipal,
  modifyReservation,
  setStatus,
  walkIn,
} from "../src/lib/reservations";

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

const input = {
  date: "2026-11-12",
  time: "21:00",
  durationMinutes: 120,
  partySize: 2,
  tableIds: ["1"],
};

async function seedZonedVenue(venueId: string) {
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid" }).onConflictDoNothing();
  await db
    .insert(services)
    .values([{ venueId, name: "dinner", openStart: "19:00", openEnd: "23:00" }])
    .onConflictDoNothing();
  await db
    .insert(tables)
    .values([
      { id: "1", venueId, name: "T1", seats: 2, zone: "Terrace" },
      { id: "2", venueId, name: "T2", seats: 4, zone: "Terrace" },
      { id: "3", venueId, name: "T3", seats: 6, zone: "Lounge" },
    ])
    .onConflictDoNothing();
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe("reservations", () => {
  it("creates a reservation", async () => {
    await seedVenue("create");
    const res = await createReservation(db, "create", input, "k1");
    expect(res).toEqual({ ok: true, version: 1, id: expect.any(String) });
  });

  it("rejects an overlapping table and time", async () => {
    await seedVenue("overlap");
    await createReservation(db, "overlap", input, "k1");
    const res = await createReservation(
      db,
      "overlap",
      { ...input, time: "21:30" },
      "k2",
    );
    expect(res).toEqual({ ok: false, code: "slot_taken" });
  });

  it("replays a create with the same idempotency key", async () => {
    await seedVenue("replay");
    const first = await createReservation(db, "replay", input, "k1");
    const second = await createReservation(db, "replay", input, "k1");
    expect(second).toEqual(first);
  });

  it("rejects a party larger than the tables", async () => {
    await seedVenue("capacity");
    const res = await createReservation(
      db,
      "capacity",
      { ...input, partySize: 8, tableIds: ["3"] },
      "k1",
    );
    expect(res).toEqual({ ok: false, code: "party_size_too_large" });
  });

  it("rejects a time outside service hours", async () => {
    await seedVenue("hours");
    const res = await createReservation(
      db,
      "hours",
      { ...input, time: "17:00" },
      "k1",
    );
    expect(res).toEqual({ ok: false, code: "outside_hours" });
  });

  it("modifies and bumps the version", async () => {
    await seedVenue("modify");
    const created = await createReservation(db, "modify", input, "k1");
    if (!created.ok) throw new Error("create failed");
    const m1 = await modifyReservation(db, "modify", created.id, { partySize: 3 }, "k2");
    const m2 = await modifyReservation(db, "modify", created.id, { partySize: 4 }, "k3");
    expect(m1).toEqual({ ok: true, id: created.id, version: 2 });
    expect(m2).toEqual({ ok: true, id: created.id, version: 3 });
  });

  it("does not bump the version on a no-op modify", async () => {
    await seedVenue("modify-noop");
    const created = await createReservation(db, "modify-noop", input, "k1");
    if (!created.ok) throw new Error("create failed");
    const changed = await modifyReservation(db, "modify-noop", created.id, { partySize: 3 }, "k2");
    expect(changed).toEqual({ ok: true, id: created.id, version: 2 });
    const noop = await modifyReservation(db, "modify-noop", created.id, { partySize: 3 }, "k3");
    expect(noop).toEqual({ ok: true, id: created.id, version: 2 });
  });

  it("double-books at most once under concurrency", async () => {
    await seedVenue("concurrent");
    const results = await Promise.all([
      createReservation(db, "concurrent", input, "c1"),
      createReservation(db, "concurrent", input, "c2"),
    ]);
    const ok = results.filter((r) => r.ok);
    const taken = results.filter((r) => !r.ok && r.code === "slot_taken");
    expect(ok).toHaveLength(1);
    expect(taken).toHaveLength(1);
  });

  it("transitions status and rejects invalid transitions", async () => {
    await seedVenue("status");
    const created = await createReservation(db, "status", input, "k1");
    if (!created.ok) throw new Error("create failed");
    const seated = await setStatus(db, "status", created.id, "seated", "k2");
    expect(seated).toEqual({ ok: true, id: created.id, version: 2 });
    const attended = await setStatus(db, "status", created.id, "attended", "k3");
    expect(attended).toEqual({ ok: true, id: created.id, version: 3 });
    const invalid = await setStatus(db, "status", created.id, "no_show", "k4");
    expect(invalid).toEqual({ ok: false, code: "invalid_transition" });
  });

  it("cancels and reports already_cancelled", async () => {
    await seedVenue("cancel");
    const created = await createReservation(db, "cancel", input, "k1");
    if (!created.ok) throw new Error("create failed");
    const cancel = await cancelReservation(db, "cancel", created.id, "k2");
    expect(cancel.ok).toBe(true);
    const again = await cancelReservation(db, "cancel", created.id, "k3");
    expect(again).toEqual({ ok: false, code: "already_cancelled" });
  });

  it("reads a reservation with its service and time", async () => {
    await seedVenue("get");
    const created = await createReservation(db, "get", input, "k1");
    if (!created.ok) throw new Error("create failed");
    const res = await getReservation(db, "get", created.id);
    expect(res?.service).toBe("dinner");
    expect(res?.time).toBe("21:00");
    expect(res?.status).toBe("booked");
  });

  it("lists a principal's reservations only", async () => {
    await seedVenue("list-principal");
    await createReservation(db, "list-principal", { ...input, ownerPrincipal: "agent-a", tableIds: ["1"] }, "k1");
    await createReservation(db, "list-principal", { ...input, ownerPrincipal: "agent-a", tableIds: ["2"] }, "k2");
    await createReservation(db, "list-principal", { ...input, ownerPrincipal: "agent-b", tableIds: ["3"] }, "k3");

    const mine = await listByPrincipal(db, "list-principal", "agent-a");
    expect(mine.map((r) => r.ownerPrincipal)).toEqual(["agent-a", "agent-a"]);
    expect(mine).toHaveLength(2);
  });

  it("reports table occupancy for a floor plan", async () => {
    await seedVenue("floor");
    await createReservation(db, "floor", { ...input, tableIds: ["1"], guestName: "Ana" }, "k1");

    const during = await getFloorPlan(db, "floor", "2026-11-12", "21:30");
    expect(during.find((t) => t.id === "1")?.occupied).toBe(true);
    expect(during.find((t) => t.id === "1")?.guestName).toBe("Ana");
    expect(during.find((t) => t.id === "2")?.occupied).toBe(false);

    const after = await getFloorPlan(db, "floor", "2026-11-12", "23:00");
    expect(after.find((t) => t.id === "1")?.occupied).toBe(false);
  });

  it("reports pacing (covers vs capacity) per slot", async () => {
    await seedVenue("pacing");
    await createReservation(db, "pacing", { ...input, partySize: 2 }, "k1");

    const pacing = await getPacing(db, "pacing", "2026-11-12");
    const dinner = pacing.find((p) => p.service === "dinner");
    expect(dinner).toBeDefined();
    expect(dinner!.slots.find((s) => s.time === "19:00")?.covers).toBe(0);
    expect(dinner!.slots.find((s) => s.time === "21:00")?.covers).toBe(2);
    expect(dinner!.slots.find((s) => s.time === "21:00")?.capacity).toBe(12);
  });
});

async function allocatedTableIds(reservationId: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(tableAllocations)
    .where(eq(tableAllocations.reservationId, reservationId));
  return rows.map((r) => r.tableId).sort();
}

describe("auto-assign tables", () => {
  it("picks the smallest free table that fits the party", async () => {
    await seedVenue("auto-small");
    const res = await createReservation(
      db,
      "auto-small",
      { ...input, tableIds: undefined },
      "k1",
    );
    if (!res.ok) throw new Error("create failed");
    expect(await allocatedTableIds(res.id)).toEqual(["1"]);
  });

  it("picks a single larger table when the party exceeds the small ones", async () => {
    await seedVenue("auto-single");
    const res = await createReservation(
      db,
      "auto-single",
      { ...input, partySize: 5, tableIds: undefined },
      "k1",
    );
    if (!res.ok) throw new Error("create failed");
    expect(await allocatedTableIds(res.id)).toEqual(["3"]);
  });

  it("combines tables when no single table fits", async () => {
    await seedVenue("auto-combo");
    const res = await createReservation(
      db,
      "auto-combo",
      { ...input, partySize: 7, tableIds: undefined },
      "k1",
    );
    if (!res.ok) throw new Error("create failed");
    expect(await allocatedTableIds(res.id)).toEqual(["1", "3"]);
  });

  it("skips occupied tables", async () => {
    await seedVenue("auto-skip");
    await createReservation(db, "auto-skip", { ...input, tableIds: ["1"] }, "busy");
    const res = await createReservation(
      db,
      "auto-skip",
      { ...input, tableIds: undefined },
      "k1",
    );
    if (!res.ok) throw new Error("create failed");
    expect(await allocatedTableIds(res.id)).toEqual(["2"]);
  });

  it("returns no_suitable_table when every table is taken", async () => {
    await seedVenue("auto-full");
    await createReservation(db, "auto-full", { ...input, tableIds: ["1"] }, "b1");
    await createReservation(db, "auto-full", { ...input, tableIds: ["2"] }, "b2");
    await createReservation(db, "auto-full", { ...input, tableIds: ["3"] }, "b3");
    const res = await createReservation(
      db,
      "auto-full",
      { ...input, tableIds: undefined },
      "k1",
    );
    expect(res).toEqual({ ok: false, code: "no_suitable_table" });
  });

  it("returns party_size_too_large when the party exceeds the venue capacity", async () => {
    await seedVenue("auto-capacity");
    const res = await createReservation(
      db,
      "auto-capacity",
      { ...input, partySize: 13, tableIds: undefined },
      "k1",
    );
    expect(res).toEqual({ ok: false, code: "party_size_too_large" });
  });
});

describe("zones", () => {
  it("auto-assigns within the requested zone", async () => {
    await seedZonedVenue("zone-auto");
    const res = await createReservation(
      db,
      "zone-auto",
      { ...input, partySize: 4, tableIds: undefined, zone: "Terrace" },
      "k1",
    );
    if (!res.ok) throw new Error("create failed");
    expect(await allocatedTableIds(res.id)).toEqual(["2"]);
  });

  it("combines tables within the zone", async () => {
    await seedZonedVenue("zone-combo");
    const res = await createReservation(
      db,
      "zone-combo",
      { ...input, partySize: 6, tableIds: undefined, zone: "Terrace" },
      "k1",
    );
    if (!res.ok) throw new Error("create failed");
    expect(await allocatedTableIds(res.id)).toEqual(["1", "2"]);
  });

  it("rejects explicit tables outside the requested zone", async () => {
    await seedZonedVenue("zone-mismatch");
    const res = await createReservation(
      db,
      "zone-mismatch",
      { ...input, tableIds: ["3"], zone: "Terrace" },
      "k1",
    );
    expect(res).toEqual({ ok: false, code: "invalid_request" });
  });

  it("stores and returns the zone", async () => {
    await seedZonedVenue("zone-store");
    const res = await createReservation(
      db,
      "zone-store",
      { ...input, tableIds: ["1"], zone: "Terrace" },
      "k1",
    );
    if (!res.ok) throw new Error("create failed");
    const r = await getReservation(db, "zone-store", res.id);
    expect(r?.zone).toBe("Terrace");
  });
});

describe("walk-in", () => {
  it("seats a guest immediately with explicit tables", async () => {
    await seedVenue("walkin-explicit");
    const res = await walkIn(
      db,
      "walkin-explicit",
      { date: "2026-11-12", time: "21:00", partySize: 2, tableIds: ["1"] },
      "k1",
    );
    if (!res.ok) throw new Error("walk-in failed");
    const r = await getReservation(db, "walkin-explicit", res.id);
    expect(r?.status).toBe("seated");
    expect(await allocatedTableIds(res.id)).toEqual(["1"]);
  });

  it("auto-assigns tables when none are provided", async () => {
    await seedVenue("walkin-auto");
    const res = await walkIn(
      db,
      "walkin-auto",
      { date: "2026-11-12", time: "21:00", partySize: 4 },
      "k1",
    );
    if (!res.ok) throw new Error("walk-in failed");
    const r = await getReservation(db, "walkin-auto", res.id);
    expect(r?.status).toBe("seated");
    expect(await allocatedTableIds(res.id)).toEqual(["2"]);
  });
});

describe("booking rules", () => {
  it("rejects a time off the slot grid", async () => {
    await seedVenue("rules-grid");
    const res = await createReservation(
      db,
      "rules-grid",
      { ...input, time: "19:10" },
      "k1",
    );
    expect(res).toEqual({ ok: false, code: "outside_hours" });
  });

  it("rejects a time after the last seating", async () => {
    await seedVenue("rules-seating");
    await db
      .update(venues)
      .set({ lastSeatingOffsetMinutes: 30 })
      .where(eq(venues.id, "rules-seating"));
    const res = await createReservation(
      db,
      "rules-seating",
      { ...input, time: "22:45" },
      "k1",
    );
    expect(res).toEqual({ ok: false, code: "outside_hours" });
  });

  it("rejects a booking within the lead time", async () => {
    await seedVenue("rules-lead");
    await db
      .update(venues)
      .set({ leadTimeMinutes: 30 })
      .where(eq(venues.id, "rules-lead"));
    const res = await createReservation(
      db,
      "rules-lead",
      { ...input, date: "2020-01-01" },
      "k1",
    );
    expect(res).toEqual({ ok: false, code: "lead_time_violation" });
  });

  it("lets a walk-in bypass the slot grid", async () => {
    await seedVenue("rules-walkin");
    const res = await walkIn(
      db,
      "rules-walkin",
      { date: "2026-11-12", time: "19:10", partySize: 2, tableIds: ["1"] },
      "k1",
    );
    expect(res.ok).toBe(true);
  });
});
