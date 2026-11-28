// C88: moves race each other, cancels, creates and erasure. A deadlock the database breaks reads as `venue_busy`, so
// every case also asserts that no caller got it.
import pg from "pg";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { reservations, services, tables, venues } from "../src/db/schema";
import type { Origin } from "../src/lib/origin";
import {
  cancelReservation,
  createReservation,
  modifyReservation,
  setStatus,
  type CreateReservationInput,
  type ModifyReservationInput,
} from "../src/lib/reservations";
import { erase } from "../src/lib/venue";
import { PARK, dropParkTrigger, holdPark, installParkTrigger, parked, waitUntil } from "./event-park";

const ROUNDS = 5;
const DAY = "2031-03-14";
const NEXT_DAY = "2031-03-15";
const CONTACT = "eva@example.com";
const PARKED: Origin = { channel: "api", actor: PARK };

let venueCount = 0;

async function seedVenue(set: Partial<typeof venues.$inferInsert> = {}, tableIds = ["1", "2", "3"]) {
  const venueId = `move-race-${++venueCount}`;
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid", ...set });
  await db.insert(services).values({ venueId, name: "dinner", openStart: "18:00", openEnd: "23:30" });
  await db.insert(tables).values(tableIds.map((id) => ({ id, venueId, name: `T${id}`, seats: 2 })));
  return venueId;
}

const key = () => crypto.randomUUID();
const create = (venueId: string, input: Partial<CreateReservationInput> = {}) =>
  createReservation(db, venueId, { date: DAY, time: "20:00", partySize: 2, ...input }, key());

async function book(venueId: string, input: Partial<CreateReservationInput> = {}): Promise<string> {
  const res = await create(venueId, input);
  if (!res.ok) throw new Error(`seed booking failed: ${res.code}`);
  return res.id;
}

const move = (venueId: string, id: string, input: ModifyReservationInput, idempotencyKey = key()) =>
  modifyReservation(db, venueId, id, { version: 1, ...input }, idempotencyKey);

type Call = () => Promise<{ ok: true } | { ok: false; code: string }>;

async function outcome(call: Call): Promise<string> {
  try {
    const res = await call();
    return res.ok ? "ok" : res.code;
  } catch (error) {
    return (error as { cause?: { code?: string } }).cause?.code ?? String(error);
  }
}

async function lockWaiters(): Promise<number> {
  const { rows } = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
  );
  return rows[0].n;
}

/** `first` writes and parks before its commit. `second` arrives then, and runs to its end or to a lock. */
async function whileUncommitted(first: (origin: Origin) => ReturnType<Call>, second: Call) {
  const hold = await holdPark();
  let secondDone = false;
  const calls = [outcome(() => first(PARKED))];
  try {
    await waitUntil(async () => (await parked()) === 1, "the first write to park");
    calls.push(outcome(second).finally(() => (secondDone = true)));
    await waitUntil(async () => secondDone || (await lockWaiters()) >= 2, "the second write to finish or wait");
  } finally {
    await hold.release();
  }
  return Promise.all(calls);
}

const CLAIM_GATE = 88001;

/** Starts every write while table inserts are held, waits until all of them wait on a lock, then lets them go. */
async function releasedTogether(...calls: Call[]): Promise<{ outcomes: string[]; atGate: number }> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let running: Promise<string[]> | undefined;
  let atGate = 0;
  try {
    await client.query("select pg_advisory_lock($1)", [CLAIM_GATE]);
    let done = 0;
    running = Promise.all(calls.map((call) => outcome(call).finally(() => done++)));
    await waitUntil(async () => done + (await lockWaiters()) >= calls.length, "every write to wait or finish");
    const { rows } = await client.query(
      "select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted and classid = 0 and objid = $1",
      [CLAIM_GATE],
    );
    atGate = rows[0].n;
  } finally {
    await client.end();
  }
  return { outcomes: await running, atGate };
}

