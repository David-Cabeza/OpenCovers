import { eq, sql, type SQL } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { events, reservations, services, tableAllocations, tables, venues } from "../src/db/schema";
import { cancelReservation, createReservation, modifyReservation } from "../src/lib/reservations";
import { setConfig } from "../src/lib/venue";

// Races between the writers that use or free the overbooking ceiling (C24). The covers counted are the party sizes of
// the booked or seated bookings without a table, all at one time slot. Allowed: every write answers ok or
// no_suitable_table, none rejects (a deadlock would reject with 40P01), and no write takes the covers above the
// ceiling in force when it commits. A lowered ceiling evicts nothing: bookings committed before it stay.
//
// Commit order comes from the database, never from the order promises resolve. A venue's events commit in id order
// (ADR-0026), so replaying them gives every committed state. A config change writes no event, so the tests that need
// its place in that order hold a lock from outside to force it.

const ROUNDS = 20;
const RACE_TIMEOUT = 30_000;
const DATE = "2026-11-12";
const TIME = "21:00";

let keys = 0;
const key = () => `or-${++keys}`;

const create = (venueId: string, partySize: number, extra: { zone?: string; tableIds?: string[] } = {}) =>
  createReservation(db, venueId, { date: DATE, time: TIME, partySize, ...extra }, key());
const release = (venueId: string, id: string) => modifyReservation(db, venueId, id, { tableIds: [] }, key());
const resize = (venueId: string, id: string, partySize: number) =>
  modifyReservation(db, venueId, id, { partySize }, key());
const cancel = (venueId: string, id: string) => cancelReservation(db, venueId, id, key(), null);
const setCeiling = (venueId: string, overbookingCeiling: number) => setConfig(db, venueId, { overbookingCeiling });

const answer = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code);

/** Each table is in the zone named like it, so a create that asks for a taken zone can only use the ceiling. */
async function seedVenue(venueId: string, overbookingCeiling: number, seats: Record<string, number>) {
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid", overbookingCeiling });
  await db.insert(services).values([{ venueId, name: "dinner", openStart: "19:00", openEnd: "23:00" }]);
  await db.insert(tables).values(Object.entries(seats).map(([id, n]) => ({ id, venueId, name: id, seats: n, zone: id })));
}

async function booked(venueId: string, partySize: number, tableIds?: string[]) {
  const result = await create(venueId, partySize, { tableIds });
  if (!result.ok) throw new Error(`seed booking failed: ${result.code}`);
  return result.id;
}

async function bookings(venueId: string) {
  const rows = await db.select().from(reservations).where(eq(reservations.venueId, venueId));
  const allocations = await db.select().from(tableAllocations).where(eq(tableAllocations.venueId, venueId));
  const seated = new Set(allocations.map((a) => a.reservationId));
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    partySize: r.partySize,
    covers: (r.status === "booked" || r.status === "seated") && !seated.has(r.id) ? r.partySize : 0,
  }));
}

const total = (values: Iterable<number>) => [...values].reduce((sum, n) => sum + n, 0);
const coversOf = async (venueId: string) => total((await bookings(venueId)).map((b) => b.covers));
const ceilingOf = async (venueId: string) =>
  (await db.select().from(venues).where(eq(venues.id, venueId)))[0].overbookingCeiling;

/** The covers each version of a booking holds, keyed `id:version`. */
type Ledger = Map<string, number>;

async function note(venueId: string, ledger: Ledger = new Map()): Promise<Ledger> {
  for (const b of await bookings(venueId)) ledger.set(`${b.id}:${b.version}`, b.covers);
  return ledger;
}

/** The highest covers any committed state of the venue held, from its events in commit order. */
async function peakCovers(venueId: string, ledger: Ledger): Promise<number> {
  await note(venueId, ledger);
  const feed = await db.select().from(events).where(eq(events.venueId, venueId)).orderBy(events.id);
  const current = new Map<string, number>();
  const states = feed.map((e) => {
    const covers = ledger.get(`${e.reservationId}:${e.version}`);
    expect(covers, `no state noted for ${e.type} v${e.version}`).toBeDefined();
    current.set(e.reservationId, covers!);
    return total(current.values());
  });
  expect(states.at(-1)).toBe(await coversOf(venueId));
  return Math.max(...states);
}

