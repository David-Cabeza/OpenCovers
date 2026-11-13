import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import {
  events,
  guestAudit,
  guests,
  reservations,
  services,
  tables,
  tombstones,
  venues,
  waitlist,
} from "../src/db/schema";
import { createReservation, getEvents, setStatus, sha256Hex } from "../src/lib/reservations";
import { runRetention } from "../src/lib/retention";
import { erase } from "../src/lib/venue";
import { addWaitlist } from "../src/lib/waitlist";

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
    `ret-${++keyCounter}`,
  );
  if (!res.ok) throw new Error(`booking failed: ${res.code}`);
  return res.id;
}

async function guestOf(reservationId: string) {
  const [r] = await db.select().from(reservations).where(eq(reservations.id, reservationId));
  const [g] = await db.select().from(guests).where(eq(guests.id, r.guestId as string));
  return g;
}

async function guestRow(id: string) {
  return (await db.select().from(guests).where(eq(guests.id, id)))[0];
}

async function reservationRow(id: string) {
  return (await db.select().from(reservations).where(eq(reservations.id, id)))[0];
}

async function venueDump(venueId: string): Promise<string> {
  return JSON.stringify({
    guests: await db.select().from(guests).where(eq(guests.venueId, venueId)),
    reservations: await db.select().from(reservations).where(eq(reservations.venueId, venueId)),
    audit: await db.select().from(guestAudit).where(eq(guestAudit.venueId, venueId)),
    events: await db.select().from(events).where(eq(events.venueId, venueId)),
    tombstones: await db.select().from(tombstones).where(eq(tombstones.venueId, venueId)),
    waitlist: await db.select().from(waitlist).where(eq(waitlist.venueId, venueId)),
  });
}