/** What holds after any race (C88). */
async function expectConsistent(venueId: string) {
  const overlaps = await db.execute(sql`
    select a.table_id, a.reservation_id, b.reservation_id as other
    from table_allocations a join table_allocations b
      on b.venue_id = a.venue_id and b.table_id = a.table_id and b.reservation_id > a.reservation_id
      and a.starts_at < b.ends_at and b.starts_at < a.ends_at
    where a.venue_id = ${venueId} and a.active and b.active`);
  expect(overlaps.rows, "overlapping allocations").toEqual([]);
  const skewed = await db.execute(sql`
    select r.id from reservations r join table_allocations a on a.reservation_id = r.id
    where r.venue_id = ${venueId} and (a.starts_at <> r.starts_at or a.ends_at <> r.ends_at)`);
  expect(skewed.rows, "an allocation off its reservation's window").toEqual([]);
  const versions = await db.execute<{ id: string; version: number; seen: number[] }>(sql`
    select r.id, r.version, array_agg(e.version order by e.version) as seen
    from reservations r join events e on e.reservation_id = r.id and e.venue_id = r.venue_id
    where r.venue_id = ${venueId} and e.type <> 'erased' group by r.id, r.version`);
  for (const row of versions.rows) {
    expect(row.seen, "one event per version").toEqual(Array.from({ length: row.version }, (_, i) => i + 1));
  }
}

/** Each reservation as "date time status tables", sorted. */
async function state(venueId: string): Promise<string[]> {
  const rows = await db.select().from(reservations).where(eq(reservations.venueId, venueId));
  const out = [];
  for (const r of rows) {
    const held = await db.execute<{ table_id: string }>(
      sql`select table_id from table_allocations where reservation_id = ${r.id} and active order by table_id`,
    );
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" }).format(r.startsAt);
    out.push(`${r.date} ${time} ${r.status} [${held.rows.map((h) => h.table_id).join(",")}]`);
  }
  return out.sort();
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, guests, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
  await installParkTrigger();
  await db.execute(sql.raw(`
    create or replace function test_move_gate() returns trigger language plpgsql as $$
    begin perform pg_advisory_xact_lock_shared(${CLAIM_GATE}); return new; end $$;
    drop trigger if exists test_move_gate on table_allocations;
    create trigger test_move_gate before insert on table_allocations for each row execute function test_move_gate();
  `));
});

afterAll(async () => {
  await db.execute(sql.raw(`drop trigger if exists test_move_gate on table_allocations; drop function if exists test_move_gate();`));
  await dropParkTrigger();
});

describe("two moves", () => {
  it("that name one table for overlapping windows: one gets it, the other keeps its slot", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const venueId = await seedVenue();
      const a = await book(venueId, { time: "18:00", tableIds: ["1"] });
      const b = await book(venueId, { time: "18:00", tableIds: ["2"] });
      const { outcomes, atGate } = await releasedTogether(
        () => move(venueId, a, { time: "21:00", tableIds: ["3"] }),
        () => move(venueId, b, { time: "21:30", tableIds: ["3"] }),
      );
      expect(atGate, "table claims in flight at once").toBe(1);
      expect([...outcomes].sort()).toEqual(["ok", "slot_taken"]);
      expect(await state(venueId)).toEqual(
        outcomes[0] === "ok"
          ? [`${DAY} 18:00 booked [2]`, `${DAY} 21:00 booked [3]`]
          : [`${DAY} 18:00 booked [1]`, `${DAY} 21:30 booked [3]`],
      );
      await expectConsistent(venueId);
    }
  });

  it("that leave the engine one free table: the second sees what the first planned", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const venueId = await seedVenue({}, ["1", "2", "3"]);
      await book(venueId, { time: "21:00", tableIds: ["1"] });
      await book(venueId, { time: "21:00", tableIds: ["2"] });
      const a = await book(venueId, { time: "18:00", tableIds: ["1"] });
      const b = await book(venueId, { time: "18:00", tableIds: ["2"] });
      const { outcomes } = await releasedTogether(
        () => move(venueId, a, { time: "21:00" }),
        () => move(venueId, b, { time: "21:00" }),
      );
      expect([...outcomes].sort()).toEqual(["no_suitable_table", "ok"]);
      await expectConsistent(venueId);
    }
  });

  it("that swap two bookings on one table are both refused", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const venueId = await seedVenue();
      const early = await book(venueId, { time: "18:00", tableIds: ["1"] });
      const late = await book(venueId, { time: "21:00", tableIds: ["1"] });
      const before = await state(venueId);
      const { outcomes } = await releasedTogether(
        () => move(venueId, early, { time: "21:00", tableIds: ["1"] }),
        () => move(venueId, late, { time: "18:00", tableIds: ["1"] }),
      );
      expect(outcomes).toEqual(["slot_taken", "slot_taken"]);
      expect(await state(venueId)).toEqual(before);
      await expectConsistent(venueId);
    }
  });

  it("of one booking from one version: one writes, the other reads again", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const venueId = await seedVenue();
      const id = await book(venueId, { tableIds: ["1"] });
      const [first, second] = await whileUncommitted(
        (origin) => move(venueId, id, { time: "21:00", origin }),
        () => move(venueId, id, { time: "22:00" }),
      );
      expect([first, second]).toEqual(["ok", "reservation_changed"]);
      expect(await state(venueId)).toEqual([`${DAY} 21:00 booked [1]`]);
      expect(await move(venueId, id, { time: "22:00", version: 2 })).toMatchObject({ ok: true, version: 3 });
      await expectConsistent(venueId);
    }
  });

  it("sent twice at once with one key write once and answer alike", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const venueId = await seedVenue();
      const id = await book(venueId);
      const shared = key();
      const send = () => move(venueId, id, { time: "21:00" }, shared);
      const results = await Promise.all([send(), send()]);
      expect(results.map((r) => r.ok && r.version)).toEqual([2, 2]);
      const { rows } = await db.execute(sql`select version from events where venue_id = ${venueId} and type = 'modified'`);
      expect(rows).toEqual([{ version: 2 }]);
      await expectConsistent(venueId);
    }
  });
});

