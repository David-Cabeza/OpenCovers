import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, tables, venues, waitlist } from "../src/db/schema";
import { createReservation } from "../src/lib/reservations";
import { erase } from "../src/lib/venue";
import { addWaitlist, cancelWaitlist, listWaitlist } from "../src/lib/waitlist";

async function seedVenue(venueId: string) {
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid" });
  await db
    .insert(services)
    .values([{ venueId, name: "dinner", openStart: "19:00", openEnd: "23:00" }]);
  await db.insert(tables).values([{ id: "1", venueId, name: "T1", seats: 2 }]);
}

async function join(venueId: string, guestName: string, guestContact: string) {
  const added = await addWaitlist(db, venueId, { partySize: 2, guestName, guestContact });
  if (!added.ok) throw new Error("waitlist add failed");
  return added.id;
}

async function waitlistContacts(venueId: string): Promise<string[]> {
  const rows = await db.select().from(waitlist).where(eq(waitlist.venueId, venueId));
  return rows.map((r) => r.guestContact).sort();
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe("erasure covers the waitlist", () => {
  it("removes every waitlist entry for the contact in that venue", async () => {
    await seedVenue("wl-erase");
    await join("wl-erase", "Eva", "eva@example.com");
    const cancelled = await join("wl-erase", "Eva", "eva@example.com");
    await cancelWaitlist(db, "wl-erase", cancelled);
    await createReservation(
      db,
      "wl-erase",
      {
        date: "2026-11-12",
        time: "21:00",
        durationMinutes: 120,
        partySize: 2,
        tableIds: ["1"],
        guestName: "Eva",
        guestContact: "eva@example.com",
      },
      "k1",
    );

    const res = await erase(db, "wl-erase", "eva@example.com");

    expect(res).toEqual({ erasedReservations: 1, erasedGuests: 1, erasedWaitlistEntries: 2 });
    expect(await waitlistContacts("wl-erase")).toEqual([]);
  });

  it("erases a guest who is only on the waitlist", async () => {
    await seedVenue("wl-only");
    await join("wl-only", "Iker", "iker@example.com");

    const res = await erase(db, "wl-only", "iker@example.com");

    expect(res).toEqual({ erasedReservations: 0, erasedGuests: 1, erasedWaitlistEntries: 1 });
    expect(await listWaitlist(db, "wl-only")).toEqual([]);
  });

  it("leaves the same contact in another venue", async () => {
    await seedVenue("wl-here");
    await seedVenue("wl-there");
    await join("wl-here", "Lia", "lia@example.com");
    await join("wl-there", "Lia", "lia@example.com");

    await erase(db, "wl-here", "lia@example.com");

    expect(await waitlistContacts("wl-here")).toEqual([]);
    expect(await waitlistContacts("wl-there")).toEqual(["lia@example.com"]);
  });

  it("leaves other guests on the waitlist", async () => {
    await seedVenue("wl-others");
    await join("wl-others", "Noa", "noa@example.com");
    await join("wl-others", "Pau", "pau@example.com");

    await erase(db, "wl-others", "noa@example.com");

    const left = await listWaitlist(db, "wl-others");
    expect(left.map((e) => [e.guestName, e.guestContact])).toEqual([["Pau", "pau@example.com"]]);
  });

  it("is idempotent", async () => {
    await seedVenue("wl-again");
    await join("wl-again", "Rui", "rui@example.com");

    await erase(db, "wl-again", "rui@example.com");
    const again = await erase(db, "wl-again", "rui@example.com");

    expect(again).toEqual({ erasedReservations: 0, erasedGuests: 0, erasedWaitlistEntries: 0 });
  });
});