async function settled<T>(calls: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(calls);
  const failed = results.flatMap((r) =>
    r.status === "rejected" ? [`SQLSTATE ${r.reason?.cause?.code}: ${r.reason}`] : [],
  );
  expect(failed).toEqual([]);
  return results.map((r) => (r as PromiseFulfilledResult<T>).value);
}

/** Starts the calls with the one at `first` leading, so each round launches them in another order. */
function startFrom<T>(first: number, calls: (() => Promise<T>)[]): Promise<T>[] {
  const started: Promise<T>[] = [];
  for (let i = 0; i < calls.length; i++) {
    const at = (first + i) % calls.length;
    started[at] = calls[at]();
  }
  return started;
}

/** Takes a lock in a transaction of its own and returns the function that releases it. */
async function hold(statement: SQL) {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  let locked!: () => void;
  const held = new Promise<void>((r) => (locked = r));
  const done = db.transaction(async (tx) => {
    await tx.execute(statement);
    locked();
    await gate;
  });
  await Promise.race([held, done]);
  return async () => {
    open();
    await done;
  };
}

const holdAdvisory = (name: string) => hold(sql`select pg_advisory_xact_lock(hashtextextended(${name}, 0))`);

async function waiting(): Promise<number> {
  const r = await db.execute(
    sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
  );
  return Number((r.rows[0] as { n: number }).n);
}

async function until(done: () => Promise<boolean>) {
  for (let i = 0; i < 400; i++) {
    if (await done()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timed out waiting for the interleaving");
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, guest_audit, guests, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe("writers racing for the ceiling", () => {
  it("holds the ceiling when creates race modifies that give up their tables", { timeout: RACE_TIMEOUT }, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const venueId = `or-release-${round}`;
      const sala = ["s1", "s2", "s3", "s4"];
      await seedVenue(venueId, 6, { s1: 2, s2: 2, s3: 2, s4: 2, terrace: 2 });
      const holders: string[] = [];
      for (const table of sala) holders.push(await booked(venueId, 2, [table]));
      await booked(venueId, 2, ["terrace"]);
      const ledger = await note(venueId);

      // 8 writers of 2 covers each against room for 6: exactly 3 win, whatever the order.
      const results = await settled(
        startFrom(
          round % 2,
          holders.flatMap((id) => [() => release(venueId, id), () => create(venueId, 2, { zone: "terrace" })]),
        ),
      );

      expect(results.map(answer).sort(), `round ${round}`).toEqual(
        [...Array(5).fill("no_suitable_table"), ...Array(3).fill("ok")],
      );
      expect(await peakCovers(venueId, ledger), `round ${round}`).toBe(6);
    }
  });

  it("holds the ceiling when bookings without tables grow at the same time", { timeout: RACE_TIMEOUT }, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const venueId = `or-grow-${round}`;
      await seedVenue(venueId, 10, { big: 8 });
      await booked(venueId, 8, ["big"]);
      const overbooked: string[] = [];
      for (let i = 0; i < 4; i++) overbooked.push(await booked(venueId, 1));
      const ledger = await note(venueId);

      // 4 covers held, 4 increases of 2 against room for 6: exactly 3 win.
      const results = await settled(
        startFrom(round % 4, overbooked.map((id) => () => resize(venueId, id, 3))),
      );

      expect(results.map(answer).sort(), `round ${round}`).toEqual(["no_suitable_table", "ok", "ok", "ok"]);
      expect(await peakCovers(venueId, ledger), `round ${round}`).toBe(10);
      const after = (await bookings(venueId)).filter((b) => overbooked.includes(b.id));
      expect(after.map((b) => `${b.partySize}:v${b.version}`).sort()).toEqual(["1:v1", "3:v2", "3:v2", "3:v2"]);
    }
  });
});

