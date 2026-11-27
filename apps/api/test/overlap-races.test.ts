import pg from "pg";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { reservations, services, tableAllocations, tables, venues } from "../src/db/schema";
import { findLink } from "../src/lib/self-service";
import type { Origin } from "../src/lib/origin";
import {
  cancelReservation,
  createReservation,
  modifyReservation,
  walkIn,
  type CreateReservationInput,
  type OnlineRules,
} from "../src/lib/reservations";
import { localDateTime } from "../src/lib/time";
import { addWaitlist, seatWaitlist } from "../src/lib/waitlist";
import { PARK, dropParkTrigger, holdPark, installParkTrigger, parked, waitUntil } from "./event-park";

// C1 under pressure (#414): writes of different kinds race for the same table at the same time.
//
// Two ways to force the dangerous interleaving:
//   park: one writer is held after its writes and before its commit (event-park.ts), then the rival arrives.
//   gate: writers are held just before or after they touch a table, until every one of them waits on a lock.
//
// An outcome is "ok", the engine's error code, or the SQLSTATE of an error that reached the caller.
//
// Claims of a venue take turns on its planner lock, so at a gate only one writer ever stands: the others have not
// reached a table yet. `atGate` is that count. Two writers there are what could deadlock each other (#451, #452),
// whether or not a given run happens to.

const ROUNDS = 5;

const CLAIM_GATE = 41401; // before a table allocation is inserted
const FREED_GATE = 41402; // after a table allocation is deleted
const PARKED: Origin = { channel: "api", actor: PARK };

const booking = { date: "2027-03-12", time: "21:00", durationMinutes: 120, partySize: 2 };

let venueCount = 0;

/** A venue with two-seat tables, by default "1" and "2", so a party of four needs both. */
async function seedVenue(tableIds = ["1", "2"]): Promise<string> {
  const venueId = `overlap-race-${++venueCount}`;
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid" });
  await db.insert(services).values({ venueId, name: "dinner", openStart: "19:00", openEnd: "23:00" });
  await db.insert(tables).values(tableIds.map((id) => ({ id, venueId, name: `T${id}`, seats: 2 })));
  return venueId;
}

const create = (venueId: string, key: string, input: Partial<CreateReservationInput>) =>
  createReservation(db, venueId, { ...booking, ...input }, `${venueId}-${key}`);

const move = (venueId: string, id: string, tableId: string, key: string, origin?: Origin) =>
  modifyReservation(db, venueId, id, { tableIds: [tableId], origin }, `${venueId}-${key}`);

const cancel = (venueId: string, id: string, origin: Origin | null = null) =>
  cancelReservation(db, venueId, id, `${venueId}-cancel`, origin);

async function book(venueId: string, tableId: string, key: string): Promise<string> {
  const res = await create(venueId, key, { tableIds: [tableId] });
  if (!res.ok) throw new Error(`seed booking failed: ${res.code}`);
  return res.id;
}

type Call = () => Promise<{ ok: true } | { ok: false; code: string }>;

async function outcome(call: Call): Promise<string> {
  try {
    const res = await call();
    return res.ok ? "ok" : res.code;
  } catch (error) {
    // Drizzle's "Failed query" hides the Postgres error; its cause carries the SQLSTATE.
    return (error as { cause?: { code?: string } }).cause?.code ?? String(error);
  }
}

async function lockWaiters(): Promise<number> {
  const { rows } = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
  );
  return rows[0].n;
}

/** `first` writes and parks before its commit. `second` arrives then. `waited` says it could not finish until `first` did. */
async function whileUncommitted(first: (origin: Origin) => ReturnType<Call>, second: Call) {
  const hold = await holdPark();
  let secondDone = false;
  let waited = false;
  const calls = [outcome(() => first(PARKED))];
  try {
    await waitUntil(async () => (await parked()) === 1, "the first write to park");
    calls.push(outcome(second).finally(() => (secondDone = true)));
    await waitUntil(async () => secondDone || (await lockWaiters()) >= 2, "the second write to finish or wait");
    waited = !secondDone;
  } finally {
    await hold.release();
  }
  const [firstOutcome, secondOutcome] = await Promise.all(calls);
  return { first: firstOutcome, second: secondOutcome, waited };
}

