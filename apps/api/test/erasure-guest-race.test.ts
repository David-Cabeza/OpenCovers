import { and, eq, isNotNull, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { guests, reservations, services, tables, venues } from "../src/db/schema";
import { mergeGuest, unmergeGuest } from "../src/lib/guests";
import { createReservation } from "../src/lib/reservations";
import { erase } from "../src/lib/venue";

// Erasure against the writers that lock a guest: a booking created for the guest while erasure runs, and a
// merge or unmerge of the guest. A deadlock shows as a rejected call (Postgres aborts one side with 40P01
// after `deadlock_timeout`, 1 s by default). The merge and unmerge cases pin the interleaving that deadlocks
// with a lock held from outside, as a free race hits it about once in 200 rounds.

const ROUNDS = 25;
const EVA = "eva@example.com";
const ANA = "ana@example.com";

async function seedVenue(venueId: string) {
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid" });
  await db.insert(services).values([{ venueId, name: "dinner", openStart: "00:00", openEnd: "23:59" }]);
  await db.insert(tables).values([
    { id: "1", venueId, name: "T1", seats: 2 },
    { id: "2", venueId, name: "T2", seats: 2 },
    { id: "3", venueId, name: "T3", seats: 2 },
  ]);
}

async function book(venueId: string, contact: string, name: string, tableId: string, time: string) {
  const created = await createReservation(
    db,
    venueId,
    {
      date: "2026-11-12",
      time,
      durationMinutes: 60,
      partySize: 2,
      tableIds: [tableId],
      guestName: name,
      guestContact: contact,
    },
    `${venueId}-${contact}-${tableId}-${time}`,
  );
  if (!created.ok) throw new Error(`create failed: ${created.code}`);
  return created.id;
}

async function settled<T>(...calls: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(calls);
  const failed = results.filter((r) => r.status === "rejected");
  expect(failed.map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
  return results.map((r) => (r as PromiseFulfilledResult<T>).value);
}

async function dangling(venueId: string) {
  const rows = await db
    .select({ id: reservations.id, guestId: reservations.guestId })
    .from(reservations)
    .where(and(eq(reservations.venueId, venueId), isNotNull(reservations.guestId)));
  const known = new Set((await db.select({ id: guests.id }).from(guests).where(eq(guests.venueId, venueId))).map((g) => g.id));
  return rows.filter((r) => !known.has(r.guestId as string));
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe("erasure racing a booking for the same guest", () => {
  it("leaves no reservation that points at an erased guest and never deadlocks", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const venueId = `race-create-${round}`;
      await seedVenue(venueId);
      await book(venueId, EVA, "Eva", "1", "20:00");
      const [created] = await settled(
        createReservation(
          db,
          venueId,
          { date: "2026-11-12", time: "22:00", durationMinutes: 60, partySize: 2, tableIds: ["2"], guestName: "Eva", guestContact: EVA },
          `${venueId}-second`,
        ),
        erase(db, venueId, EVA),
      );
      expect(created.ok).toBe(true);
      expect(await dangling(venueId)).toEqual([]);
      // The second booking is either erased, or it came after the erasure and has its own guest row.
      const live = await db
        .select({ id: reservations.id, guestId: reservations.guestId, contact: reservations.guestContact })
        .from(reservations)
        .where(and(eq(reservations.venueId, venueId), eq(reservations.erased, false)));
      for (const r of live) expect(r.guestId).not.toBeNull();
    }
  });
});


async function waiting(): Promise<number> {
  const r = await db.execute(
    sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
  );
  return Number((r.rows[0] as { n: number }).n);
}

async function until(done: () => Promise<boolean>) {
  for (let i = 0; i < 200; i++) {
    if (await done()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out waiting for the interleaving");
}

/** Holds `guestId`'s row lock from a transaction of its own until `release` runs. */
async function holdGuest(venueId: string, guestId: string) {
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  let held!: () => void;
  const locked = new Promise<void>((r) => (held = r));
  const tx = db.transaction(async (t) => {
    await t.select().from(guests).where(and(eq(guests.venueId, venueId), eq(guests.id, guestId))).for("update");
    held();
    await hold;
  });
  await locked;
  return { release, done: tx };
}

async function twoGuests(venueId: string) {
  await seedVenue(venueId);
  await book(venueId, EVA, "Eva", "1", "20:00");
  await book(venueId, ANA, "Ana", "2", "20:00");
  const rows = await db.select().from(guests).where(eq(guests.venueId, venueId)).orderBy(guests.id);
  return { first: rows[0], second: rows[1] };
}

describe("erasure racing a merge or an unmerge", () => {
  it("settles a merge of a guest and an erasure of the same guest without a deadlock", async () => {
    const venueId = "race-merge";
    // The merge locks the lower id first, then waits for the higher one. Erasure holds the lower guest's
    // reservation and waits for the lower guest. When the higher lock frees, the merge wants that reservation.
    const { first, second } = await twoGuests(venueId);
    const contact = first.email as string;
    const hold = await holdGuest(venueId, second.id);
    const before = await waiting();
    const merge = mergeGuest(db, venueId, first.id, second.id, `${venueId}-merge`, "test");
    await until(async () => (await waiting()) > before);
    const erasing = erase(db, venueId, contact);
    await until(async () => (await waiting()) > before + 1);
    hold.release();
    await hold.done;
    await settled(merge, erasing);
    expect(await dangling(venueId)).toEqual([]);
    const left = await db
      .select()
      .from(reservations)
      .where(and(eq(reservations.venueId, venueId), eq(reservations.erased, false), eq(reservations.guestContact, contact)));
    expect(left).toEqual([]);
  });

  it("settles an unmerge of a guest and an erasure of the same guest without a deadlock", async () => {
    const venueId = "race-unmerge";
    const { first, second } = await twoGuests(venueId);
    const contact = first.email as string;
    const merged = await mergeGuest(db, venueId, first.id, second.id, `${venueId}-merge`, "test");
    expect(merged.ok).toBe(true);
    // The unmerge locks the absorbed guest, then waits for the target. Erasure holds the moved reservation
    // and waits for the absorbed guest. When the target frees, the unmerge wants that reservation.
    const hold = await holdGuest(venueId, second.id);
    const before = await waiting();
    const unmerge = unmergeGuest(db, venueId, first.id, "test");
    await until(async () => (await waiting()) > before);
    const erasing = erase(db, venueId, contact);
    await until(async () => (await waiting()) > before + 1);
    hold.release();
    await hold.done;
    await settled(unmerge, erasing);
    expect(await dangling(venueId)).toEqual([]);
    const left = await db
      .select()
      .from(reservations)
      .where(and(eq(reservations.venueId, venueId), eq(reservations.erased, false), eq(reservations.guestContact, contact)));
    expect(left).toEqual([]);
  });
});
