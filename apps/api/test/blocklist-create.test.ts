import { and, count, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const PREVIOUS_KEY = vi.hoisted(() => {
  const value = Buffer.alloc(32, 7).toString("base64");
  process.env.BLOCKLIST_KEY_PREVIOUS = value;
  return value;
});

import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import {
  events,
  guestAudit,
  guestBlocklist,
  guests,
  idempotencyKeys,
  membershipAudit,
  reservations,
  sentEmails,
  services,
  tableAllocations,
  tables,
  tombstones,
  venues,
  waitlist,
} from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { auth } from "../src/lib/auth";
import { addToBlocklist, blocklistKeys, insertBlocklistEntry } from "../src/lib/blocklist";
import { blocklistHash, normalizeContact, type ContactKey } from "../src/lib/contact";
import { runRetention } from "../src/lib/retention";
import { createVenue } from "../src/lib/venue";

delete process.env.BLOCKLIST_KEY_PREVIOUS;

const DATE = "2030-06-01";
const BLOCKED = "ana@example.com";
const DAY_MS = 86_400_000;

interface Account {
  id: string;
  cookie: string;
}
type Who = Account | { apikey: string };

let n = 0;
async function signUp(): Promise<Account> {
  n += 1;
  const res = await auth.api.signUpEmail({
    body: { name: "Staff", email: `blc-${n}-${Math.random().toString(36).slice(2)}@example.com`, password: "password123" },
    asResponse: true,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-up refused: ${JSON.stringify(body)}`);
  return { id: body.user.id, cookie: res.headers.get("set-cookie") as string };
}

let idem = 0;
const nextKey = () => `blc-${++idem}`;

async function call(who: Who, method: string, path: string, body?: unknown, key: string | null = nextKey()) {
  const credentials = "cookie" in who ? { Cookie: who.cookie } : { apikey: who.apikey };
  const res = await app.request(path, {
    method,
    headers: { ...credentials, ...(key ? { "Idempotency-Key": key } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text };
}

interface Venue {
  id: string;
  admin: Account;
  write: { apikey: string };
}

let venueCounter = 0;
async function seedVenue(
  opts: { hours?: [string, string]; tables?: number; config?: Partial<typeof venues.$inferInsert> } = {},
): Promise<Venue> {
  const admin = await signUp();
  const id = `blc-${++venueCounter}`;
  await createVenue(db, admin.id, { id, name: id, timezone: "Europe/Madrid" });
  if (opts.config) await db.update(venues).set(opts.config).where(eq(venues.id, id));
  const [openStart, openEnd] = opts.hours ?? ["00:00", "24:00"];
  await db.insert(services).values({ venueId: id, name: "all", openStart, openEnd });
  await db
    .insert(tables)
    .values(Array.from({ length: opts.tables ?? 6 }, (_, i) => ({ id: String(i + 1), venueId: id, name: `T${i + 1}`, seats: 4 })));
  const write = { apikey: `blc-write-${id}-0123456789abcdef` };
  await addKey(db, write.apikey, `platform-${id}`, [id], "write");
  return { id, admin, write };
}

const create = (who: Who, venueId: string, body: Record<string, unknown> = {}, key?: string) =>
  call(who, "POST", `/v1/venues/${venueId}/reservations`, { date: DATE, time: "21:00", partySize: 2, ...body }, key);

const createFor = (v: Venue, contact: string | undefined, body: Record<string, unknown> = {}, key?: string) =>
  create(v.write, v.id, { guest: contact === undefined ? undefined : { name: "Ana", contact }, ...body }, key);

async function block(v: Venue, contact: string): Promise<string> {
  const res = await call(v.admin, "POST", `/v1/venues/${v.id}/blocklist`, { contact }, null);
  expect(res.status).toBe(200);
  return res.body.entries[0].id;
}

function expectDeclined(res: { status: number; body: unknown }) {
  expect(res.status).toBe(409);
  expect(res.body).toEqual({ code: "booking_declined", message: expect.any(String), retryable: false });
}

function key(raw: string): ContactKey {
  const k = normalizeContact(raw, "ES");
  if (!k) throw new Error(`${raw} does not normalize`);
  return k;
}

async function footprint(venueId: string) {
  const rows = async (table: typeof guests | typeof guestAudit | typeof idempotencyKeys | typeof events | typeof reservations | typeof tableAllocations | typeof sentEmails | typeof tombstones) =>
    (await db.select({ c: count() }).from(table).where(eq(table.venueId, venueId)))[0].c;
  return {
    reservations: await rows(reservations),
    allocations: await rows(tableAllocations),
    guests: await rows(guests),
    guestAudit: await rows(guestAudit),
    idempotencyKeys: await rows(idempotencyKeys),
    events: await rows(events),
    sentEmails: await rows(sentEmails),
    tombstones: await rows(tombstones),
  };
}

/** Runs `fn` with the blocklist table out of reach, so any statement that touches it fails. */
async function withoutBlocklistTable<T>(fn: () => Promise<T>): Promise<T> {
  await db.execute(sql`ALTER TABLE guest_blocklist RENAME TO guest_blocklist_hidden`);
  try {
    return await fn();
  } finally {
    await db.execute(sql`ALTER TABLE guest_blocklist_hidden RENAME TO guest_blocklist`);
  }
}

beforeAll(async () => {
  await migrateDb();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE idempotency_keys, invitations, account, session, verification, "user", venue_memberships, grants, api_keys, venues RESTART IDENTITY CASCADE`,
  );
});

describe("the check on create", () => {
  it("refuses a blocked contact with booking_declined and leaves nothing behind", async () => {
    const v = await seedVenue({ config: { notificationsEnabled: true, noticeAddress: "venue@example.com" } });
    await block(v, BLOCKED);
    const before = await footprint(v.id);

    expectDeclined(await createFor(v, BLOCKED));
    expectDeclined(await createFor(v, "  ANA@Example.com "));

    const ok = await createFor(v, "eva@example.com");
    expect(ok.status).toBe(200);
    for (let i = 0; i < 50 && (await footprint(v.id)).sentEmails < 2; i++) await new Promise((r) => setTimeout(r, 20));
    const after = await footprint(v.id);
    expect(after).toEqual({
      reservations: before.reservations + 1,
      allocations: before.allocations + 1,
      guests: before.guests + 1,
      guestAudit: before.guestAudit + 1,
      idempotencyKeys: before.idempotencyKeys + 1,
      events: before.events + 1,
      sentEmails: 2,
      tombstones: 0,
    });
    const emailed = await db.select().from(sentEmails).where(eq(sentEmails.venueId, v.id));
    expect(emailed.every((e) => e.reservationId === ok.body.id)).toBe(true);
    const stored = await db.select().from(guests).where(eq(guests.venueId, v.id));
    expect(stored.map((g) => g.email)).toEqual(["eva@example.com"]);
  });

  it("refuses a phone entry for any spelling of the number", async () => {
    const v = await seedVenue();
    await block(v, "+34 612 345 678");
    expectDeclined(await createFor(v, "612345678"));
    expectDeclined(await createFor(v, "+34612345678"));
    expect((await createFor(v, "612345679")).status).toBe(200);
  });

  it("refuses a staff session create, an admin's included", async () => {
    const v = await seedVenue();
    await block(v, BLOCKED);
    expectDeclined(await create(v.admin, v.id, { guest: { name: "Ana", contact: BLOCKED } }));
  });

  it("gives the ordinary code wherever the booking would fail anyway", async () => {
    const closed = await seedVenue({ hours: ["19:00", "23:00"] });
    await block(closed, BLOCKED);
    for (const contact of [BLOCKED, "eva@example.com"]) {
      expect((await createFor(closed, contact, { time: "12:00" })).body.code).toBe("outside_hours");
    }

    const dated = await seedVenue({ config: { blockedDates: [{ from: DATE, to: DATE }] } });
    await block(dated, BLOCKED);
    for (const contact of [BLOCKED, "eva@example.com"]) {
      expect((await createFor(dated, contact)).body.code).toBe("date_blocked");
    }

    const capped = await seedVenue({ config: { maxActivePerGuestPerDay: 1 } });
    expect((await createFor(capped, BLOCKED)).status).toBe(200);
    expect((await createFor(capped, "eva@example.com")).status).toBe(200);
    await block(capped, BLOCKED);
    expect((await createFor(capped, BLOCKED, { time: "22:00" })).body.code).toBe("guest_booking_limit");
    expect((await createFor(capped, "eva@example.com", { time: "22:00" })).body.code).toBe("guest_booking_limit");

    const full = await seedVenue({ tables: 1 });
    await block(full, BLOCKED);
    expect((await createFor(full, "zoe@example.com")).status).toBe(200);
    for (const contact of [BLOCKED, "eva@example.com"]) {
      expect((await createFor(full, contact)).body.code).toBe("no_suitable_table");
      expect((await createFor(full, contact, { tables: ["1"] })).body.code).toBe("slot_taken");
      expect((await createFor(full, contact, { partySize: 9, tables: ["1"] })).body.code).toBe("party_size_too_large");
    }
    expectDeclined(await createFor(full, BLOCKED, { time: "23:30" }));
  });

  it("refuses where overbooking room would take the booking", async () => {
    const v = await seedVenue({ tables: 1, config: { overbookingCeiling: 4 } });
    await block(v, BLOCKED);
    expect((await createFor(v, "zoe@example.com")).status).toBe(200);
    expectDeclined(await createFor(v, BLOCKED));
    const overbooked = await createFor(v, "eva@example.com");
    expect(overbooked.status).toBe(200);
    expect(overbooked.body.tables).toEqual([]);
  });

  it("lets a walk-in and a seat from the waitlist through, and adds to the waitlist unchecked", async () => {
    const v = await seedVenue();
    await block(v, BLOCKED);
    const walkIn = await call(v.write, "POST", `/v1/venues/${v.id}/reservations/walk-in`, {
      partySize: 2,
      guest: { name: "Ana", contact: BLOCKED },
    });
    expect(walkIn.status).toBe(200);
    expect(walkIn.body.status).toBe("seated");

    const added = await call(v.write, "POST", `/v1/venues/${v.id}/waitlist`, {
      partySize: 2,
      guest: { name: "Ana", contact: BLOCKED },
    }, null);
    expect(added.status).toBe(201);
    const [entry] = await db.select().from(waitlist).where(eq(waitlist.venueId, v.id));
    const seated = await call(v.write, "POST", `/v1/venues/${v.id}/waitlist/${entry.id}/seat`, {});
    expect(seated.status).toBe(200);
    expect(seated.body.status).toBe("seated");
  });

  it("replays a create that succeeded before the entry was added", async () => {
    const v = await seedVenue();
    const k = nextKey();
    const first = await createFor(v, BLOCKED, {}, k);
    expect(first.status).toBe(200);
    await block(v, BLOCKED);
    const replay = await createFor(v, BLOCKED, {}, k);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expectDeclined(await createFor(v, BLOCKED, { time: "22:00" }));
    const [kept] = await db.select().from(reservations).where(eq(reservations.id, first.body.id));
    expect(kept).toMatchObject({ status: "booked", version: 1 });
  });

  it("stores no key on a refusal, so the same key books once the entry is removed", async () => {
    const v = await seedVenue();
    const entryId = await block(v, BLOCKED);
    const k = nextKey();
    expectDeclined(await createFor(v, BLOCKED, {}, k));
    expect(await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, k))).toEqual([]);
    expect((await call(v.admin, "DELETE", `/v1/venues/${v.id}/blocklist/${entryId}`, undefined, null)).status).toBe(200);
    const booked = await createFor(v, BLOCKED, {}, k);
    expect(booked.status).toBe(200);
    expect((await createFor(v, BLOCKED, {}, k)).body.id).toBe(booked.body.id);
  });

  it("matches an entry made under the previous key after a rotation", async () => {
    const v = await seedVenue();
    expect(blocklistKeys.previous).not.toBeNull();
    const previous = blocklistKeys.previous;
    if (!previous) return;
    expect(Buffer.from(PREVIOUS_KEY, "base64").equals(previous.secret)).toBe(true);
    await insertBlocklistEntry(db, v.id, blocklistHash(previous, v.id, key(BLOCKED)), { reason: null, createdBy: "admin" });
    expectDeclined(await createFor(v, BLOCKED));
    expect((await createFor(v, "eva@example.com")).status).toBe(200);
  });

  it("never lets another venue's entry block, even one hashed for this venue", async () => {
    const a = await seedVenue();
    const b = await seedVenue();
    await block(b, BLOCKED);
    expect((await createFor(a, BLOCKED)).status).toBe(200);
    expectDeclined(await createFor(b, BLOCKED));
    await insertBlocklistEntry(db, b.id, blocklistHash(blocklistKeys.current, a.id, key("eva@example.com")), {
      reason: null,
      createdBy: "admin",
    });
    expect((await createFor(a, "eva@example.com")).status).toBe(200);
  });

  it("does not consult the list for a create without a usable contact", async () => {
    const v = await seedVenue();
    await block(v, BLOCKED);
    await withoutBlocklistTable(async () => {
      expect((await createFor(v, undefined)).status).toBe(200);
      expect((await createFor(v, "not a contact")).status).toBe(200);
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        expect((await createFor(v, "eva@example.com")).status).toBe(500);
      } finally {
        quiet.mockRestore();
      }
    });
  });

  it("decides each create racing an add one way, and the add always wins afterwards", async () => {
    const v = await seedVenue({ tables: 30 });
    for (let round = 0; round < 8; round++) {
      const contact = `race-${round}@example.com`;
      const k = nextKey();
      const [created, added] = await Promise.all([
        createFor(v, contact, { time: `${String(10 + round).padStart(2, "0")}:00` }, k),
        addToBlocklist(db, blocklistKeys, v.id, v.admin.id, { contact }, null),
      ]);
      expect(added.ok).toBe(true);
      expect([200, 409]).toContain(created.status);
      const held = await db
        .select({ c: count() })
        .from(reservations)
        .where(and(eq(reservations.venueId, v.id), eq(reservations.guestContact, contact)));
      if (created.status === 409) {
        expectDeclined(created);
        expect(held[0].c).toBe(0);
        expect(await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, k))).toEqual([]);
      } else {
        expect(held[0].c).toBe(1);
      }
      expectDeclined(await createFor(v, contact, { time: "23:00" }));
    }
  });
});