/** Starts every write while `gate` is closed, waits until all of them wait on a lock, then opens it. */
async function releasedTogether(gate: number, ...calls: Call[]): Promise<{ outcomes: string[]; atGate: number }> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let running: Promise<string[]> | undefined;
  let atGate = 0;
  try {
    await client.query("select pg_advisory_lock($1)", [gate]);
    const early: string[] = [];
    running = Promise.all(calls.map((call, i) => outcome(call).then((o) => (early.push(`write ${i}: ${o}`), o))));
    await waitUntil(async () => early.length > 0 || (await lockWaiters()) >= calls.length, "every write to wait");
    expect(early, "no write may finish while the gate is closed").toEqual([]);
    const { rows } = await client.query(
      "select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted and classid = 0 and objid = $1",
      [gate],
    );
    atGate = rows[0].n;
  } finally {
    await client.end(); // ending the session releases the gate
  }
  return { outcomes: await running, atGate };
}

/** The no-overlap rule itself: no two live allocations of a table of the venue share any time. */
async function expectNoOverlap(venueId: string) {
  const { rows } = await db.execute(sql`
    select a.venue_id, a.table_id, a.reservation_id, b.reservation_id as other_reservation_id
    from table_allocations a
    join table_allocations b
      on b.venue_id = a.venue_id and b.table_id = a.table_id and b.reservation_id > a.reservation_id
      and a.starts_at < b.ends_at and b.starts_at < a.ends_at
    where a.venue_id = ${venueId} and a.active and b.active`);
  expect(rows).toEqual([]);
}

async function tablesOf(reservationId: string): Promise<string[]> {
  const rows = await db.select().from(tableAllocations).where(eq(tableAllocations.reservationId, reservationId));
  return rows.filter((r) => r.active).map((r) => r.tableId).sort();
}

/** The reservations of a venue, each as "status tables", sorted. A refused create must leave none. */
async function state(venueId: string): Promise<string[]> {
  const rows = await db.select().from(reservations).where(eq(reservations.venueId, venueId));
  return (await Promise.all(rows.map(async (r) => `${r.status} [${(await tablesOf(r.id)).join(",")}]`))).sort();
}

async function installGates() {
  await db.execute(sql.raw(`
    create or replace function test_overlap_gate() returns trigger language plpgsql as $$
    begin
      perform pg_advisory_xact_lock_shared(tg_argv[0]::bigint);
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end $$;
    drop trigger if exists test_overlap_claim_gate on table_allocations;
    create trigger test_overlap_claim_gate before insert on table_allocations
      for each row execute function test_overlap_gate('${CLAIM_GATE}');
    drop trigger if exists test_overlap_freed_gate on table_allocations;
    create trigger test_overlap_freed_gate after delete on table_allocations
      for each row execute function test_overlap_gate('${FREED_GATE}');
  `));
}

async function dropGates() {
  await db.execute(sql.raw(`
    drop trigger if exists test_overlap_claim_gate on table_allocations;
    drop trigger if exists test_overlap_freed_gate on table_allocations;
    drop function if exists test_overlap_gate();
  `));
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
  await installParkTrigger();
  await installGates();
});

afterAll(async () => {
  await dropGates();
  await dropParkTrigger();
});

/** A booking on table "2", then a create on table "1" against a modify that moves the booking to table "1". */
async function createAgainstModify() {
  const venueId = await seedVenue();
  const moving = await book(venueId, "2", "seed");
  return {
    venueId,
    create: (origin?: Origin) => create(venueId, "create", { tableIds: ["1"], origin }),
    modify: (origin?: Origin) => move(venueId, moving, "1", "modify", origin),
  };
}

const CREATE_WON = ["booked [1]", "booked [2]"];
const MODIFY_WON = ["booked [1]"];

