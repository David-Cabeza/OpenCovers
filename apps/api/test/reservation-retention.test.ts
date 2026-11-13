import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { events, guestAudit, guests, reservations, services, tables, tombstones, venues } from "../src/db/schema";
import { createReservation, getEvents, setStatus, sha256Hex } from "../src/lib/reservations";
import { runRetention } from "../src/lib/retention";

const NOW = new Date("2026-11-13T12:00:00Z");
let keyCounter = 0;
let tableCounter = 0;

async function seedVenue(venueId: string, retentionDays?: number) {
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid", retentionDays });
  await db.insert(services).values([{ venueId, name: "all", openStart: "00:00", openEnd: "24:00" }]);
  await db
    .insert(tables)
    .values(Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1), venueId, name: `T${i + 1}`, seats: 4 })));
}

async function book(venueId: string, date: string, guestName: string, guestContact: string) {
  tableCounter = (tableCounter % 20) + 1;
  const res = await createReservation(
    db,
    venueId,
    {
      date,
      time: "21:00",
      durationMinutes: 120,
      partySize: 3,
      tableIds: [String(tableCounter)],
      guestName,
      guestContact,
      consent: "granted",
      rating: 5,
    },
    `rres-${++keyCounter}`,
  );
  if (!res.ok) throw new Error(`booking failed: ${res.code}`);
  return res.id;
}

async function row(id: string) {
  return (await db.select().from(reservations).where(eq(reservations.id, id)))[0];
}

async function erasedCount(venueId: string) {
  const rows = await db.select().from(reservations).where(eq(reservations.venueId, venueId));
  return rows.filter((r) => r.erased).length;
}

async function venueDump(venueId: string): Promise<string> {
  return JSON.stringify({
    guests: await db.select().from(guests).where(eq(guests.venueId, venueId)),
    reservations: await db.select().from(reservations).where(eq(reservations.venueId, venueId)),
    audit: await db.select().from(guestAudit).where(eq(guestAudit.venueId, venueId)),
    events: await db.select().from(events).where(eq(events.venueId, venueId)),
    tombstones: await db.select().from(tombstones).where(eq(tombstones.venueId, venueId)),
  });
}

