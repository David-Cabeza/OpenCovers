import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { events, reservations, services, tableAllocations, tables, venues } from "../src/db/schema";
import { cancelReservation, createReservation, setStatus } from "../src/lib/reservations";

const ROUNDS = 25;

async function seedBooking(venueId: string): Promise<string> {
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid" });
  await db.insert(services).values([{ venueId, name: "dinner", openStart: "19:00", openEnd: "23:00" }]);
  await db.insert(tables).values([{ id: "1", venueId, name: "T1", seats: 2 }]);
  const created = await createReservation(
    db,
    venueId,
    { date: "2026-11-12", time: "21:00", durationMinutes: 120, partySize: 2, tableIds: ["1"] },
    `${venueId}-create`,
  );
  if (!created.ok) throw new Error(`create failed: ${created.code}`);
  return created.id;
}

async function race(rival: "cancel" | "no_show", round: number) {
  const venueId = `race-${rival}-${round}`;
  const id = await seedBooking(venueId);
  const [seat, other] = await Promise.all([
    setStatus(db, venueId, id, "seated", `${venueId}-seat`, null),
    rival === "cancel"
      ? cancelReservation(db, venueId, id, `${venueId}-cancel`, null)
      : setStatus(db, venueId, id, "no_show", `${venueId}-noshow`, null),
  ]);
  const row = (await db.select().from(reservations).where(eq(reservations.id, id)))[0];
  const held = await db.select().from(tableAllocations).where(eq(tableAllocations.reservationId, id));
  const log = await db.select().from(events).where(eq(events.reservationId, id)).orderBy(events.id);
  return { seat, other, row, held, log };
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe.each(["cancel", "no_show"] as const)("seated racing %s", (rival) => {
  it("has one winner, strictly increasing versions and a table for a seated booking", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { seat, other, row, held, log } = await race(rival, round);
      const winners = [seat, other].filter((r) => r.ok);
      const loser = [seat, other].find((r) => !r.ok);
      if (rival === "no_show") {
        // Both need a booked reservation, so exactly one can win.
        expect(winners, `round ${round}`).toHaveLength(1);
      } else {
        // Seat then cancel is a legal order (both succeed); cancel then seat is not (seat must lose).
        expect(winners.length, `round ${round}`).toBeGreaterThanOrEqual(1);
        expect(row.status, `round ${round}`).toBe(seat.ok ? (other.ok ? "cancelled" : "seated") : "cancelled");
      }
      if (loser) expect(!loser.ok && loser.code, `round ${round}`).toBe("invalid_transition");

      const versions = log.map((e) => e.version);
      expect(versions, `round ${round}`).toEqual([...versions].sort((a, b) => a - b));
      expect(new Set(versions).size, `round ${round}`).toBe(versions.length);
      expect(row.version, `round ${round}`).toBe(versions[versions.length - 1]);

      if (row.status === "seated") {
        expect(held.some((a) => a.active), `round ${round}`).toBe(true);
        expect(log.some((e) => e.type === "cancelled")).toBe(false);
      } else if (row.status === "cancelled") {
        expect(held.some((a) => a.active), `round ${round}`).toBe(false);
      }
    }
  });
});