describe("a cancel of an overbooked booking racing creates", () => {
  async function seedFull(venueId: string) {
    await seedVenue(venueId, 2, { t1: 4 });
    await booked(venueId, 4, ["t1"]);
    return booked(venueId, 2);
  }

  it("gives the freed room to one create at most", { timeout: RACE_TIMEOUT }, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const venueId = `or-cancel-${round}`;
      const over = await seedFull(venueId);
      const ledger = await note(venueId);

      // The creates start 0 to 19 ms after the cancel, so the rounds put their counts on both sides of its commit.
      const cancelling = cancel(venueId, over);
      await new Promise((r) => setTimeout(r, round));
      const [cancelled, ...creates] = await settled<{ ok: boolean; code?: string }>([
        cancelling,
        ...Array.from({ length: 5 }, () => create(venueId, 2)),
      ]);

      expect(cancelled.ok, `round ${round}`).toBe(true);
      const winners = creates.filter((r) => r.ok).length;
      expect(winners, `round ${round}`).toBeLessThanOrEqual(1);
      expect(creates.filter((r) => !r.ok).map(answer)).toEqual(Array(5 - winners).fill("no_suitable_table"));
      // Creates that all counted before the cancel committed leave the room free, and it still serves one booking.
      if (winners === 0) expect(answer(await create(venueId, 2))).toBe("ok");
      expect(answer(await create(venueId, 2))).toBe("no_suitable_table");
      expect(await peakCovers(venueId, ledger), `round ${round}`).toBe(2);
    }
  });

  it("gives the freed room to exactly one create when all count after the cancel", { timeout: RACE_TIMEOUT }, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const venueId = `or-cancel-first-${round}`;
      const over = await seedFull(venueId);
      const ledger = await note(venueId);
      const open = await holdAdvisory(`overbooking:${venueId}`);
      let creates: ReturnType<typeof create>[] = [];
      try {
        creates = Array.from({ length: 5 }, () => create(venueId, 2));
        await until(async () => (await waiting()) === 5);
        expect((await cancel(venueId, over)).ok).toBe(true);
        expect(await waiting()).toBe(5);
      } finally {
        await open();
      }

      expect((await settled(creates)).map(answer).sort(), `round ${round}`).toEqual(
        [...Array(4).fill("no_suitable_table"), "ok"],
      );
      expect(await peakCovers(venueId, ledger), `round ${round}`).toBe(2);
    }
  });
});

