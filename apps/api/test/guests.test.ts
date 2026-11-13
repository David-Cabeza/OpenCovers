import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { guests, reservations, services, tables, venues, waitlist } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { backfillGuests } from "../src/lib/guests";
import { createReservation } from "../src/lib/reservations";
import { erase } from "../src/lib/venue";
import { addWaitlist } from "../src/lib/waitlist";

const headers = { apikey: "guests-key", "content-type": "application/json" };
let requestCounter = 0;
const venueIds: string[] = [];

async function seedVenue(venueId: string, phoneCountry: string | null = null) {
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid", phoneCountry });
  await db
    .insert(services)
    .values([{ venueId, name: "all", openStart: "00:00", openEnd: "24:00" }]);
  await db.insert(tables).values(
    Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1), venueId, name: `T${i + 1}`, seats: 4 })),
  );
  venueIds.push(venueId);
  await addKey(db, `guests-key-${venueId}`, "guests-principal", [venueId], "admin");
}

function call(venueId: string, path: string, body: unknown, method = "POST") {
  return app.request(`/v1/venues/${venueId}${path}`, {
    method,
    headers: {
      ...headers,
      apikey: `guests-key-${venueId}`,
      "Idempotency-Key": `g-${++requestCounter}`,
    },
    body: JSON.stringify(body),
  });
}

