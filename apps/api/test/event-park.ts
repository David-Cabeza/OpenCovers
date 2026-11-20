import pg from "pg";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";

// A test-only trigger that holds a writer right after its event row is inserted, before it commits: the window
// in which a later event id can commit first. An event whose actor is PARK waits on an advisory lock the test
// holds; one whose actor is JITTER sleeps up to a few milliseconds, to widen that window under load.

export const PARK = "park";
export const JITTER = "jitter";
const PARK_KEY = 4242;

export async function installParkTrigger() {
  await db.execute(sql.raw(`
    create or replace function test_event_park() returns trigger language plpgsql as $$
    begin
      if new.actor = '${PARK}' then perform pg_advisory_xact_lock(${PARK_KEY}); end if;
      if new.actor = '${JITTER}' then perform pg_sleep(random() * 0.004); end if;
      return new;
    end $$;
    drop trigger if exists test_event_park on events;
    create trigger test_event_park after insert on events for each row execute function test_event_park();
  `));
}

export async function dropParkTrigger() {
  await db.execute(sql.raw(`drop trigger if exists test_event_park on events; drop function if exists test_event_park();`));
}

/** Holds the park lock on its own session until `release`. */
export async function holdPark() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`select pg_advisory_lock(${PARK_KEY})`);
  return {
    release: async () => {
      await client.query(`select pg_advisory_unlock(${PARK_KEY})`);
      await client.end();
    },
  };
}

async function count(query: string): Promise<number> {
  const { rows } = await db.execute<{ n: number }>(sql.raw(query));
  return Number(rows[0].n);
}

/** Sessions waiting on the park lock: writers held after their event insert. */
export const parked = () =>
  count(`select count(*) as n from pg_locks where locktype = 'advisory' and not granted and classid = 0 and objid = ${PARK_KEY}`);

/** Sessions waiting on any other advisory lock (the events lock among them). */
export const waitingElsewhere = () =>
  count(`select count(*) as n from pg_locks where locktype = 'advisory' and not granted and not (classid = 0 and objid = ${PARK_KEY})`);

export async function waitUntil(check: () => Promise<boolean>, what: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Resolves true once `promise` settles, false once it is seen blocked on a lock instead. */
export async function settlesOrBlocks(promise: Promise<unknown>, blockedSessions: number): Promise<boolean> {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await waitUntil(async () => settled || (await waitingElsewhere()) >= blockedSessions, "a write to settle or block");
  return settled;
}