describe("a move and a cancel of one booking", () => {
  const cancel = (venueId: string, id: string, origin: Origin | null = null) =>
    cancelReservation(db, venueId, id, key(), origin);

  it("end cancelled with no table when the cancel is first: the move reads the new version", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const venueId = await seedVenue();
      const id = await book(venueId, { tableIds: ["1"] });
      const outcomes = await whileUncommitted(
        (origin) => cancel(venueId, id, origin) as ReturnType<Call>,
        () => move(venueId, id, { time: "21:00" }),
      );
      expect(outcomes).toEqual(["ok", "reservation_changed"]);
      expect(await state(venueId)).toEqual([`${DAY} 20:00 cancelled []`]);
      await expectConsistent(venueId);
    }
  });

  it("end cancelled with no table when the move is first", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const venueId = await seedVenue();
      const id = await book(venueId, { tableIds: ["1"] });
      const outcomes = await whileUncommitted(
        (origin) => move(venueId, id, { time: "21:00", origin }),
        () => cancel(venueId, id) as ReturnType<Call>,
      );
      expect(outcomes).toEqual(["ok", "ok"]);
      expect(await state(venueId)).toEqual([`${DAY} 21:00 cancelled []`]);
      await expectConsistent(venueId);
    }
  });
});

describe("a move and a create that want one table and window", () => {
  async function race() {
    const venueId = await seedVenue();
    const id = await book(venueId, { time: "18:00", tableIds: ["2"] });
    return {
      venueId,
      move: (origin?: Origin) => move(venueId, id, { time: "21:00", tableIds: ["1"], origin }),
      create: (origin?: Origin) => create(venueId, { time: "21:00", tableIds: ["1"], origin }),
    };
  }

  it.each(["move", "create"] as const)("give the loser slot_taken when the %s is first", async (winner) => {
    for (let round = 0; round < ROUNDS; round++) {
      const r = await race();
      const loser = winner === "move" ? r.create : r.move;
      expect(await whileUncommitted(r[winner], loser)).toEqual(["ok", "slot_taken"]);
      await expectConsistent(r.venueId);
    }
  });

  it("claim one at a time when they arrive together", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const r = await race();
      const { outcomes, atGate } = await releasedTogether(r.move, r.create);
      expect(atGate).toBe(1);
      expect([...outcomes].sort()).toEqual(["ok", "slot_taken"]);
      await expectConsistent(r.venueId);
    }
  });
});