describe("a create and a modify that want the same table and time", () => {
  it(`gives one holder and one slot_taken when the second arrives before the first commits, ${ROUNDS} times`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const race = await createAgainstModify();
      const createFirst = round % 2 === 0;
      const result = createFirst
        ? await whileUncommitted(race.create, race.modify)
        : await whileUncommitted(race.modify, race.create);
      expect(result, `round ${round}`).toEqual({ first: "ok", second: "slot_taken", waited: true });
      expect(await state(race.venueId), `round ${round}`).toEqual(createFirst ? CREATE_WON : MODIFY_WON);
      await expectNoOverlap(race.venueId);
    }
  });

  it(`gives one holder and one slot_taken when both claim the table at the same instant, ${ROUNDS} times (#451)`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const race = await createAgainstModify();
      const { outcomes, atGate } = await releasedTogether(CLAIM_GATE, race.create, race.modify);
      expect(atGate, `round ${round}`).toBe(1);
      expect([...outcomes].sort(), `round ${round}`).toEqual(["ok", "slot_taken"]);
      expect(await state(race.venueId), `round ${round}`).toEqual(outcomes[0] === "ok" ? CREATE_WON : MODIFY_WON);
      await expectNoOverlap(race.venueId);
    }
  });
});

describe("two creates that name the same tables", () => {
  it.each([
    { name: "one table (#451)", first: ["1"], second: ["1"] },
    { name: "two tables in opposite orders (#452)", first: ["1", "2"], second: ["2", "1"] },
  ])("books one and refuses the other whole: $name", async ({ first, second }) => {
    for (let round = 0; round < ROUNDS; round++) {
      const venueId = await seedVenue();
      const { outcomes, atGate } = await releasedTogether(
        CLAIM_GATE,
        () => create(venueId, "first", { tableIds: first }),
        () => create(venueId, "second", { tableIds: second }),
      );
      expect([...outcomes].sort(), `round ${round}`).toEqual(["ok", "slot_taken"]);
      expect(atGate, `round ${round}`).toBe(1);
      const won = outcomes[0] === "ok" ? first : second;
      expect(await state(venueId), `round ${round}`).toEqual([`booked [${[...won].sort().join(",")}]`]);
      await expectNoOverlap(venueId);
    }
  });
});

// Allowed outcomes, for the maintainer to confirm. The cancel always succeeds. The create either
//   - succeeds, because the table was free by the time it was checked, and the new booking holds it, or
//   - answers slot_taken, because the table was not free yet, writes nothing, and the table ends free.
describe("a cancel and a create for the same table and time", () => {
  async function seed() {
    const venueId = await seedVenue();
    const id = await book(venueId, "1", "seed");
    return { venueId, id, create: () => create(venueId, "create", { tableIds: ["1"] }) };
  }
  const CREATE_TOOK_IT = ["booked [1]", "cancelled []"];
  const TABLE_LEFT_FREE = ["cancelled []"];

  it("refuses a create that arrives before the cancel has freed the table", async () => {
    const race = await seed();
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    let cancelling: Promise<string> | undefined;
    try {
      // The cancel stops at its row lock, before it deletes the allocation.
      await client.query("begin");
      await client.query("select 1 from reservations where id = $1 for update", [race.id]);
      cancelling = outcome(() => cancel(race.venueId, race.id));
      await waitUntil(async () => (await lockWaiters()) >= 1, "the cancel to wait for the row");
      expect(await outcome(race.create)).toBe("slot_taken");
    } finally {
      await client.end();
    }
    expect(await cancelling).toBe("ok");
    expect(await state(race.venueId)).toEqual(TABLE_LEFT_FREE);
    await expectNoOverlap(race.venueId);
  });

  it("gives the table to a create that arrives while the cancel is committing", async () => {
    const race = await seed();
    const result = await whileUncommitted((origin) => cancel(race.venueId, race.id, origin), race.create);
    expect(result).toEqual({ first: "ok", second: "ok", waited: true });
    expect(await state(race.venueId)).toEqual(CREATE_TOOK_IT);
    await expectNoOverlap(race.venueId);
  });

  it(`ends in an allowed state when both start together, ${ROUNDS} times`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const race = await seed();
      const [cancelled, created] = await Promise.all([
        outcome(() => cancel(race.venueId, race.id)),
        outcome(race.create),
      ]);
      expect(cancelled, `round ${round}`).toBe("ok");
      expect(["ok", "slot_taken"], `round ${round}`).toContain(created);
      expect(await state(race.venueId), `round ${round}`).toEqual(created === "ok" ? CREATE_TOOK_IT : TABLE_LEFT_FREE);
      await expectNoOverlap(race.venueId);
    }
  });
});

