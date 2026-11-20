import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { events, guests, reservations, selfServiceLinks, services, tables, venues, waitlist } from "../src/db/schema";
import { cancelReservation, createReservation, modifyReservation } from "../src/lib/reservations";
import { runRetention } from "../src/lib/retention";
import { mintLink, reissueLink } from "../src/lib/self-service";
import { erase } from "../src/lib/venue";
import { addWaitlist, seatWaitlist } from "../src/lib/waitlist";

// Erasure takes its locks in the order every other writer does: the reservation row, then its links, the
// waitlist entry before the guest. Each test races erasure against one of those writers for ROUNDS rounds
// and fails on a deadlock (Postgres aborts one side with 40P01 after `deadlock_timeout`, 1 s by default,
// and the call rejects), on any rejected call, or on a state erasure should have cleaned.

const ROUNDS = 20;
const CONTACT = "eva@example.com";

async function seedVenue(venueId: string) {
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid" });
  await db.insert(services).values([{ venueId, name: "dinner", openStart: "00:00", openEnd: "23:59" }]);
  await db.insert(tables).values([{ id: "1", venueId, name: "T1", seats: 2 }]);
}

async function seedBooking(venueId: string) {
  await seedVenue(venueId);
  const created = await createReservation(
    db,
    venueId,
    {
      date: "2026-11-12",
      time: "21:00",
      durationMinutes: 120,
      partySize: 2,
      tableIds: ["1"],
      guestName: "Eva",
      guestContact: CONTACT,
    },
    `${venueId}-create`,
  );
  if (!created.ok) throw new Error(`create failed: ${created.code}`);
  return created.id;
}

async function link(venueId: string, reservationId: string): Promise<string> {
  const issued = await db.transaction((tx) =>
    mintLink(tx, venueId, reservationId, new Date(Date.now() + 86_400_000)),
  );
  return issued.token.split(".")[0];
}

async function settled<T>(...calls: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(calls);
  const failed = results.filter((r) => r.status === "rejected");
  expect(failed.map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
  return results.map((r) => (r as PromiseFulfilledResult<T>).value);
}

async function leftovers(venueId: string, reservationId?: string) {
  return {
    guests: await db.select().from(guests).where(eq(guests.venueId, venueId)),
    waiting: await db.select().from(waitlist).where(eq(waitlist.venueId, venueId)),
    links: await db.select().from(selfServiceLinks).where(eq(selfServiceLinks.venueId, venueId)),
    live: await db
      .select()
      .from(reservations)
      .where(and(eq(reservations.venueId, venueId), eq(reservations.erased, false), sql`${reservations.guestContact} <> ''`)),
    row: reservationId
      ? (await db.select().from(reservations).where(eq(reservations.id, reservationId)))[0]
      : undefined,
  };
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

/** Holds the waitlist entry's row lock from a transaction of its own until `release` runs. */
async function holdEntry(venueId: string, entryId: string) {
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  let held!: () => void;
  const locked = new Promise<void>((r) => (held = r));
  const tx = db.transaction(async (t) => {
    await t.select().from(waitlist).where(and(eq(waitlist.venueId, venueId), eq(waitlist.id, entryId))).for("update");
    held();
    await hold;
  });
  await locked;
  return { release, done: tx };
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe("erasure racing the writers that lock a reservation first", () => {
  it("settles a guest cancel and an erasure without a deadlock", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const venueId = `lock-cancel-${round}`;
      const id = await seedBooking(venueId);
      const linkId = await link(venueId, id);
      const [cancel, erased] = await settled(
        cancelReservation(db, venueId, id, `${venueId}-cancel`, null, { linkId, cutoffMinutes: -100_000_000 }),
        erase(db, venueId, CONTACT),
      );
      if (!cancel.ok) {
        expect(["self_service_link_invalid", "reservation_not_found"]).toContain(cancel.code);
      }
      expect(erased.erasedReservations).toBe(1);
      const left = await leftovers(venueId, id);
      expect(left.row?.erased).toBe(true);
      expect(left.links).toEqual([]);
      expect(left.guests).toEqual([]);
    }
  });

  it("settles a link reissue and an erasure without a deadlock", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const venueId = `lock-reissue-${round}`;
      const id = await seedBooking(venueId);
      await link(venueId, id);
      const [reissue, erased] = await settled(
        reissueLink(db, venueId, id, `${venueId}-reissue`),
        erase(db, venueId, CONTACT),
      );
      if (!reissue.ok) {
        expect(["reservation_not_found", "invalid_transition"]).toContain(reissue.code);
      }
      expect(erased.erasedReservations).toBe(1);
      const left = await leftovers(venueId, id);
      expect(left.row?.erased).toBe(true);
      expect(left.links).toEqual([]);
      expect(left.guests).toEqual([]);
    }
  });

  it("settles a waitlist seat and an erasure of the same guest without a deadlock", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const venueId = `lock-seat-${round}`;
      await seedVenue(venueId);
      const added = await addWaitlist(db, venueId, { partySize: 2, guestName: "Eva", guestContact: CONTACT });
      if (!added.ok) throw new Error("waitlist add failed");
      const [seat] = await settled(
        seatWaitlist(db, venueId, added.id, `${venueId}-seat`, null),
        erase(db, venueId, CONTACT),
      );
      if (!seat.ok) expect(seat.code).toBe("waitlist_entry_not_found");
      const left = await leftovers(venueId);
      expect(left.waiting).toEqual([]);
      expect(left.live).toEqual([]);
      expect(left.guests).toEqual([]);
    }
  });
});

describe("erasure racing a modify", () => {
  it("never writes an erased event with a version below the reservation's last", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const venueId = `lock-modify-${round}`;
      const id = await seedBooking(venueId);
      await settled(
        modifyReservation(db, venueId, id, { partySize: 1 }, `${venueId}-modify`),
        erase(db, venueId, CONTACT),
      );
      const feed = await db.select().from(events).where(eq(events.reservationId, id)).orderBy(events.id);
      const versions = feed.map((e) => e.version);
      expect(versions, feed.map((e) => `${e.type}:${e.version}`).join(" ")).toEqual([...versions].sort((a, b) => a - b));
      expect(feed.filter((e) => e.type === "erased")).toHaveLength(1);
    }
  });
});

describe("erasure racing guest retention", () => {
  it("settles a retention run and an erasure of the same guest without a deadlock", async () => {
    // Erasure locks the reservation, then waits on the waitlist entry held here. Retention then takes the guest
    // and wants the same reservation. When the entry frees, erasure wants the guest that retention holds.
    const venueId = "lock-retention";
    const id = await seedBooking(venueId);
    const added = await addWaitlist(db, venueId, { partySize: 2, guestName: "Eva", guestContact: CONTACT });
    if (!added.ok) throw new Error("waitlist add failed");
    const hold = await holdEntry(venueId, added.id);
    const before = await waiting();
    const erasing = erase(db, venueId, CONTACT);
    await until(async () => (await waiting()) > before);
    let retentionDone = false;
    const retention = runRetention(db, new Date(Date.now() + 10 * 365 * 86_400_000)).finally(() => (retentionDone = true));
    // Before the fix retention blocked on the reservation here, holding the guest.
    await until(async () => retentionDone || (await waiting()) > before + 1);
    hold.release();
    await settled(erasing, retention, hold.done);
    const left = await leftovers(venueId, id);
    expect(left.row?.erased).toBe(true);
    expect(left.waiting).toEqual([]);
    expect(left.live).toEqual([]);
    expect(left.guests).toEqual([]);
  });
});
