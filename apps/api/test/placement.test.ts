import pg from "pg";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, tables, venues } from "../src/db/schema";
import {
  createReservation,
  explainSlot,
  getAvailability,
  publicDays,
  publicTimes,
  walkIn,
  type CreateReservationInput,
  type OnlineRules,
} from "../src/lib/reservations";
import { addDays, localDateTime } from "../src/lib/time";

// ADR-0028, section 1: create and the availability reads choose a service, a window and tables the same way. These
// hold which refusal wins when several apply, and that only a write takes the overbooking lock.

// The public channel takes no past date and no date more than a year ahead.
const DATE = addDays(localDateTime(new Date(), "Europe/Madrid").date, 30);

const PUBLIC: OnlineRules = {
  services: null,
  weekdays: null,
  minPartySize: 1,
  maxPartySize: 20,
  leadTimeMinutes: 0,
  maxAdvanceDays: null,
  maxOpenBookingsPerContact: null,
};

let venueCount = 0;
let keyCount = 0;

/** Dinner for parties of up to 6, one table for 4 in the room and one for 2 on the terrace. */
async function seedVenue(settings: Partial<typeof venues.$inferInsert> = {}) {
  const venueId = `placement-${++venueCount}`;
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid", ...settings });
  await db.insert(services).values({ venueId, name: "dinner", openStart: "19:00", openEnd: "23:00", maxPartySize: 6 });
  await db.insert(tables).values([
    { id: "1", venueId, name: "T1", seats: 4, zone: "Room" },
    { id: "2", venueId, name: "T2", seats: 2, zone: "Terrace" },
  ]);
  return venueId;
}

function create(venueId: string, input: Partial<CreateReservationInput> = {}) {
  return createReservation(db, venueId, { date: DATE, time: "21:00", partySize: 2, ...input }, `placement-${++keyCount}`);
}

const refused = (code: string) => ({ ok: false, code });

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, guest_audit, guests, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe("which refusal wins on a create", () => {
  it("puts the time and service rules before the named tables", async () => {
    const venueId = await seedVenue();
    expect(await create(venueId, { time: "21:10", tableIds: ["ghost"] })).toEqual(refused("outside_hours"));
    expect(await create(venueId, { partySize: 7, tableIds: ["ghost"] })).toEqual(refused("party_size_too_large"));
  });

  it("checks named tables for being known, then for seats, then for the zone", async () => {
    const venueId = await seedVenue();
    expect(await create(venueId, { partySize: 6, tableIds: ["ghost"] })).toEqual(refused("invalid_request"));
    expect(await create(venueId, { partySize: 3, tableIds: ["2"], zone: "Room" })).toEqual(
      refused("party_size_too_large"),
    );
    expect(await create(venueId, { tableIds: ["2"], zone: "Room" })).toEqual(refused("invalid_request"));
  });

  it("puts named tables before the daily cap, and the daily cap before the table search", async () => {
    const venueId = await seedVenue({ maxActivePerGuestPerDay: 1 });
    const guest = { guestContact: "ana@example.com" };
    expect(await create(venueId, { ...guest, partySize: 4 })).toMatchObject({ ok: true });
    expect(await create(venueId, { ...guest, tableIds: ["ghost"] })).toEqual(refused("invalid_request"));
    expect(await create(venueId, { ...guest, partySize: 4 })).toEqual(refused("guest_booking_limit"));
  });

  it("takes an empty list of tables as no tables named", async () => {
    const venueId = await seedVenue();
    expect(await create(venueId, { tableIds: [] })).toMatchObject({ ok: true });
    expect(await create(venueId, { tableIds: [] })).toMatchObject({ ok: true });
    expect(await create(venueId, { tableIds: [] })).toEqual(refused("no_suitable_table"));
  });
});

describe("the overbooking lock", () => {
  /** Runs `work` while another session holds the venue's overbooking lock, as a ceiling change would. */
  async function whileHeld<T>(venueId: string, work: () => Promise<T>): Promise<T> {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`overbooking:${venueId}`]);
      return await work();
    } finally {
      await client.end();
    }
  }

  async function fullVenue() {
    const venueId = await seedVenue({ overbookingCeiling: 10 });
    expect(await create(venueId, { partySize: 4, tableIds: ["1"] })).toMatchObject({ ok: true });
    expect(await create(venueId, { partySize: 2, tableIds: ["2"] })).toMatchObject({ ok: true });
    return venueId;
  }

  it("is never taken by availability, the explanation or the public reads", async () => {
    const venueId = await fullVenue();
    await whileHeld(venueId, async () => {
      const staff = await getAvailability(db, venueId, DATE, 2);
      expect(staff.dinner.find((s) => s.time === "21:00")?.available).toBe(true);
      expect(await explainSlot(db, venueId, { date: DATE, time: "21:00", partySize: 2 })).toMatchObject({
        available: true,
        reasons: [],
      });
      expect((await publicTimes(db, venueId, DATE, 2, PUBLIC)).times).not.toContain("21:00");
      expect(await publicDays(db, venueId, [DATE], 2, PUBLIC)).toMatchObject([{ date: DATE, status: "available" }]);
    });
  });

  it("is not taken by a create the ceiling cannot help", async () => {
    const venueId = await fullVenue();
    await whileHeld(venueId, async () => {
      expect(await create(venueId, { time: "21:10" })).toEqual(refused("outside_hours"));
      expect(await create(venueId, { tableIds: ["1"] })).toEqual(refused("slot_taken"));
      expect(await create(venueId, { partySize: 6, zone: "Room" })).toEqual(refused("party_size_too_large"));
      expect(await create(venueId, { channel: { kind: "public", rules: PUBLIC } })).toEqual(refused("slot_taken"));
      expect(await walkIn(db, venueId, { date: DATE, time: "21:00", partySize: 2 }, `placement-${++keyCount}`)).toEqual(
        refused("no_suitable_table"),
      );
    });
  });

  it("is taken by the staff create that needs the ceiling", async () => {
    const venueId = await fullVenue();
    await whileHeld(venueId, async () => {
      expect(await create(venueId)).toEqual(refused("venue_busy"));
    });
    expect(await create(venueId)).toMatchObject({ ok: true });
  });
});