let nextTable = 0;
async function book(venueId: string, guest?: { name?: string; contact?: unknown }, time = "21:00") {
  nextTable = (nextTable % 20) + 1;
  const res = await call(venueId, "/reservations", {
    date: "2026-11-12",
    time,
    partySize: 2,
    tables: [String(nextTable)],
    guest,
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { id: string; guest: { guestId?: string; contact?: string } };
}

async function guestsOf(venueId: string) {
  return db.select().from(guests).where(eq(guests.venueId, venueId));
}

async function reservationRow(id: string) {
  return (await db.select().from(reservations).where(eq(reservations.id, id)))[0];
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, guest_audit, guests, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe("guest linking on booking", () => {
  it("links two reservations with the same contact to one guest", async () => {
    await seedVenue("g-same");
    const first = await book("g-same", { name: "Eva", contact: "eva@example.com" });
    const second = await book("g-same", { name: "Eva G.", contact: "eva@example.com" }, "22:00");

    expect(first.guest.guestId).toBeDefined();
    expect(second.guest.guestId).toBe(first.guest.guestId);
    const rows = await guestsOf("g-same");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "eva@example.com", phone: null, name: "Eva", mergedInto: null });
  });

  it("links an email that differs only in case or whitespace", async () => {
    await seedVenue("g-case");
    const first = await book("g-case", { name: "Ona", contact: "ona@example.com" });
    const second = await book("g-case", { name: "Ona", contact: "  ONA@Example.com " });

    expect(second.guest.guestId).toBe(first.guest.guestId);
    expect(second.guest.contact).toBe("  ONA@Example.com ");
    expect(await guestsOf("g-case")).toHaveLength(1);
  });

  it("keeps dots and plus tags apart", async () => {
    await seedVenue("g-tags");
    const plain = await book("g-tags", { contact: "ona@example.com" });
    const tagged = await book("g-tags", { contact: "ona+mesa@example.com" });
    const dotted = await book("g-tags", { contact: "o.na@example.com" });

    expect(new Set([plain.guest.guestId, tagged.guest.guestId, dotted.guest.guestId]).size).toBe(3);
  });

  it("links a local phone and its international form under the venue country", async () => {
    await seedVenue("g-phone");
    const local = await book("g-phone", { name: "Pau", contact: "600 123 456" });
    const intl = await book("g-phone", { name: "Pau", contact: "+34 600-12-34-56" });

    expect(intl.guest.guestId).toBe(local.guest.guestId);
    expect((await guestsOf("g-phone"))[0]).toMatchObject({ phone: "+34600123456", email: null });
  });

  it("reads a local phone with the configured phone country", async () => {
    await seedVenue("g-france");
    const set = await call("g-france", "/config", { phoneCountry: "FR" }, "PUT");
    expect(set.status).toBe(200);
    expect((await set.json()).phoneCountry).toBe("FR");

    await book("g-france", { contact: "06 12 34 56 78" });

    expect((await guestsOf("g-france"))[0].phone).toBe("+33612345678");
  });

  it("never shares a guest between venues", async () => {
    await seedVenue("g-iso-a");
    await seedVenue("g-iso-b");
    const a = await book("g-iso-a", { name: "Lia", contact: "lia@example.com" });
    const b = await book("g-iso-b", { name: "Lia", contact: "lia@example.com" });

    expect(a.guest.guestId).toBeDefined();
    expect(b.guest.guestId).toBeDefined();
    expect(a.guest.guestId).not.toBe(b.guest.guestId);
    expect(await guestsOf("g-iso-a")).toHaveLength(1);
    expect(await guestsOf("g-iso-b")).toHaveLength(1);
  });

  it("creates no guest without a contact", async () => {
    await seedVenue("g-none");
    const noGuest = await book("g-none");
    const nameOnly = await book("g-none", { name: "Rui" });
    const walkIn = await call("g-none", "/reservations/walk-in", { partySize: 2, time: "21:30", guest: { name: "Rui" } });

    expect(noGuest.guest.guestId).toBeUndefined();
    expect(nameOnly.guest.guestId).toBeUndefined();
    expect(walkIn.status).toBe(200);
    expect((await walkIn.json()).guest.guestId).toBeUndefined();
    expect(await guestsOf("g-none")).toEqual([]);
  });

  it("books a contact that does not normalize and links no guest", async () => {
    await seedVenue("g-bad");
    const words = await book("g-bad", { name: "Sol", contact: "call the hotel" });
    const short = await book("g-bad", { name: "Sol", contact: "1234" });
    const email = await book("g-bad", { name: "Sol", contact: "sol@" });

    for (const r of [words, short, email]) expect(r.guest.guestId).toBeUndefined();
    expect(words.guest.contact).toBe("call the hotel");
    expect(await guestsOf("g-bad")).toEqual([]);
  });

  it("reads a contact sent as a number as the stored text", async () => {
    await seedVenue("g-number");
    const number = await book("g-number", { contact: 600123456 });
    const text = await book("g-number", { contact: "600 123 456" });

    expect(number.guest.guestId).toBeDefined();
    expect(text.guest.guestId).toBe(number.guest.guestId);
  });

  it("does not match by name", async () => {
    await seedVenue("g-name");
    const a = await book("g-name", { name: "Teo", contact: "teo@example.com" });
    const b = await book("g-name", { name: "Teo", contact: "teo@example.org" });

    expect(a.guest.guestId).not.toBe(b.guest.guestId);
  });

  it("links walk-ins and seated waitlist entries", async () => {
    await seedVenue("g-walk");
    const booked = await book("g-walk", { name: "Uma", contact: "uma@example.com" });
    const walkIn = await call("g-walk", "/reservations/walk-in", {
      partySize: 2,
      time: "20:10",
      guest: { name: "Uma", contact: "UMA@example.com" },
    });
    const joined = await addWaitlist(db, "g-walk", { partySize: 2, guestName: "Uma", guestContact: "uma@example.com" });
    if (!joined.ok) throw new Error("waitlist add failed");
    const seated = await call("g-walk", `/waitlist/${joined.id}/seat`, {});

    expect(walkIn.status).toBe(200);
    expect((await walkIn.json()).guest.guestId).toBe(booked.guest.guestId);
    expect(seated.status).toBe(200);
    expect((await seated.json()).guest.guestId).toBe(booked.guest.guestId);
    expect(await guestsOf("g-walk")).toHaveLength(1);
  });

  it("keeps the latest visit time and the first name", async () => {
    await seedVenue("g-visit");
    await book("g-visit", { name: "Vera", contact: "vera@example.com" }, "22:00");
    await book("g-visit", { name: "V. Ruiz", contact: "vera@example.com" }, "20:00");

    const [guest] = await guestsOf("g-visit");
    expect(guest.name).toBe("Vera");
    expect(guest.lastVisitAt.toISOString()).toBe("2026-11-12T21:00:00.000Z");
  });

  it("keeps consent and rating on the reservation", async () => {
    await seedVenue("g-consent");
    const a = await book("g-consent", { contact: "zoe@example.com" });
    const res = await call("g-consent", "/reservations", {
      date: "2026-11-12",
      time: "21:00",
      partySize: 2,
      tables: ["20"],
      guest: { contact: "zoe@example.com", consent: "granted" },
      rating: 5,
    });
    const b = await res.json();

    expect(b.guest.guestId).toBe(a.guest.guestId);
    expect(b.guest.consent).toBe("granted");
    expect(b.rating).toBe(5);
    expect((await db.select().from(reservations).where(eq(reservations.id, a.id)))[0].consent).toBe("unknown");
  });

  it("creates exactly one guest for concurrent bookings of a new contact", async () => {
    await seedVenue("g-race");
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        createReservation(
          db,
          "g-race",
          {
            date: "2026-11-12",
            time: "21:00",
            durationMinutes: 120,
            partySize: 2,
            tableIds: [String(i + 1)],
            guestName: "Ian",
            guestContact: i % 2 === 0 ? "ian@example.com" : " IAN@example.com",
          },
          `race-${i}`,
        ),
      ),
    );

    expect(results.every((r) => r.ok)).toBe(true);
    const rows = await guestsOf("g-race");
    expect(rows).toHaveLength(1);
    const linked = await db
      .select({ guestId: reservations.guestId })
      .from(reservations)
      .where(eq(reservations.venueId, "g-race"));
    expect(linked.map((r) => r.guestId)).toEqual(Array(8).fill(rows[0].id));
  });

  it("rejects an unknown phone country", async () => {
    await seedVenue("g-country");
    const bad = await call("g-country", "/config", { phoneCountry: "XX" }, "PUT");
    const lower = await call("g-country", "/config", { phoneCountry: "es" }, "PUT");
    const cleared = await call("g-country", "/config", { phoneCountry: null }, "PUT");

    expect(bad.status).toBe(400);
    expect(lower.status).toBe(400);
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).phoneCountry).toBeNull();
  });
});