describe("availability and the explanation", () => {
  it("never consult the list and answer the same with an entry for every contact", async () => {
    const v = await seedVenue({ hours: ["19:00", "23:00"], tables: 1 });
    await block(v, BLOCKED);
    expect((await createFor(v, "zoe@example.com", { time: "20:00" })).status).toBe(200);
    const read = async () => {
      const answers: unknown[] = [];
      for (const partySize of [2, 4, 6]) {
        answers.push((await call(v.write, "GET", `/v1/venues/${v.id}/availability?date=${DATE}&partySize=${partySize}`, undefined, null)).body);
        for (const time of ["12:00", "19:00", "20:00", "22:00"]) {
          const res = await call(
            v.write,
            "GET",
            `/v1/venues/${v.id}/availability/explain?date=${DATE}&time=${time}&partySize=${partySize}`,
            undefined,
            null,
          );
          expect(res.status).toBe(200);
          answers.push(res.body);
        }
      }
      return answers;
    };
    const withList = await read();
    const hidden = await withoutBlocklistTable(read);
    expect(hidden).toEqual(withList);
    const free = (await call(v.write, "GET", `/v1/venues/${v.id}/availability/explain?date=${DATE}&time=22:00&partySize=2`, undefined, null)).body;
    expect(free.available).toBe(true);
    expectDeclined(await createFor(v, BLOCKED, { time: "22:00" }));
  });
});

