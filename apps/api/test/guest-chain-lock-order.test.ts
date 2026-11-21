import { and, eq, isNotNull, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { guests, reservations, services, tables, venues } from "../src/db/schema";
import { mergeGuest } from "../src/lib/guests";
import { createReservation } from "../src/lib/reservations";
import { runRetention } from "../src/lib/retention";
import { erase } from "../src/lib/venue";

// A booking for a merged guest locks that guest, then its chain root (linkGuest). The writers that walk a chain
// from its root (retention, erasure by guest id or by principal) must not hold the root while they wait on a
// merged guest, or the two close a cycle (Postgres aborts one side with 40P01 after `deadlock_timeout`).
// Each case pins that interleaving: a key-share lock held from outside on the merged guest stops the chain
// walker after it locked the root, and lets the booking lock the merged guest (key share does not block it)
// and queue on the root. Then the outside lock frees.

const EVA = "eva@example.com";
const ANA = "ana@example.com";
const OWNER = "staff:owner";

async function seedVenue(venueId: string) {
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid" });
  await db.insert(services).values([{ venueId, name: "dinner", openStart: "00:00", openEnd: "23:59" }]);
  await db.insert(tables).values([
    { id: "1", venueId, name: "T1", seats: 2 },
    { id: "2", venueId, name: "T2", seats: 2 },
    { id: "3", venueId, name: "T3", seats: 2 },
  ]);
}

function book(venueId: string, contact: string, name: string, tableId: string) {
  return createReservation(
    db,
    venueId,
    {
      date: "2026-11-12",
      time: "20:00",
      durationMinutes: 60,
      partySize: 2,
      tableIds: [tableId],
      guestName: name,
      guestContact: contact,
      ownerPrincipal: OWNER,
    },
    `${venueId}-${contact}-${tableId}`,
  );
}

/** Eva's guest merged into Ana's: `merged` points at `root`. */
async function mergedChain(venueId: string) {
  await seedVenue(venueId);
  for (const [contact, name, tableId] of [
    [EVA, "Eva", "1"],
    [ANA, "Ana", "2"],
  ]) {
    const created = await book(venueId, contact, name, tableId);
    if (!created.ok) throw new Error(`create failed: ${created.code}`);
  }
  const rows = await db.select().from(guests).where(eq(guests.venueId, venueId));
  const merged = rows.find((g) => g.email === EVA) as typeof guests.$inferSelect;
  const root = rows.find((g) => g.email === ANA) as typeof guests.$inferSelect;
  const result = await mergeGuest(db, venueId, merged.id, root.id, `${venueId}-merge`, "test");
  if (!result.ok) throw new Error(`merge failed: ${result.code}`);
  return { merged, root };
}

async function settled<T>(...calls: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(calls);
  const failed = results.flatMap((r) => {
    if (r.status === "fulfilled") return [];
    const reason = r.reason as { cause?: { code?: string } };
    return [`${reason.cause?.code ?? "no sqlstate"}: ${String(reason)}`];
  });
  expect(failed).toEqual([]);
  return results.map((r) => (r as PromiseFulfilledResult<T>).value);
}

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

/** Holds a key-share lock on `guestId` from a transaction of its own until `release` runs. */
async function holdKeyShare(venueId: string, guestId: string) {
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  let held!: () => void;
  const locked = new Promise<void>((r) => (held = r));
  const tx = db.transaction(async (t) => {
    await t.select().from(guests).where(and(eq(guests.venueId, venueId), eq(guests.id, guestId))).for("key share");
    held();
    await hold;
  });
  await locked;
  return { release, done: tx };
}

/** Starts `walker`, lets it lock the root and stop on the merged guest, then books for the merged guest. */
async function race<T>(venueId: string, merged: string, walker: () => Promise<T>) {
  const hold = await holdKeyShare(venueId, merged);
  const before = await waiting();
  let walkerDone = false;
  const walking = walker().finally(() => (walkerDone = true));
  await until(async () => walkerDone || (await waiting()) > before);
  let bookingDone = false;
  const booking = book(venueId, EVA, "Eva", "3").finally(() => (bookingDone = true));
  // Before the fix the booking queued here on the root the walker holds.
  await until(async () => walkerDone || bookingDone || (await waiting()) > before + 1);
  hold.release();
  await hold.done;
  const [created] = await settled(booking as Promise<unknown>, walking as Promise<unknown>);
  return created as Awaited<ReturnType<typeof book>>;
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

describe("a booking for a merged guest racing a writer that walks the chain from its root", () => {
  it("settles guest retention and the booking without a deadlock", async () => {
    const venueId = "chain-retention";
    const { merged } = await mergedChain(venueId);
    const created = await race(venueId, merged.id, () =>
      runRetention(db, new Date(Date.now() + 10 * 365 * 86_400_000)),
    );
    expect(created.ok).toBe(true);
    expect(await dangling(venueId)).toEqual([]);
  });

  it("settles an erasure of the chain root and the booking without a deadlock", async () => {
    const venueId = "chain-erase-root";
    const { merged, root } = await mergedChain(venueId);
    const created = await race(venueId, merged.id, () => erase(db, venueId, root.id));
    expect(created.ok).toBe(true);
    expect(await dangling(venueId)).toEqual([]);
  });

  it("settles an erasure by principal and the booking without a deadlock", async () => {
    const venueId = "chain-erase-principal";
    const { merged } = await mergedChain(venueId);
    const created = await race(venueId, merged.id, () => erase(db, venueId, undefined, OWNER));
    expect(created.ok).toBe(true);
    expect(await dangling(venueId)).toEqual([]);
  });
});