async function expiredCount(venueId: string) {
  const rows = await db.select().from(guests).where(eq(guests.venueId, venueId));
  return rows.filter((g) => g.email === null && g.phone === null && g.name === "").length;
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, guest_audit, guests, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe("guest retention", () => {
  it("clears a guest whose last visit is past the horizon and anonymises the visits", async () => {
    await seedVenue("ret-expire");
    const first = await book("ret-expire", "2024-01-10", "Eva", "eva@example.com");
    const second = await book("ret-expire", "2024-02-10", "Eva G.", "Eva@Example.com");
    const guest = await guestOf(first);

    await runRetention(db, NOW);

    expect(await guestRow(guest.id)).toMatchObject({ email: null, phone: null, name: "" });
    for (const id of [first, second]) {
      expect(await reservationRow(id)).toMatchObject({
        guestName: "",
        guestContact: "",
        guestId: null,
        consent: "unknown",
        consentRecordedAt: null,
        rating: null,
        ratingRecordedAt: null,
        erased: true,
        partySize: 3,
        status: "booked",
      });
    }
    expect((await reservationRow(first)).date).toBe("2024-01-10");
    const audit = await db.select().from(guestAudit).where(eq(guestAudit.guestId, guest.id));
    expect(audit.map((a) => [a.action, a.principal])).toEqual([
      ["created", ""],
      ["expired", "retention"],
    ]);
  });

  it("keeps a guest with a future booking", async () => {
    await seedVenue("ret-future");
    const old = await book("ret-future", "2024-01-10", "Iker", "iker@example.com");
    const future = await book("ret-future", "2027-03-01", "Iker", "iker@example.com");
    expect((await guestOf(old)).lastVisitAt).toEqual((await reservationRow(future)).startsAt);

    await runRetention(db, NOW);

    expect(await guestOf(old)).toMatchObject({ email: "iker@example.com", name: "Iker" });
    expect(await reservationRow(old)).toMatchObject({ guestName: "Iker", erased: false });
  });

  it("keeps a guest with a future or seated visit even when its last visit time is stale", async () => {
    await seedVenue("ret-stale");
    const future = await book("ret-stale", "2027-03-01", "Ona", "ona@example.com");
    const seated = await book("ret-stale", "2026-11-13", "Bo", "bo@example.com");
    expect((await setStatus(db, "ret-stale", seated, "seated", `ret-${++keyCounter}`)).ok).toBe(true);
    await db
      .update(guests)
      .set({ lastVisitAt: new Date("2024-01-10T20:00:00Z") })
      .where(eq(guests.venueId, "ret-stale"));

    await runRetention(db, NOW);

    expect(await guestOf(future)).toMatchObject({ email: "ona@example.com", name: "Ona" });
    expect(await guestOf(seated)).toMatchObject({ email: "bo@example.com", name: "Bo" });
  });

  it("keeps a guest who is seated now", async () => {
    await seedVenue("ret-seated");
    const old = await book("ret-seated", "2024-01-10", "Noa", "noa@example.com");
    const today = await book("ret-seated", "2026-11-13", "Noa", "noa@example.com");
    expect((await setStatus(db, "ret-seated", today, "seated", `ret-${++keyCounter}`)).ok).toBe(true);

    await runRetention(db, NOW);

    expect(await guestOf(old)).toMatchObject({ email: "noa@example.com" });
    expect(await reservationRow(old)).toMatchObject({ guestName: "Noa", erased: false });
  });

  it("keeps a guest whose last visit is inside the horizon", async () => {
    await seedVenue("ret-recent");
    const id = await book("ret-recent", "2026-06-01", "Lia", "lia@example.com");

    await runRetention(db, NOW);

    expect(await guestOf(id)).toMatchObject({ email: "lia@example.com", name: "Lia" });
    expect(await reservationRow(id)).toMatchObject({ guestContact: "lia@example.com", erased: false });
  });

  it("honours each venue's retention period and leaves other venues alone", async () => {
    await seedVenue("ret-short", 30);
    await seedVenue("ret-long");
    const short = await book("ret-short", "2026-08-01", "Ana", "ana@example.com");
    const long = await book("ret-long", "2026-08-01", "Ana", "ana@example.com");
    const shortGuest = await guestOf(short);

    await runRetention(db, NOW);

    expect(await guestRow(shortGuest.id)).toMatchObject({ email: null, name: "" });
    expect(await reservationRow(short)).toMatchObject({ guestContact: "", erased: true });
    expect(await guestOf(long)).toMatchObject({ email: "ana@example.com", name: "Ana" });
    expect(await reservationRow(long)).toMatchObject({ guestContact: "ana@example.com", erased: false });
  });

  it("changes nothing on a second run", async () => {
    await seedVenue("ret-idem");
    await book("ret-idem", "2024-01-10", "Pau", "pau@example.com");
    await runRetention(db, NOW);
    const before = await venueDump("ret-idem");

    await runRetention(db, NOW);

    expect(await venueDump("ret-idem")).toBe(before);
  });

  it("expires at most one batch per run step", async () => {
    await seedVenue("ret-batch");
    for (let i = 0; i < 5; i++) await book("ret-batch", "2024-01-10", `G${i}`, `g${i}@example.com`);
    const batch = { size: 2, perRun: 1 };

    const counts: number[] = [];
    for (let run = 0; run < 4; run++) {
      await runRetention(db, NOW, batch);
      counts.push(await expiredCount("ret-batch"));
    }

    expect(counts).toEqual([2, 4, 5, 5]);
  });

  it("expires each guest once when two runs overlap", async () => {
    await seedVenue("ret-race");
    for (let i = 0; i < 6; i++) await book("ret-race", "2024-01-10", `R${i}`, `r${i}@example.com`);
    const batch = { size: 2, perRun: 10 };

    await Promise.all([runRetention(db, NOW, batch), runRetention(db, NOW, batch)]);

    const audit = await db.select().from(guestAudit).where(eq(guestAudit.venueId, "ret-race"));
    expect(audit.filter((a) => a.action === "expired")).toHaveLength(6);
    expect(await expiredCount("ret-race")).toBe(6);
    const feed = await getEvents(db, "ret-race", 0, 100);
    expect(feed.filter((e) => e.type === "erased")).toHaveLength(6);
  });

  it("writes the same tombstone and erased event as erasure", async () => {
    await seedVenue("ret-events");
    const erased = await book("ret-events", "2026-06-01", "Eli", "eli@example.com");
    const expired = await book("ret-events", "2024-01-10", "Teo", "teo@example.com");
    await erase(db, "ret-events", (await guestOf(erased)).id);

    await runRetention(db, NOW);

    const feed = await getEvents(db, "ret-events", 0, 100);
    for (const id of [erased, expired]) {
      const hash = await sha256Hex(id);
      expect(feed.filter((e) => e.type === "erased" && e.reservationId === id)).toEqual([
        expect.objectContaining({ version: 1, tombstoneHash: hash }),
      ]);
      expect(await db.select().from(tombstones).where(eq(tombstones.reservationId, id))).toEqual([
        expect.objectContaining({ venueId: "ret-events", hash }),
      ]);
    }
  });

  it("clears a guest merged into an expired guest", async () => {
    await seedVenue("ret-merged");
    const id = await book("ret-merged", "2024-01-10", "Mia", "mia@example.com");
    const root = await guestOf(id);
    await db.insert(guests).values({
      id: "ret-merged-child",
      venueId: "ret-merged",
      phone: "+34600123456",
      name: "Mia R.",
      mergedInto: root.id,
      lastVisitAt: new Date("2023-05-01T20:00:00Z"),
    });

    await runRetention(db, NOW);

    expect(await guestRow("ret-merged-child")).toMatchObject({ phone: null, name: "", mergedInto: root.id });
  });

  it("leaves no personal value in the venue after expiry", async () => {
    await seedVenue("ret-clean");
    await book("ret-clean", "2024-01-10", "Zoe Quintana", "zoe.quintana@example.com");
    await book("ret-clean", "2024-03-02", "Zoe Quintana", "+34 611 222 333");
    const old = await addWaitlist(db, "ret-clean", { partySize: 2, guestName: "Zoe Quintana", guestContact: "zoe.quintana@example.com" });
    const recent = await addWaitlist(db, "ret-clean", { partySize: 2, guestName: "Rui", guestContact: "rui@example.com" });
    if (!old.ok || !recent.ok) throw new Error("waitlist add failed");
    await db.update(waitlist).set({ createdAt: new Date("2024-01-10T19:00:00Z") }).where(eq(waitlist.id, old.id));

    await runRetention(db, NOW);

    const dump = (await venueDump("ret-clean")).toLowerCase();
    for (const value of ["zoe", "quintana", "611 222 333", "611222333"]) expect(dump).not.toContain(value);
    expect((await db.select().from(waitlist).where(eq(waitlist.venueId, "ret-clean"))).map((w) => w.id)).toEqual([
      recent.id,
    ]);
  });
});