const combinations = [
  // A party of four fits only tables 1 and 2 together. The planner answers no_suitable_table once one is held.
  { name: "an automatic combination", input: { partySize: 4 }, refusal: "no_suitable_table" },
  { name: "explicit tables 1 and 2", input: { partySize: 4, tableIds: ["1", "2"] }, refusal: "slot_taken" },
];

describe.each(combinations)("$name against a create on one of its tables", ({ input, refusal }) => {
  const combo = (venueId: string, origin?: Origin) => create(venueId, "combo", { ...input, origin });
  const single = (venueId: string, tableId: string, origin?: Origin) =>
    create(venueId, "single", { tableIds: [tableId], origin });

  it("refuses the combination whole when the single table is taken first", async () => {
    const venueId = await seedVenue();
    // Table 2, the second the combination claims: its claim on table 1 must be rolled back.
    const result = await whileUncommitted((origin) => single(venueId, "2", origin), () => combo(venueId));
    expect(result).toEqual({ first: "ok", second: refusal, waited: true });
    expect(await state(venueId)).toEqual(["booked [2]"]);
    await expectNoOverlap(venueId);
  });

  it("refuses the single table when the combination takes it first", async () => {
    const venueId = await seedVenue();
    const result = await whileUncommitted((origin) => combo(venueId, origin), () => single(venueId, "2"));
    expect(result).toEqual({ first: "ok", second: "slot_taken", waited: true });
    expect(await state(venueId)).toEqual(["booked [1,2]"]);
    await expectNoOverlap(venueId);
  });

  it("gives the shared table to one of them when both claim at the same instant (#451)", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const venueId = await seedVenue();
      // Table 1, the first the combination claims, so the two claims collide.
      const { outcomes, atGate } = await releasedTogether(CLAIM_GATE, () => combo(venueId), () => single(venueId, "1"));
      const [combined, alone] = outcomes;
      expect(atGate, `round ${round}`).toBe(1);
      expect(outcomes, `round ${round}`).toEqual(combined === "ok" ? ["ok", "slot_taken"] : [refusal, "ok"]);
      expect(await state(venueId), `round ${round}`).toEqual(alone === "ok" ? ["booked [1]"] : ["booked [1,2]"]);
      await expectNoOverlap(venueId);
    }
  });
});

describe("eight simultaneous claims of one table (#451)", () => {
  it("gives it to one and answers the other seven slot_taken", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      // Four creates on table "1" and four modifies that move a booking to it.
      const venueId = await seedVenue(["1", "2", "3", "4", "5"]);
      const calls: Call[] = [];
      for (const own of ["2", "3", "4", "5"]) {
        const moving = await book(venueId, own, `seed-${own}`);
        calls.push(
          () => create(venueId, `create-${own}`, { tableIds: ["1"] }),
          () => move(venueId, moving, "1", `move-${own}`),
        );
      }
      const { outcomes, atGate } = await releasedTogether(CLAIM_GATE, ...calls);
      expect(atGate, `round ${round}`).toBe(1);
      expect([...outcomes].sort(), `round ${round}`).toEqual(["ok", ...Array(7).fill("slot_taken")]);
      await expectNoOverlap(venueId);
    }
  });
});

const PUBLIC_RULES: OnlineRules = {
  services: null,
  weekdays: null,
  minPartySize: 1,
  maxPartySize: 8,
  leadTimeMinutes: 0,
  maxAdvanceDays: 3650,
  maxOpenBookingsPerContact: null,
};

/** A walk-in and a seat happen now, so their venue serves all day. */
async function seedAllDayVenue() {
  const venueId = await seedVenue(["1"]);
  await db.update(services).set({ openStart: "00:00", openEnd: "24:00" }).where(eq(services.venueId, venueId));
  return venueId;
}

