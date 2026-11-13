import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { guests, services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";

let requestCounter = 0;
let nextTable = 0;

async function seedVenue(venueId: string) {
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid" });
  await db.insert(services).values([{ venueId, name: "all", openStart: "00:00", openEnd: "24:00" }]);
  await db
    .insert(tables)
    .values(Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1), venueId, name: `T${i + 1}`, seats: 4 })));
  await addKey(db, `read-${venueId}`, "reader", [venueId], "read");
  await addKey(db, `write-${venueId}`, "writer", [venueId], "write");
}

function request(venueId: string, path: string, init: { key?: string; method?: string; body?: unknown } = {}) {
  return app.request(`/v1/venues/${venueId}${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: init.key ?? `read-${venueId}`,
      "content-type": "application/json",
      "Idempotency-Key": `read-${++requestCounter}`,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function book(venueId: string, date: string, name: string, contact: string, time = "21:00") {
  nextTable = (nextTable % 20) + 1;
  const res = await request(venueId, "/reservations", {
    key: `write-${venueId}`,
    method: "POST",
    body: { date, time, partySize: 2, tables: [String(nextTable)], guest: { name, contact } },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { id: string; status: string; guest: { guestId: string } };
}

async function listAll(venueId: string, query = "") {
  const res = await request(venueId, `/guests${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as { guests: { id: string; name: string; email: string | null; phone: string | null; lastVisitAt: string }[]; nextCursor: string | null };
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, guest_audit, guests, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe("guest list and read", () => {
  it("lists guests by latest visit and reads one with its visits", async () => {
    const venueId = "gr-basic";
    await seedVenue(venueId);
    const first = await book(venueId, "2026-10-01", "Eva", "eva@example.com");
    const second = await book(venueId, "2026-11-01", "Eva", " EVA@example.com ");
    await book(venueId, "2026-10-15", "Jon", "+34 600 123 456");

    const page = await listAll(venueId);
    expect(page.nextCursor).toBeNull();
    expect(page.guests.map((g) => g.name)).toEqual(["Eva", "Jon"]);
    expect(page.guests[0]).toMatchObject({ email: "eva@example.com", phone: null });
    expect(page.guests[1]).toMatchObject({ email: null, phone: "+34600123456" });

    const res = await request(venueId, `/guests/${first.guest.guestId}`);
    expect(res.status).toBe(200);
    const guest = await res.json();
    expect(guest).toMatchObject({
      id: first.guest.guestId,
      name: "Eva",
      email: "eva@example.com",
      visitCount: 2,
      reservations: [
        { id: first.id, status: "booked" },
        { id: second.id, status: "booked" },
      ],
      mergedGuests: [],
    });
    expect(new Date(guest.firstVisitAt) < new Date(guest.lastVisitAt)).toBe(true);
  });

  it("filters by normalized contact and by name prefix", async () => {
    const venueId = "gr-filter";
    await seedVenue(venueId);
    await book(venueId, "2026-10-01", "Ana Ruiz", "ana@example.com");
    await book(venueId, "2026-10-02", "Andrés", "+34 611 222 333");
    await book(venueId, "2026-10-03", "Bea", "bea@example.com");

    const byEmail = await listAll(venueId, `?contact=${encodeURIComponent("  ANA@example.com")}`);
    expect(byEmail.guests.map((g) => g.name)).toEqual(["Ana Ruiz"]);
    const byPhone = await listAll(venueId, `?contact=${encodeURIComponent("611222333")}`);
    expect(byPhone.guests.map((g) => g.name)).toEqual(["Andrés"]);
    const byName = await listAll(venueId, "?name=an");
    expect(byName.guests.map((g) => g.name)).toEqual(["Andrés", "Ana Ruiz"]);
    expect((await listAll(venueId, "?name=%25")).guests).toEqual([]);
    expect((await listAll(venueId, "?contact=nonsense")).guests).toEqual([]);
  });

  it("pages through every guest once, ties included", async () => {
    const venueId = "gr-pages";
    await seedVenue(venueId);
    for (let i = 0; i < 9; i++) {
      await book(venueId, i < 4 ? "2026-10-10" : `2026-10-${11 + i}`, `Guest ${i}`, `guest${i}@example.com`);
    }
    const whole = (await listAll(venueId, "?limit=200")).guests.map((g) => g.id);
    expect(whole).toHaveLength(9);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = cursor ? `?limit=2&cursor=${encodeURIComponent(cursor)}` : "?limit=2";
      const page = await listAll(venueId, query);
      seen.push(...page.guests.map((g) => g.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(5);
    expect(seen).toEqual(whole);
  });

  it("rejects a bad limit and a cursor from another venue", async () => {
    const venueId = "gr-cursor";
    await seedVenue(venueId);
    await seedVenue("gr-cursor-other");
    for (let i = 0; i < 3; i++) await book(venueId, `2026-10-0${i + 1}`, `G${i}`, `g${i}@example.com`);
    const { nextCursor } = await listAll(venueId, "?limit=1");
    expect(nextCursor).not.toBeNull();
    const foreign = await request("gr-cursor-other", `/guests?cursor=${encodeURIComponent(nextCursor as string)}`);
    expect(foreign.status).toBe(400);
    expect((await foreign.json()).code).toBe("invalid_request");
    expect((await request(venueId, "/guests?limit=0")).status).toBe(400);
    expect((await request(venueId, "/guests?limit=abc")).status).toBe(400);
    expect((await request(venueId, `/guests?cursor=${venueId}:x:y`)).status).toBe(400);
  });

  it("never shows another venue's guest or contact", async () => {
    await seedVenue("gr-iso-a");
    await seedVenue("gr-iso-b");
    const a = await book("gr-iso-a", "2026-10-01", "Lia", "lia@example.com");
    await book("gr-iso-b", "2026-10-01", "Max", "max@example.com");

    const foreign = await request("gr-iso-b", `/guests/${a.guest.guestId}`);
    expect(foreign.status).toBe(404);
    expect((await foreign.json()).code).toBe("guest_not_found");
    expect((await listAll("gr-iso-b", "?contact=lia@example.com")).guests).toEqual([]);
    expect((await listAll("gr-iso-b")).guests.map((g) => g.email)).toEqual(["max@example.com"]);
    expect((await request("gr-iso-a", "/guests", { key: "read-gr-iso-b" })).status).toBe(404);
  });

  it("hides merged-away and cleared guests", async () => {
    const venueId = "gr-hidden";
    await seedVenue(venueId);
    const kept = await book(venueId, "2026-10-01", "Kept", "kept@example.com");
    const absorbed = await book(venueId, "2026-10-02", "Absorbed", "absorbed@example.com");
    const cleared = await book(venueId, "2026-10-03", "Cleared", "cleared@example.com");
    await db.update(guests).set({ mergedInto: kept.guest.guestId }).where(eq(guests.id, absorbed.guest.guestId));
    await db.update(guests).set({ email: null, phone: null, name: "" }).where(eq(guests.id, cleared.guest.guestId));

    expect((await listAll(venueId)).guests.map((g) => g.id)).toEqual([kept.guest.guestId]);
    expect((await request(venueId, `/guests/${absorbed.guest.guestId}`)).status).toBe(404);
    expect((await request(venueId, `/guests/${cleared.guest.guestId}`)).status).toBe(404);
  });
});