describe("guest backfill", () => {
  async function insertLegacy(
    venueId: string,
    id: string,
    guestName: string,
    guestContact: string,
    startsAt: string,
    erased = false,
  ) {
    await db.insert(reservations).values({
      id,
      venueId,
      date: startsAt.slice(0, 10),
      startsAt: new Date(startsAt),
      endsAt: new Date(new Date(startsAt).getTime() + 7200000),
      partySize: 2,
      status: "attended",
      guestName,
      guestContact,
      erased,
    });
  }

  it("groups legacy reservations by normalized key and is idempotent", async () => {
    await seedVenue("g-back");
    await seedVenue("g-back-other");
    await insertLegacy("g-back", "old-1", "Ana", "ana@example.com", "2026-01-10T20:00:00Z");
    await insertLegacy("g-back", "old-2", "Ana Ruiz", " ANA@example.com", "2026-03-10T20:00:00Z");
    await insertLegacy("g-back", "old-3", "Bea", "600 123 456", "2026-02-10T20:00:00Z");
    await insertLegacy("g-back", "old-4", "Bea", "+34600123456", "2026-02-11T20:00:00Z");
    await insertLegacy("g-back", "old-5", "Cai", "call me", "2026-02-12T20:00:00Z");
    await insertLegacy("g-back", "old-6", "", "", "2026-02-13T20:00:00Z");
    await insertLegacy("g-back", "old-7", "", "gone@example.com", "2026-02-14T20:00:00Z", true);
    await insertLegacy("g-back-other", "old-8", "Ana", "ana@example.com", "2026-01-10T20:00:00Z");

    const first = await backfillGuests(db);
    const afterFirst = await guestsOf("g-back");
    const second = await backfillGuests(db);

    expect(first).toEqual({ createdGuests: 3, linkedReservations: 5 });
    expect(second).toEqual({ createdGuests: 0, linkedReservations: 0 });
    expect(await guestsOf("g-back")).toEqual(afterFirst);
    expect(afterFirst.map((g) => [g.email ?? g.phone, g.name]).sort()).toEqual([
      ["+34600123456", "Bea"],
      ["ana@example.com", "Ana Ruiz"],
    ]);
    const ana = afterFirst.find((g) => g.email === "ana@example.com");
    expect(ana?.lastVisitAt.toISOString()).toBe("2026-03-10T20:00:00.000Z");
    expect((await reservationRow("old-1")).guestId).toBe(ana?.id);
    expect((await reservationRow("old-2")).guestId).toBe(ana?.id);
    expect((await reservationRow("old-3")).guestId).toBe((await reservationRow("old-4")).guestId);
    for (const id of ["old-5", "old-6", "old-7"]) expect((await reservationRow(id)).guestId).toBeNull();
    const other = await guestsOf("g-back-other");
    expect(other).toHaveLength(1);
    expect(other[0].id).not.toBe(ana?.id);
  });

  it("joins a legacy reservation to a guest the booking path already created", async () => {
    await seedVenue("g-back-join");
    const live = await book("g-back-join", { name: "Dan", contact: "dan@example.com" });
    await insertLegacy("g-back-join", "old-9", "Dan", "DAN@example.com", "2026-01-10T20:00:00Z");

    await backfillGuests(db);

    expect(await guestsOf("g-back-join")).toHaveLength(1);
    expect((await reservationRow("old-9")).guestId).toBe(live.guest.guestId);
  });
});