// Every kind of write that gives a reservation a table, against a create that names the table it is about to take.
const writers: { name: string; refusal: string; setUp: () => Promise<{ venueId: string; claim: Call; rival: Call }> }[] = [
  {
    name: "a create that assigns the table itself",
    refusal: "no_suitable_table",
    setUp: async () => {
      const venueId = await seedVenue(["1"]);
      return {
        venueId,
        claim: () => create(venueId, "claim", {}),
        rival: () => create(venueId, "rival", { tableIds: ["1"] }),
      };
    },
  },
  {
    name: "a walk-in that names the table",
    refusal: "slot_taken",
    setUp: async () => {
      const venueId = await seedVenue(["1"]);
      return {
        venueId,
        claim: () =>
          walkIn(db, venueId, { partySize: 2, tableIds: ["1"], date: booking.date, time: booking.time }, `${venueId}-claim`),
        rival: () => create(venueId, "rival", { tableIds: ["1"] }),
      };
    },
  },
  {
    name: "a seat from the waitlist",
    refusal: "no_suitable_table",
    setUp: async () => {
      const venueId = await seedAllDayVenue();
      const added = await addWaitlist(db, venueId, { partySize: 2 });
      if (!added.ok) throw new Error(`waitlist add failed: ${added.code}`);
      const now = localDateTime(new Date(), "Europe/Madrid");
      return {
        venueId,
        claim: () => seatWaitlist(db, venueId, added.id, `${venueId}-claim`, null),
        rival: () => walkIn(db, venueId, { partySize: 2, tableIds: ["1"], ...now }, `${venueId}-rival`),
      };
    },
  },
  {
    name: "a public create",
    refusal: "slot_taken",
    setUp: async () => {
      const venueId = await seedVenue(["1"]);
      return {
        venueId,
        claim: () => create(venueId, "claim", { channel: { kind: "public", rules: PUBLIC_RULES } }),
        rival: () => create(venueId, "rival", { tableIds: ["1"] }),
      };
    },
  },
  {
    name: "a self-service modify that needs a second table",
    refusal: "no_suitable_table",
    setUp: async () => {
      // Table ids no other venue has: a guest's modify today sums the seats of same-named tables of every venue.
      const venueId = await seedVenue(["g1"]);
      const booked = await create(venueId, "seed", { channel: { kind: "public", rules: PUBLIC_RULES } });
      if (!booked.ok) throw new Error(`seed booking failed: ${booked.code}`);
      const link = await findLink(db, booked.selfServiceToken!);
      // Added after the booking, so the booking holds table "1" and table "2" is the one the larger party needs.
      await db.insert(tables).values({ id: "g2", venueId, name: "Tg2", seats: 2 });
      const selfService = { linkId: link!.id, cutoffMinutes: 0, version: 1, rules: PUBLIC_RULES };
      return {
        venueId,
        claim: () => modifyReservation(db, venueId, booked.id, { partySize: 4, selfService }, `${venueId}-claim`),
        rival: () => create(venueId, "rival", { tableIds: ["g2"] }),
      };
    },
  },
];

describe.each(writers)("$name against a create that names the table it wants", ({ setUp, refusal }) => {
  it("waits its turn, and one of the two gets the table", async () => {
    const { venueId, claim, rival } = await setUp();
    const { outcomes, atGate } = await releasedTogether(CLAIM_GATE, claim, rival);
    expect(atGate).toBe(1);
    expect(outcomes).toEqual(outcomes[0] === "ok" ? ["ok", "slot_taken"] : [refusal, "ok"]);
    await expectNoOverlap(venueId);
  });
});

describe("two modifies that swap the tables of two bookings (#452)", () => {
  it("refuses both and leaves each booking on its table", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const venueId = await seedVenue();
      const one = await book(venueId, "1", "one");
      const two = await book(venueId, "2", "two");
      // Held after a modify frees its own table: had both freed one, each would then wait for the other's.
      const { outcomes, atGate } = await releasedTogether(
        FREED_GATE,
        () => move(venueId, one, "2", "move-one"),
        () => move(venueId, two, "1", "move-two"),
      );
      expect(outcomes, `round ${round}`).toEqual(["slot_taken", "slot_taken"]);
      expect(atGate, `round ${round}`).toBe(1);
      expect(await tablesOf(one), `round ${round}`).toEqual(["1"]);
      expect(await tablesOf(two), `round ${round}`).toEqual(["2"]);
      await expectNoOverlap(venueId);
    }
  });
});
