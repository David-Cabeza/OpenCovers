import pg from "pg";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { events, idempotencyKeys, reservations, services, tables, venues, waitlist } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { cancelReservation, createReservation, modifyReservation, setStatus, walkIn } from "../src/lib/reservations";
import { addWaitlist, seatWaitlist } from "../src/lib/waitlist";
import { waitUntil } from "./event-park";

// C1: a reservation write waits a bounded time for another write of the venue, then answers `venue_busy`, writes
// nothing and keeps no idempotency key. A deadlock the database breaks gets the same answer, never a 500.

const booking = { date: "2027-03-12", time: "21:00", durationMinutes: 120, partySize: 2 };

let venueCount = 0;

async function seedVenue() {
  const venueId = `venue-busy-${++venueCount}`;
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid" });
  await db.insert(services).values({ venueId, name: "all", openStart: "00:00", openEnd: "24:00" });
  await db.insert(tables).values(["1", "2", "3", "4", "5", "6", "7", "8"].map((id) => ({ id, venueId, name: `T${id}`, seats: 2 })));
  await addKey(db, `key-${venueId}`, `p-${venueId}`, [venueId], "write");
  return venueId;
}

async function book(venueId: string, tableId: string) {
  const res = await createReservation(db, venueId, { ...booking, tableIds: [tableId] }, `${venueId}-seed-${tableId}`);
  if (!res.ok) throw new Error(`seed booking failed: ${res.code}`);
  return res.id;
}

/** Another session holding the venue's planner lock, as a writer stuck in the middle of a claim would. */
async function holdPlanner(venueId: string) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("begin");
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`planner:${venueId}`]);
  return client;
}

async function snapshot(venueId: string) {
  const rows = await db.select().from(reservations).where(eq(reservations.venueId, venueId));
  return {
    reservations: rows.map((r) => `${r.id} ${r.status} v${r.version}`).sort(),
    events: (await db.select().from(events).where(eq(events.venueId, venueId))).length,
    keys: (await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.venueId, venueId))).length,
    waiting: (await db.select().from(waitlist).where(eq(waitlist.venueId, venueId))).map((w) => w.status),
  };
}

async function lockWaiters(): Promise<number> {
  const { rows } = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
  );
  return rows[0].n;
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe("a write stuck behind another write of the venue", () => {
  it("gives up with venue_busy, writes nothing, and the same key succeeds later", async () => {
    const venueId = await seedVenue();
    const moving = await book(venueId, "1");
    const cancelling = await book(venueId, "2");
    const seating = await book(venueId, "3");
    const added = await addWaitlist(db, venueId, { partySize: 2 });
    if (!added.ok) throw new Error(`waitlist add failed: ${added.code}`);

    const post = () =>
      app.request(`/v1/venues/${venueId}/reservations`, {
        method: "POST",
        headers: { apikey: `key-${venueId}`, "content-type": "application/json", "Idempotency-Key": `${venueId}-http` },
        body: JSON.stringify({ date: booking.date, time: booking.time, partySize: 2, tables: ["5"] }),
      });
    const writes = {
      create: () => createReservation(db, venueId, { ...booking, tableIds: ["4"] }, `${venueId}-create`),
      walkIn: () => walkIn(db, venueId, { partySize: 2 }, `${venueId}-walk-in`),
      modify: () => modifyReservation(db, venueId, moving, { tableIds: ["6"] }, `${venueId}-modify`),
      seat: () => seatWaitlist(db, venueId, added.id, `${venueId}-seat`, null),
      // These two claim no table. They wait on their reservation's row instead.
      cancel: () => cancelReservation(db, venueId, cancelling, `${venueId}-cancel`, null),
      status: () => setStatus(db, venueId, seating, "seated", `${venueId}-status`, null),
    };
    const before = await snapshot(venueId);

    const holder = await holdPlanner(venueId);
    let blocked: unknown[];
    let http: Response;
    try {
      await holder.query("select 1 from reservations where id = any($1) for update", [[cancelling, seating]]);
      [http, ...blocked] = await Promise.all([post(), ...Object.values(writes).map((write) => write())]);
    } finally {
      await holder.end();
    }

    expect(blocked).toEqual(Object.keys(writes).map(() => ({ ok: false, code: "venue_busy" })));
    expect(http.status).toBe(503);
    expect(await http.json()).toEqual({ code: "venue_busy", message: "venue_busy", retryable: true });
    expect(await snapshot(venueId)).toEqual(before);

    for (const [name, write] of Object.entries(writes)) {
      expect(await write(), name).toMatchObject({ ok: true });
    }
    expect((await post()).status).toBe(200);
  });
});

describe("a write the database aborts to break a deadlock", () => {
  it("answers venue_busy and writes nothing", async () => {
    const venueId = await seedVenue();
    const moving = await book(venueId, "1");
    const before = await snapshot(venueId);

    const holder = await holdPlanner(venueId);
    let result: unknown;
    try {
      // The modify holds its reservation's row and waits for the planner. Asking for that row closes the cycle, and
      // PostgreSQL aborts the session that has waited longest, the modify.
      const modify = modifyReservation(db, venueId, moving, { tableIds: ["2"] }, `${venueId}-modify`);
      await waitUntil(async () => (await lockWaiters()) >= 1, "the modify to wait for the planner");
      await holder.query("select 1 from reservations where id = $1 for update", [moving]);
      result = await modify;
    } finally {
      await holder.end();
    }

    expect(result).toEqual({ ok: false, code: "venue_busy" });
    expect(await snapshot(venueId)).toEqual(before);
  });
});