describe("guest erasure", () => {
  it("erases by guest id: blanks linked visits, deletes the guest and those merged into it", async () => {
    await seedVenue("g-erase");
    const a = await book("g-erase", { name: "Eli", contact: "eli@example.com" });
    const b = await book("g-erase", { name: "Eli", contact: "ELI@example.com" }, "22:00");
    const other = await book("g-erase", { name: "Fay", contact: "fay@example.com" });
    const guestId = a.guest.guestId as string;
    await db.insert(guests).values({
      id: "merged-guest",
      venueId: "g-erase",
      phone: "+34611111111",
      name: "Eli old",
      mergedInto: guestId,
      lastVisitAt: new Date("2026-01-01T20:00:00Z"),
    });
    await addWaitlist(db, "g-erase", { partySize: 2, guestName: "Eli", guestContact: " Eli@Example.com" });
    await addWaitlist(db, "g-erase", { partySize: 2, guestName: "Eli", guestContact: "611 111 111" });
    await addWaitlist(db, "g-erase", { partySize: 2, guestName: "Fay", guestContact: "fay@example.com" });

    const res = await call("g-erase", "/erasure", { guestId });

    expect(await res.json()).toEqual({ erasedReservations: 2, erasedGuests: 2, erasedWaitlistEntries: 2 });
    for (const id of [a.id, b.id]) {
      const row = await reservationRow(id);
      expect(row).toMatchObject({
        guestName: "",
        guestContact: "",
        guestId: null,
        erased: true,
        partySize: 2,
        status: "booked",
        date: "2026-11-12",
      });
    }
    expect((await guestsOf("g-erase")).map((g) => g.email)).toEqual(["fay@example.com"]);
    expect((await reservationRow(other.id)).guestId).toBe(other.guest.guestId);
    const left = await db.select().from(waitlist).where(eq(waitlist.venueId, "g-erase"));
    expect(left.map((w) => w.guestContact)).toEqual(["fay@example.com"]);
    const erased = await db.execute(
      sql`select count(*)::int as n from events where venue_id = 'g-erase' and type = 'erased'`,
    );
    expect(erased.rows[0].n).toBe(2);

    const again = await call("g-erase", "/erasure", { guestId });
    expect(await again.json()).toEqual({ erasedReservations: 0, erasedGuests: 0, erasedWaitlistEntries: 0 });
  });

  it("falls back to a normalized contact when the guest id is unknown", async () => {
    await seedVenue("g-erase-contact");
    const linked = await book("g-erase-contact", { name: "Gil", contact: "+34 622 222 222" });
    const unlinked = await book("g-erase-contact", { name: "Gil", contact: "ask at the bar" });

    const byPhone = await erase(db, "g-erase-contact", "622222222");
    const byRaw = await erase(db, "g-erase-contact", "ask at the bar");

    expect(byPhone).toEqual({ erasedReservations: 1, erasedGuests: 1, erasedWaitlistEntries: 0 });
    expect(byRaw).toEqual({ erasedReservations: 1, erasedGuests: 0, erasedWaitlistEntries: 0 });
    expect((await reservationRow(linked.id)).erased).toBe(true);
    expect((await reservationRow(unlinked.id)).erased).toBe(true);
    expect(await guestsOf("g-erase-contact")).toEqual([]);
  });

  it("never touches another venue's guest", async () => {
    await seedVenue("g-erase-a");
    await seedVenue("g-erase-b");
    const a = await book("g-erase-a", { name: "Hoa", contact: "hoa@example.com" });
    const b = await book("g-erase-b", { name: "Hoa", contact: "hoa@example.com" });

    const crossId = await erase(db, "g-erase-b", a.guest.guestId as string);
    expect(crossId).toEqual({ erasedReservations: 0, erasedGuests: 0, erasedWaitlistEntries: 0 });
    expect(await guestsOf("g-erase-a")).toHaveLength(1);

    const byContact = await erase(db, "g-erase-b", "hoa@example.com");
    expect(byContact).toEqual({ erasedReservations: 1, erasedGuests: 1, erasedWaitlistEntries: 0 });
    expect((await reservationRow(b.id)).erased).toBe(true);
    expect((await reservationRow(a.id)).erased).toBe(false);
    expect((await guestsOf("g-erase-a")).map((g) => g.id)).toEqual([a.guest.guestId]);
  });

  it("records who created and erased a guest, with no personal value", async () => {
    await seedVenue("g-audit");
    const a = await book("g-audit", { name: "Ivo", contact: "ivo@example.com" });
    await call("g-audit", "/erasure", { guestId: a.guest.guestId });

    const audit = await db.execute(
      sql`select * from guest_audit where venue_id = 'g-audit' order by id`,
    );
    expect(audit.rows.map((r) => [r.guest_id, r.action, r.principal])).toEqual([
      [a.guest.guestId, "created", "guests-principal"],
      [a.guest.guestId, "erased", "guests-principal"],
    ]);
    expect(JSON.stringify(audit.rows)).not.toContain("ivo");
  });

  it("erasure by principal deletes the guest row when every visit was that principal's", async () => {
    await seedVenue("g-erase-principal");
    const a = await book("g-erase-principal", { name: "Jon", contact: "jon@example.com" });
    const guestId = a.guest.guestId as string;
    await db.insert(guests).values({
      id: "jon-merged",
      venueId: "g-erase-principal",
      phone: "+34611000111",
      name: "Jon old",
      mergedInto: guestId,
      lastVisitAt: new Date("2026-01-01T20:00:00Z"),
    });

    const res = await erase(db, "g-erase-principal", undefined, "guests-principal", "guests-principal");

    expect(res).toEqual({ erasedReservations: 1, erasedGuests: 2, erasedWaitlistEntries: 0 });
    expect(await reservationRow(a.id)).toMatchObject({ erased: true, guestId: null, guestName: "" });
    expect(await guestsOf("g-erase-principal")).toEqual([]);
    const audit = await db.execute(
      sql`select guest_id, action, principal from guest_audit where venue_id = 'g-erase-principal' and action = 'erased' order by guest_id`,
    );
    expect(audit.rows.map((r) => [r.guest_id, r.principal])).toEqual([
      [guestId, "guests-principal"],
      ["jon-merged", "guests-principal"],
    ]);
    expect(JSON.stringify(audit.rows)).not.toContain("jon@");

    const again = await erase(db, "g-erase-principal", undefined, "guests-principal", "guests-principal");
    expect(again).toEqual({ erasedReservations: 0, erasedGuests: 0, erasedWaitlistEntries: 0 });
  });

  it("erasure by principal keeps a guest who has a visit owned by another principal", async () => {
    await seedVenue("g-erase-shared");
    await addKey(db, "guests-key-other", "other-principal", ["g-erase-shared"], "admin");
    const mine = await book("g-erase-shared", { name: "Kai", contact: "kai@example.com" });
    const theirsRes = await app.request("/v1/venues/g-erase-shared/reservations", {
      method: "POST",
      headers: { ...headers, apikey: "guests-key-other", "Idempotency-Key": `g-${++requestCounter}` },
      body: JSON.stringify({
        date: "2026-11-12",
        time: "22:00",
        partySize: 2,
        tables: ["20"],
        guest: { name: "Kai", contact: "kai@example.com" },
      }),
    });
    expect(theirsRes.status).toBe(200);
    const theirs = (await theirsRes.json()) as { id: string; guest: { guestId?: string } };
    expect(theirs.guest.guestId).toBe(mine.guest.guestId);

    const res = await erase(db, "g-erase-shared", undefined, "guests-principal", "guests-principal");

    expect(res).toEqual({ erasedReservations: 1, erasedGuests: 0, erasedWaitlistEntries: 0 });
    expect(await reservationRow(mine.id)).toMatchObject({ erased: true, guestId: null });
    expect(await reservationRow(theirs.id)).toMatchObject({ erased: false, guestId: mine.guest.guestId });
    expect((await guestsOf("g-erase-shared")).map((g) => g.email)).toEqual(["kai@example.com"]);
  });

  it("erasure by principal never touches another venue's guest with the same contact", async () => {
    await seedVenue("g-erase-pa");
    await seedVenue("g-erase-pb");
    await book("g-erase-pa", { name: "Lou", contact: "lou@example.com" });
    const other = await book("g-erase-pb", { name: "Lou", contact: "lou@example.com" });

    const res = await erase(db, "g-erase-pa", undefined, "guests-principal", "guests-principal");

    expect(res.erasedGuests).toBe(1);
    expect(await guestsOf("g-erase-pa")).toEqual([]);
    expect((await guestsOf("g-erase-pb")).map((g) => g.email)).toEqual(["lou@example.com"]);
    expect((await reservationRow(other.id)).erased).toBe(false);
  });
});
