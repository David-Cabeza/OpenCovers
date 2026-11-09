import { sql } from "drizzle-orm";
import { migrateDb } from "../src/db/migrate";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { services, tables, venues } from "../src/db/schema";
import {
  cancelReservation,
  createReservation,
  getReservation,
  modifyReservation,
  setStatus,
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
});