describe("an admin lowering the ceiling while bookings are written", () => {
  /** One cover is held without a table, and tables `a` and `b` are taken. */
  async function seedTaken(venueId: string, ceiling: number) {
    await seedVenue(venueId, ceiling, { a: 2, b: 2 });
    const holder = await booked(venueId, 2, ["a"]);
    await booked(venueId, 2, ["b"]);
    const over = await booked(venueId, 1);
    return { holder, over };
  }

  // Each writer takes the covers held from 1 to 3.
  const writers = (venueId: string, { holder, over }: { holder: string; over: string }) => ({
    create: () => create(venueId, 2, { zone: "b" }),
    release: () => release(venueId, holder),
    resize: () => resize(venueId, over, 3),
  });

  it("keeps every committed state within the ceiling in force before the change", { timeout: RACE_TIMEOUT }, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const venueId = `or-mixed-${round}`;
      await seedVenue(venueId, 8, { s1: 2, s2: 2, s3: 2, terrace: 2 });
      const holders: string[] = [];
      for (const table of ["s1", "s2", "s3"]) holders.push(await booked(venueId, 2, [table]));
      await booked(venueId, 2, ["terrace"]);
      const grows = await booked(venueId, 1);
      const leaves = await booked(venueId, 1);
      const ledger = await note(venueId);

      const [config, cancelled, ...writes] = await settled(
        startFrom<{ ok: boolean; code?: string }>(round % 8, [
          () => setCeiling(venueId, 3),
          () => cancel(venueId, leaves),
          () => create(venueId, 2, { zone: "terrace" }),
          () => release(venueId, holders[0]),
          () => create(venueId, 2, { zone: "terrace" }),
          () => resize(venueId, grows, 3),
          () => create(venueId, 2, { zone: "terrace" }),
          () => release(venueId, holders[1]),
        ]),
      );

      expect([config.ok, cancelled.ok], `round ${round}`).toEqual([true, true]);
      for (const w of writes) expect(["ok", "no_suitable_table"]).toContain(answer(w));
      expect(await peakCovers(venueId, ledger), `round ${round}`).toBeLessThanOrEqual(8);
      expect(await ceilingOf(venueId)).toBe(3);
      // A write that starts after the change is held by it.
      const fits = (await coversOf(venueId)) + 2 <= 3;
      expect(answer(await create(venueId, 2, { zone: "terrace" })), `round ${round}`).toBe(
        fits ? "ok" : "no_suitable_table",
      );
    }
  });

  it("holds writes that commit before the change to the old ceiling and evicts none", { timeout: RACE_TIMEOUT }, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const venueId = `or-before-${round}`;
      const seeded = await seedTaken(venueId, 7);
      const ledger = await note(venueId);
      // The lock setConfig takes: the change waits here while the writes commit.
      const open = await hold(sql`select 1 from venues where id = ${venueId} for no key update`);
      let lowering: ReturnType<typeof setCeiling> | undefined;
      try {
        lowering = setCeiling(venueId, 1);
        await until(async () => (await waiting()) === 1);
        const writes = await settled(Object.values(writers(venueId, seeded)).map((write) => write()));
        expect(writes.map(answer), `round ${round}`).toEqual(["ok", "ok", "ok"]);
        expect(answer(await create(venueId, 1, { zone: "b" }))).toBe("no_suitable_table");
        expect(await ceilingOf(venueId)).toBe(7);
        expect(await waiting()).toBe(1);
      } finally {
        await open();
      }

      expect((await lowering!).ok).toBe(true);
      expect(await coversOf(venueId)).toBe(7);
      expect(answer(await create(venueId, 1, { zone: "b" }))).toBe("no_suitable_table");
      expect(await peakCovers(venueId, ledger), `round ${round}`).toBe(7);
    }
  });

  interface Interleaving {
    writer: string;
    answer: string | undefined;
    loweredFirst: boolean;
    covers: number;
  }

  /**
   * Stops one write on the advisory lock `point:venue`, lowers the ceiling from 4 to 1 while it waits, then lets it go.
   * `overbooking` stops it before it counts the covers, `events` after it counted and before it commits.
   */
  async function lowerUnderAWrite(point: "overbooking" | "events", round: number): Promise<Interleaving> {
    const venueId = `or-${point}-${round}`;
    const seeded = await seedTaken(venueId, 4);
    const writer = (["create", "release", "resize"] as const)[round % 3];
    const open = await holdAdvisory(`${point}:${venueId}`);
    let writing: ReturnType<typeof create> | undefined;
    let lowering: ReturnType<typeof setCeiling> | undefined;
    let loweredFirst = false;
    try {
      let wrote = false;
      writing = writers(venueId, seeded)[writer]().finally(() => (wrote = true));
      await until(async () => wrote || (await waiting()) === 1);
      expect(wrote, `${writer} did not stop on the ${point} lock`).toBe(false);
      let lowered = false;
      lowering = setCeiling(venueId, 1).finally(() => (lowered = true));
      await until(async () => lowered || (await waiting()) === 2);
      // The new value is readable while the write is still uncommitted, so the change committed first.
      loweredFirst = lowered && (await ceilingOf(venueId)) === 1;
    } finally {
      await open();
    }
    const [result] = await settled([writing!]);
    expect((await lowering!).ok).toBe(true);
    return { writer, answer: answer(result), loweredFirst, covers: await coversOf(venueId) };
  }

  describe.each(["overbooking", "events"] as const)("a write stopped on the %s lock", (point) => {
    const observed: Interleaving[] = [];

    it("lets the change commit first", { timeout: RACE_TIMEOUT }, async () => {
      for (let round = 0; round < ROUNDS; round++) observed.push(await lowerUnderAWrite(point, round));
      expect(observed.map((o) => o.loweredFirst)).toEqual(Array(ROUNDS).fill(true));
      for (const o of observed) expect(["ok", "no_suitable_table"]).toContain(o.answer);
    });

    // Known bug: https://github.com/David-Cabeza/OpenCovers/issues/446. The writer keeps the ceiling it read before the change. Remove `.fails` with the fix.
    it.fails("does not land the write above the new ceiling (https://github.com/David-Cabeza/OpenCovers/issues/446)", () => {
      expect(observed).toHaveLength(ROUNDS);
      expect(observed.filter((o) => o.loweredFirst && o.covers > 1)).toEqual([]);
    });
  });
});