describe("erasure", () => {
  const erase = (v: Venue, body: unknown, k = nextKey()) =>
    call({ apikey: `blc-admin-${v.id}-0123456789abcdef` }, "POST", `/v1/venues/${v.id}/erasure`, body, k);

  async function withAdminKey(v: Venue) {
    await addKey(db, `blc-admin-${v.id}-0123456789abcdef`, `agent-${v.id}`, [v.id], "admin");
  }

  it("keeps the entries and counts those matching the guests it removed", async () => {
    const v = await seedVenue();
    await withAdminKey(v);
    const byEmail = await createFor(v, BLOCKED);
    const byPhone = await createFor(v, "612345678", { time: "22:00" });
    const merged = await call(v.admin, "POST", `/v1/venues/${v.id}/guests/${byPhone.body.guest.guestId}/merge`, {
      intoGuestId: byEmail.body.guest.guestId,
    });
    expect(merged.status).toBe(200);
    await block(v, BLOCKED);
    await block(v, "612345678");
    await block(v, "eva@example.com");
    const other = await seedVenue();
    await block(other, BLOCKED);

    const k = nextKey();
    const res = await erase(v, { guestId: byEmail.body.guest.guestId }, k);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ erasedReservations: 2, erasedGuests: 2, erasedWaitlistEntries: 0, blocklistEntriesKept: 2 });
    expect(await db.select({ c: count() }).from(guestBlocklist).where(eq(guestBlocklist.venueId, v.id))).toEqual([{ c: 3 }]);
    expectDeclined(await createFor(v, BLOCKED, { time: "23:00" }));

    const replay = await erase(v, { guestId: byEmail.body.guest.guestId }, k);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ erasedReservations: 0, erasedGuests: 0, erasedWaitlistEntries: 0, blocklistEntriesKept: 0 });
  });

  it("counts the entry matching a contact it was given, and none of another venue", async () => {
    const v = await seedVenue();
    await withAdminKey(v);
    const other = await seedVenue();
    await block(other, "eva@example.com");
    expect((await erase(v, { guestId: "eva@example.com" })).body.blocklistEntriesKept).toBe(0);
    await block(v, "eva@example.com");
    expect((await erase(v, { guestId: " EVA@example.com" })).body).toEqual({
      erasedReservations: 0,
      erasedGuests: 0,
      erasedWaitlistEntries: 0,
      blocklistEntriesKept: 1,
    });
  });

  it("counts the entries of the guests an erasure by principal removes", async () => {
    const v = await seedVenue();
    await withAdminKey(v);
    expect((await createFor(v, BLOCKED)).status).toBe(200);
    await block(v, BLOCKED);
    const res = await erase(v, { principal: `platform-${v.id}` });
    expect(res.body).toMatchObject({ erasedReservations: 1, erasedGuests: 1, blocklistEntriesKept: 1 });
    expect(await db.select({ c: count() }).from(guestBlocklist).where(eq(guestBlocklist.venueId, v.id))).toEqual([{ c: 1 }]);
  });
});