const ANONYMISED = {
  guestName: "",
  guestContact: "",
  guestId: null,
  consent: "unknown",
  consentRecordedAt: null,
  rating: null,
  ratingRecordedAt: null,
  erased: true,
  partySize: 3,
} as const;

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, guest_audit, guests, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe("unlinked reservation retention", () => {
  it("anonymises an old reservation with a name only, a contact only, or an unnormalizable contact", async () => {
    await seedVenue("rr-old");
    const nameOnly = await book("rr-old", "2024-01-10", "Alma", "");
    const contactOnly = await book("rr-old", "2024-01-11", "", "alma@example.com");
    const junk = await book("rr-old", "2024-01-12", "Bruno", "not a contact");
    await db.update(reservations).set({ guestId: null }).where(eq(reservations.id, contactOnly));
    for (const id of [nameOnly, contactOnly, junk]) expect((await row(id)).guestId).toBeNull();

    await runRetention(db, NOW);

    const feed = await getEvents(db, "rr-old", 0, 100);
    for (const id of [nameOnly, contactOnly, junk]) {
      expect(await row(id)).toMatchObject(ANONYMISED);
      const hash = await sha256Hex(id);
      expect(feed.filter((e) => e.type === "erased" && e.reservationId === id)).toEqual([
        expect.objectContaining({ version: 1, tombstoneHash: hash }),
      ]);
      expect(await db.select().from(tombstones).where(eq(tombstones.reservationId, id))).toEqual([
        expect.objectContaining({ venueId: "rr-old", hash }),
      ]);
    }
    expect((await row(nameOnly)).date).toBe("2024-01-10");
  });

  it("keeps a recent reservation", async () => {
    await seedVenue("rr-recent");
    const id = await book("rr-recent", "2026-06-01", "Cleo", "not a contact");

    await runRetention(db, NOW);

    expect(await row(id)).toMatchObject({ guestName: "Cleo", guestContact: "not a contact", erased: false });
  });

  it("keeps a future or still seated reservation", async () => {
    await seedVenue("rr-live");
    const future = await book("rr-live", "2027-03-01", "Dani", "not a contact");
    const seated = await book("rr-live", "2026-11-13", "Eloy", "not a contact");
    const booked = await book("rr-live", "2026-11-13", "Fran", "not a contact");
    expect((await setStatus(db, "rr-live", seated, "seated", `rres-${++keyCounter}`)).ok).toBe(true);

    await runRetention(db, NOW);

    for (const id of [future, seated, booked]) expect(await row(id)).toMatchObject({ erased: false });
    expect((await row(seated)).guestName).toBe("Eloy");
  });

  it("honours each venue's retention period and leaves other venues alone", async () => {
    await seedVenue("rr-short", 30);
    await seedVenue("rr-long");
    const short = await book("rr-short", "2026-08-01", "Gala", "not a contact");
    const long = await book("rr-long", "2026-08-01", "Gala", "not a contact");

    await runRetention(db, NOW);

    expect(await row(short)).toMatchObject(ANONYMISED);
    expect(await row(long)).toMatchObject({ guestName: "Gala", erased: false });
  });

  it("changes nothing on a second run", async () => {
    await seedVenue("rr-idem");
    await book("rr-idem", "2024-01-10", "Hugo", "not a contact");
    await runRetention(db, NOW);
    const before = await venueDump("rr-idem");

    await runRetention(db, NOW);

    expect(await venueDump("rr-idem")).toBe(before);
  });

  it("anonymises at most one batch per run step", async () => {
    await seedVenue("rr-batch");
    for (let i = 0; i < 5; i++) await book("rr-batch", "2024-01-10", `G${i}`, "not a contact");
    const batch = { size: 2, perRun: 1 };

    const counts: number[] = [];
    for (let run = 0; run < 4; run++) {
      await runRetention(db, NOW, batch);
      counts.push(await erasedCount("rr-batch"));
    }

    expect(counts).toEqual([2, 4, 5, 5]);
  });

  it("leaves a guest-linked reservation to guest expiry", async () => {
    await seedVenue("rr-linked");
    const keeper = await book("rr-linked", "2024-01-10", "Ivan", "ivan@example.com");
    const future = await book("rr-linked", "2027-03-01", "Ivan", "ivan@example.com");
    const guestId = (await row(keeper)).guestId as string;
    expect(guestId).not.toBeNull();

    await runRetention(db, NOW);

    expect(await row(keeper)).toMatchObject({ guestName: "Ivan", guestId, erased: false });
    expect(await row(future)).toMatchObject({ erased: false });
    expect((await db.select().from(guests).where(eq(guests.id, guestId)))[0]).toMatchObject({ email: "ivan@example.com" });
    const audit = await db.select().from(guestAudit).where(eq(guestAudit.guestId, guestId));
    expect(audit.map((a) => a.action)).toEqual(["created"]);
  });

  it("leaves no personal value in the venue after expiry", async () => {
    await seedVenue("rr-clean");
    await book("rr-clean", "2024-01-10", "Julia Quintero", "");
    await book("rr-clean", "2024-02-10", "", "julia.q@example.com");
    await book("rr-clean", "2024-03-10", "Julia Quintero", "call after nine");
    await db.update(reservations).set({ guestId: null }).where(eq(reservations.venueId, "rr-clean"));

    await runRetention(db, NOW);

    const dump = (await venueDump("rr-clean")).toLowerCase();
    for (const value of ["julia", "quintero", "julia.q", "call after nine"]) expect(dump).not.toContain(value);
    expect(await erasedCount("rr-clean")).toBe(3);
  });
});
