import { readdirSync, readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { events, reservations, services, tables, venues } from "../src/db/schema";
import {
  cancelReservation,
  createReservation,
  getEvents,
  modifyReservation,
  setStatus,
} from "../src/lib/reservations";
import { runRetention } from "../src/lib/retention";
import { mintLink, reissueLink } from "../src/lib/self-service";
import { erase } from "../src/lib/venue";
import { addWaitlist, seatWaitlist } from "../src/lib/waitlist";
import {
  JITTER,
  PARK,
  dropParkTrigger,
  holdPark,
  installParkTrigger,
  parked,
  settlesOrBlocks,
  waitUntil,
} from "./event-park";

// C11: a cursor reader never skips an event. Event ids come from one sequence and a row is visible only at commit,
// so these tests hold a writer between its event insert and its commit and check that no later event of the same
// venue becomes visible first.

const YEAR_MS = 365 * 86_400_000;
const park = { channel: "api" as const, actor: PARK };
const jitter = { channel: "api" as const, actor: JITTER };

async function seedVenue(venueId: string, tableCount = 12, extra: Partial<typeof venues.$inferInsert> = {}) {
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid", ...extra });
  await db.insert(services).values([{ venueId, name: "all", openStart: "00:00", openEnd: "24:00" }]);
  await db
    .insert(tables)
    .values(Array.from({ length: tableCount }, (_, i) => ({ id: String(i + 1), venueId, name: `T${i + 1}`, seats: 4 })));
}

function day(n: number) {
  return new Date(Date.UTC(2027, 0, 1 + n)).toISOString().slice(0, 10);
}

async function book(venueId: string, table: number, n: number, key: string, origin = jitter) {
  const res = await createReservation(
    db,
    venueId,
    { date: day(n), time: "20:00", durationMinutes: 120, partySize: 2, tableIds: [String(table)], origin },
    key,
  );
  if (!res.ok) throw new Error(`create failed: ${res.code}`);
  return res.id;
}

async function allEventIds(venueId: string) {
  return (await db.select({ id: events.id }).from(events).where(eq(events.venueId, venueId)).orderBy(events.id)).map(
    (e) => e.id,
  );
}

/** A cursor reader of the pull feed: every page after the last id it saw. */
function reader(venueId: string) {
  const seen: number[] = [];
  let cursor = 0;
  return {
    seen,
    async poll() {
      for (;;) {
        const page = await getEvents(db, venueId, cursor, 50);
        for (const e of page) seen.push(e.id);
        if (page.length === 0) return;
        cursor = page[page.length - 1].id;
      }
    },
  };
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, guest_audit, guests, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
  await installParkTrigger();
});

afterAll(async () => {
  await dropParkTrigger();
});

describe("pull feed under concurrent writers of one venue", () => {
  it("does not show a later event while an earlier one is still uncommitted", async () => {
    const venueId = "order-two";
    await seedVenue(venueId);
    const feed = reader(venueId);
    const hold = await holdPark();
    // T1 inserts its event, gets the lower id and waits before commit.
    const first = book(venueId, 1, 0, "two-1", park);
    await waitUntil(async () => (await parked()) === 1, "the first write to park");
    // T2 writes the same venue. Its event would take the next id.
    const second = book(venueId, 2, 0, "two-2", jitter);
    const secondFinished = await settlesOrBlocks(second, 1);
    await feed.poll();
    await hold.release();
    await Promise.all([first, second]);
    await feed.poll();

    expect(feed.seen).toEqual(await allEventIds(venueId));
    expect(feed.seen).toHaveLength(2);
    // The mechanism: the later write waits for the earlier commit instead of committing first.
    expect(secondFinished).toBe(false);
  });

  it("returns every event once, in id order, to a reader polling during the commits", async () => {
    const venueId = "order-many";
    const WRITERS = 8;
    const ROUNDS = 10;
    await seedVenue(venueId, WRITERS);
    const feed = reader(venueId);
    let writing = true;
    const polling = (async () => {
      while (writing) await feed.poll();
    })();
    await Promise.all(
      Array.from({ length: WRITERS }, async (_, w) => {
        for (let i = 0; i < ROUNDS; i++) {
          const id = await book(venueId, w + 1, i, `many-${w}-${i}`);
          const modified = await modifyReservation(db, venueId, id, { commentary: `round ${i}`, origin: jitter }, `many-m-${w}-${i}`);
          expect(modified.ok).toBe(true);
          const cancelled = await cancelReservation(db, venueId, id, `many-c-${w}-${i}`, jitter);
          expect(cancelled.ok).toBe(true);
        }
      }),
    );
    writing = false;
    await polling;
    await feed.poll();

    const written = await allEventIds(venueId);
    expect(written).toHaveLength(WRITERS * ROUNDS * 3);
    expect(feed.seen).toEqual(written);
  });

  it("orders a write nested in a waitlist seat by its outer commit", async () => {
    const venueId = "order-seat";
    await seedVenue(venueId, 2);
    const entry = await addWaitlist(db, venueId, { partySize: 2, guestName: "Ana" });
    if (!entry.ok) throw new Error("waitlist add failed");
    const feed = reader(venueId);
    const hold = await holdPark();
    const seat = seatWaitlist(db, venueId, entry.id, "seat-1", park);
    await waitUntil(async () => (await parked()) === 1, "the seat to park");
    const other = book(venueId, 2, 0, "seat-other", jitter);
    const otherFinished = await settlesOrBlocks(other, 1);
    await feed.poll();
    await hold.release();
    expect((await seat).ok).toBe(true);
    await other;
    await feed.poll();

    expect(feed.seen).toEqual(await allEventIds(venueId));
    expect(feed.seen).toHaveLength(2);
    // The mechanism: the later write waits for the earlier commit instead of committing first.
    expect(otherFinished).toBe(false);
  });
});