describe("a move to a date and a create on it for one contact, with a cap of 1", () => {
  async function race() {
    const venueId = await seedVenue({ maxActivePerGuestPerDay: 1 });
    const id = await book(venueId, { tableIds: ["1"], guestContact: CONTACT });
    return {
      venueId,
      move: (origin?: Origin) => move(venueId, id, { date: NEXT_DAY, origin }),
      create: (origin?: Origin) => create(venueId, { date: NEXT_DAY, tableIds: ["2"], guestContact: CONTACT, origin }),
    };
  }
  const onNextDay = async (venueId: string) => (await state(venueId)).filter((s) => s.startsWith(NEXT_DAY)).length;

  it.each(["move", "create"] as const)("never leaves two when the %s is first", async (winner) => {
    for (let round = 0; round < ROUNDS; round++) {
      const r = await race();
      const loser = winner === "move" ? r.create : r.move;
      expect(await whileUncommitted(r[winner], loser)).toEqual(["ok", "guest_booking_limit"]);
      expect(await onNextDay(r.venueId)).toBe(1);
      await expectConsistent(r.venueId);
    }
  });
});

describe("a move held up by another write", () => {
  it.each(["planner", "guest-day", "row"])("gives up with venue_busy on the %s lock and keeps no key", async (lock) => {
    const venueId = await seedVenue({ maxActivePerGuestPerDay: 1 });
    const id = await book(venueId, { tableIds: ["1"], guestContact: CONTACT });
    const before = await state(venueId);
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const shared = key();
    const send = () => move(venueId, id, { date: NEXT_DAY }, shared);
    try {
      await client.query("begin");
      if (lock === "row") await client.query("select 1 from reservations where id = $1 for update", [id]);
      else {
        const name = lock === "planner" ? `planner:${venueId}` : `guest-day:${venueId}:email:${CONTACT}:${NEXT_DAY}`;
        await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [name]);
      }
      expect(await send()).toMatchObject({ ok: false, code: "venue_busy" });
    } finally {
      await client.end();
    }
    expect(await state(venueId)).toEqual(before);
    expect(await send()).toMatchObject({ ok: true, version: 2 });
  });
});

describe("a mix of writes on one venue", () => {
  it("never deadlocks, double-books or skips a version", async () => {
    // A fixed seed, so every run draws the same writes.
    let seed = 7;
    const pick = <T>(values: T[]) => values[(seed = (seed * 48271) % 2147483647) % values.length];
    const times = ["18:00", "19:00", "20:00", "21:00", "22:00"];
    const venueId = await seedVenue({ maxActivePerGuestPerDay: 3, overbookingCeiling: 4 }, ["1", "2", "3", "4"]);
    const contacts = ["a@example.com", "b@example.com", "c@example.com"];
    const seen = new Set<string>();
    for (let round = 0; round < 30; round++) {
      const rows = await db.select().from(reservations).where(eq(reservations.venueId, venueId));
      const live = rows.filter((r) => r.status === "booked");
      const calls: Call[] = [];
      for (let i = 0; i < 8; i++) {
        const target = live.length ? pick(live) : undefined;
        const what = target ? pick(["move", "move", "move", "create", "cancel", "party", "status", "erase"]) : "create";
        const date = pick([DAY, NEXT_DAY]);
        const time = pick(times);
        const tableIds = pick([undefined, undefined, ["1"], ["2"], ["3", "4"], []]);
        if (what === "create") calls.push(() => create(venueId, { date, time, guestContact: pick(contacts) }));
        else if (what === "move") calls.push(() => move(venueId, target!.id, { date, time, tableIds, version: target!.version }));
        else if (what === "party") calls.push(() => modifyReservation(db, venueId, target!.id, { partySize: pick([1, 2, 4]) }, key()));
        else if (what === "cancel") calls.push(() => cancelReservation(db, venueId, target!.id, key(), null) as ReturnType<Call>);
        else if (what === "status") calls.push(() => setStatus(db, venueId, target!.id, "no_show", key(), null));
        else if (pick([true, false, false]) && target!.guestId) {
          calls.push(async () => (await erase(db, venueId, target!.guestId!), { ok: true as const }));
        }
      }
      for (const o of await Promise.all(calls.map(outcome))) seen.add(o);
      await expectConsistent(venueId);
    }
    const allowed = ["ok", "slot_taken", "no_suitable_table", "guest_booking_limit", "reservation_changed", "invalid_transition", "already_cancelled"];
    expect([...seen].filter((o) => !allowed.includes(o))).toEqual([]);
  }, 120_000);
});