describe("retention", () => {
  async function entryAged(venueId: string, contact: string, days: number) {
    const [row] = await db
      .insert(guestBlocklist)
      .values({
        id: crypto.randomUUID(),
        venueId,
        ...blocklistHash(blocklistKeys.current, venueId, key(contact)),
        createdBy: "admin",
        createdAt: new Date(Date.now() - days * DAY_MS),
      })
      .returning({ id: guestBlocklist.id });
    return row.id;
  }

  const left = async (venueId: string) =>
    (await db.select({ id: guestBlocklist.id }).from(guestBlocklist).where(eq(guestBlocklist.venueId, venueId)))
      .map((r) => r.id)
      .sort();

  it("deletes entries past the venue's retention, in batches, and writes no audit row", async () => {
    const a = await seedVenue({ config: { retentionDays: 30 } });
    const b = await seedVenue({ config: { retentionDays: 400 } });
    const expired = [];
    for (let i = 0; i < 5; i++) expired.push(await entryAged(a.id, `old-${i}@example.com`, 31 + i));
    const fresh = await entryAged(a.id, "new@example.com", 29);
    const elsewhere = await entryAged(b.id, "old-0@example.com", 100);
    const auditBefore = await db.select({ c: count() }).from(membershipAudit);

    await runRetention(db, new Date(), { size: 2, perRun: 2 });
    expect((await left(a.id)).length).toBe(2);
    expect(await left(a.id)).toContain(fresh);
    await runRetention(db, new Date(), { size: 2, perRun: 2 });
    expect(await left(a.id)).toEqual([fresh]);
    expect(await left(b.id)).toEqual([elsewhere]);
    expect(await db.select({ c: count() }).from(membershipAudit)).toEqual(auditBefore);
    expect(expired).toHaveLength(5);
  });

  it("expires each entry once under overlapping runs", async () => {
    const v = await seedVenue({ config: { retentionDays: 30 } });
    for (let i = 0; i < 12; i++) await entryAged(v.id, `old-${i}@example.com`, 40);
    const kept = await entryAged(v.id, "new@example.com", 1);
    await Promise.all([runRetention(db), runRetention(db), runRetention(db)]);
    expect(await left(v.id)).toEqual([kept]);
  });
});