describe("the events lock under load", () => {
  it("lets another venue write promptly while one venue erases and twelve of its writers queue", async () => {
    const busy = "pool-busy";
    const quiet = "pool-quiet";
    const ERASED = 1000;
    await seedVenue(busy, 12);
    await seedVenue(quiet, 1);
    const startsAt = new Date("2027-06-01T18:00:00Z");
    const endsAt = new Date("2027-06-01T20:00:00Z");
    for (let i = 0; i < ERASED; i += 500) {
      await db.insert(reservations).values(
        Array.from({ length: Math.min(500, ERASED - i) }, (_, j) => ({
          id: crypto.randomUUID(),
          venueId: busy,
          date: "2027-06-01",
          service: "all",
          startsAt,
          endsAt,
          partySize: 2,
          status: "booked",
          version: 1,
          ownerPrincipal: "bulk",
          guestName: `Guest ${i + j}`,
          guestContact: `guest${i + j}@example.com`,
        })),
      );
    }
    let running = true;
    const erasure = erase(db, busy, undefined, "bulk").finally(() => (running = false));
    const writers = Array.from({ length: 12 }, async (_, w) => {
      for (let i = 0; running; i++) await book(busy, w + 1, 100 + i, `pool-${w}-${i}`, { channel: "api", actor: "x" });
    });
    const quietLatencies: number[] = [];
    const quietWriter = (async () => {
      for (let i = 0; running; i++) {
        const started = Date.now();
        await book(quiet, 1, 200 + i, `quiet-${i}`, { channel: "api", actor: "x" });
        quietLatencies.push(Date.now() - started);
      }
    })();
    const erased = await erasure;
    await Promise.all([...writers, quietWriter]);

    expect(erased.erasedReservations).toBe(ERASED);
    expect(quietLatencies.length).toBeGreaterThan(0);
    // The pool waits up to 10 s for a connection. A same-venue queue that held every connection for the whole
    // erasure would push this toward the erasure's duration; holding the lock only for its last insert keeps it short.
    expect(Math.max(...quietLatencies)).toBeLessThan(1_000);
  });

  it("never deadlocks when every event writer races on one venue", async () => {
    const ROUNDS = 12;
    const failures: string[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      const venueId = `deadlock-${round}`;
      await seedVenue(venueId, 3, { overbookingCeiling: 4, maxActivePerGuestPerDay: 3, retentionDays: 1 });
      const ana = "ana@example.com";
      const bea = "bea@example.com";
      const date = day(round);
      const make = async (key: string, extra: Record<string, unknown>) => {
        const res = await createReservation(
          db,
          venueId,
          { date, time: "20:00", durationMinutes: 120, partySize: 2, ...extra },
          `${venueId}-${key}`,
        );
        if (!res.ok) throw new Error(`seed ${key} failed: ${res.code}`);
        return res.id;
      };
      const linked = await make("linked", { tableIds: ["1"], guestName: "Cara", guestContact: "cara@example.com" });
      const growing = await make("growing", { tableIds: ["2"], guestName: "Ana", guestContact: ana });
      const owned = await make("owned", { guestName: "Bea", guestContact: bea, ownerPrincipal: "p" });
      const seating = await make("seating", { tableIds: ["3"], time: "13:00", guestName: "Bea", guestContact: bea });
      const link = await db.transaction((tx) => mintLink(tx, venueId, linked, new Date(Date.now() + 20 * YEAR_MS)));
      const entry = await addWaitlist(db, venueId, { partySize: 2, guestName: "Ana", guestContact: ana });
      if (!entry.ok) throw new Error("waitlist add failed");

      const k = (name: string) => `${venueId}-${name}`;
      const results = await Promise.allSettled([
        createReservation(db, venueId, { date, time: "20:30", partySize: 2, guestName: "Ana", guestContact: ana }, k("auto-ana")),
        createReservation(db, venueId, { date, time: "20:30", partySize: 3, guestName: "Bea", guestContact: bea }, k("auto-bea")),
        modifyReservation(db, venueId, growing, { partySize: 4, tableIds: [] }, k("grow")),
        cancelReservation(db, venueId, linked, k("guest-cancel"), null, {
          linkId: link.token.split(".")[0],
          cutoffMinutes: -100_000_000,
        }),
        setStatus(db, venueId, seating, "seated", k("seat"), null),
        cancelReservation(db, venueId, seating, k("staff-cancel"), null),
        reissueLink(db, venueId, owned, k("reissue")),
        seatWaitlist(db, venueId, entry.id, k("wl-seat"), null),
        erase(db, venueId, ana),
        erase(db, venueId, undefined, "p"),
        runRetention(db, new Date(Date.now() + 10 * YEAR_MS)),
      ]);
      for (const r of results) if (r.status === "rejected") failures.push(String(r.reason));
    }
    expect(failures).toEqual([]);
  });
});

describe("event writes", () => {
  it("go through the one helper that takes the events lock", () => {
    const dir = new URL("../src/lib/", import.meta.url);
    const writers = readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && /\.insert\(\s*events\b|insert\s+into\s+events\b/i.test(readFileSync(new URL(f, dir), "utf8")),
    );
    expect(writers).toEqual(["events.ts"]);
  });
});
