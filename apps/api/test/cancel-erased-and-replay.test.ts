import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { idempotencyKeys, reservations, services, tableAllocations, tables, tombstones, venues } from "../src/db/schema";
import { cancelReservation, createReservation } from "../src/lib/reservations";
import { appendEvents } from "../src/lib/events";
import { eraseReservations } from "../src/lib/venue";

const DATE = "2026-11-12";
const NOW = new Date("2026-11-10T10:00:00Z");
let counter = 0;

async function seedVenue(leadTimeMinutes = 0) {
  const venueId = `cer-${++counter}`;
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid", leadTimeMinutes });
  await db.insert(services).values([{ venueId, name: "all", openStart: "00:00", openEnd: "24:00" }]);
  await db.insert(tables).values([{ id: "1", venueId, name: "T1", seats: 4 }]);
  return venueId;
}

const input = (time = "20:00") => ({ date: DATE, time, partySize: 2, guestName: "Ana", guestContact: "+34600000001" });

async function book(venueId: string, key: string, time = "20:00") {
  const res = await createReservation(db, venueId, input(time), key);
  if (!res.ok) throw new Error(`create failed: ${res.code}`);
  return res;
}

async function erase(venueId: string, id: string) {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(reservations).where(eq(reservations.id, id));
    await appendEvents(tx, venueId, await eraseReservations(tx, venueId, [{ id, version: row.version }]));
  });
}

const held = async (id: string) =>
  (await db.select().from(tableAllocations).where(eq(tableAllocations.reservationId, id))).length;
const tombstoneCount = async (id: string) =>
  (await db.select().from(tombstones).where(eq(tombstones.reservationId, id))).length;

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, guest_audit, guests, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("cancel of an erased booking", () => {
  it("cancels it, frees the table and keeps one tombstone", async () => {
    const venueId = await seedVenue();
    const { id } = await book(venueId, "k-create");
    await erase(venueId, id);
    expect(await held(id)).toBe(1);

    const res = await cancelReservation(db, venueId, id, "k-cancel", null);
    expect(res.ok).toBe(true);
    expect(await held(id)).toBe(0);
    expect(await tombstoneCount(id)).toBe(1);
    const [row] = await db.select().from(reservations).where(eq(reservations.id, id));
    expect(row.status).toBe("cancelled");
    expect(row.erased).toBe(true);
    expect(await cancelReservation(db, venueId, id, "k-cancel", null)).toMatchObject({ ok: true });
  });

  it("answers already_cancelled for cancel, erase, cancel", async () => {
    const venueId = await seedVenue();
    const { id } = await book(venueId, "k-create");
    expect((await cancelReservation(db, venueId, id, "k-c1", null)).ok).toBe(true);
    await erase(venueId, id);
    expect(await cancelReservation(db, venueId, id, "k-c2", null)).toEqual({ ok: false, code: "already_cancelled" });
    expect(await tombstoneCount(id)).toBe(1);
    const keys = await db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.venueId, venueId), eq(idempotencyKeys.key, "k-c2")));
    expect(keys).toHaveLength(0);
  });
});

describe("a create replay ignores the rules and the clock of now", () => {
  it("returns the stored answer after the date is blocked, and refuses a new key", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const venueId = await seedVenue();
    const first = await book(venueId, "k-1");
    await db.update(venues).set({ blockedDates: [{ from: DATE, to: DATE }] }).where(eq(venues.id, venueId));

    expect(await createReservation(db, venueId, input(), "k-1")).toEqual(first);
    expect(await createReservation(db, venueId, input(), "k-2")).toEqual({ ok: false, code: "date_blocked" });
    const keys = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.venueId, venueId));
    expect(keys.map((k) => k.key)).toEqual(["k-1"]);
  });

  it("returns the stored answer after the clock crosses the lead time, and refuses a new key", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T16:00:00Z")); // 17:00 in Madrid, 20:00 is 180 min away
    const venueId = await seedVenue(120);
    const first = await book(venueId, "k-1");

    vi.setSystemTime(new Date("2026-11-12T17:30:00Z")); // now inside the 120 minute lead time
    expect(await createReservation(db, venueId, input(), "k-1")).toEqual(first);
    expect(await createReservation(db, venueId, input(), "k-2")).toMatchObject({ ok: false, code: "lead_time_violation" });
  });

  it("leaves the key free when a first attempt is refused", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const venueId = await seedVenue();
    await db.update(venues).set({ blockedDates: [{ from: DATE, to: DATE }] }).where(eq(venues.id, venueId));
    expect(await createReservation(db, venueId, input(), "k-1")).toEqual({ ok: false, code: "date_blocked" });
    await db.update(venues).set({ blockedDates: [] }).where(eq(venues.id, venueId));
    expect((await createReservation(db, venueId, input(), "k-1")).ok).toBe(true);
  });
});
