import { asc, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { guestBlocklist, membershipAudit, services, tables } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { auth } from "../src/lib/auth";
import { BLOCKLIST_MAX_ENTRIES, blocklistKeys } from "../src/lib/blocklist";
import { blocklistHash, normalizeContact } from "../src/lib/contact";
import { addMembership } from "../src/lib/memberships";
import { createVenue } from "../src/lib/venue";

const A = "bl-a";
const B = "bl-b";
const DAY_MS = 86_400_000;

interface Account {
  id: string;
  cookie: string;
}
type Who = Account | { apikey: string } | null;

let n = 0;
async function signUp(): Promise<Account> {
  n += 1;
  const res = await auth.api.signUpEmail({
    body: { name: "Staff", email: `bl-staff-${n}-${Math.random().toString(36).slice(2)}@example.com`, password: "password123" },
    asResponse: true,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-up refused: ${JSON.stringify(body)}`);
  return { id: body.user.id, cookie: res.headers.get("set-cookie") as string };
}

const responses: string[] = [];

async function call(who: Who, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const credentials = who === null ? {} : "cookie" in who ? { Cookie: who.cookie } : { apikey: who.apikey };
  const res = await app.request(path, {
    method,
    headers: { ...credentials, ...headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  responses.push(text);
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const add = (who: Who, venueId: string, body: unknown) => call(who, "POST", `/v1/venues/${venueId}/blocklist`, body);
const list = (who: Who, venueId: string, query = "") => call(who, "GET", `/v1/venues/${venueId}/blocklist${query}`);
const lookup = (who: Who, venueId: string, body: unknown) =>
  call(who, "POST", `/v1/venues/${venueId}/blocklist/lookup`, body);
const remove = (who: Who, venueId: string, id: string) => call(who, "DELETE", `/v1/venues/${venueId}/blocklist/${id}`);

let admin: Account;
let adminB: Account;
const writeKey = { apikey: "bl-write-key-0123456789abcdef" };
const adminKey = { apikey: "bl-admin-key-0123456789abcdef" };
let idem = 0;

async function seedVenue(venueId: string, owner: Account) {
  await createVenue(db, owner.id, { id: venueId, name: venueId, timezone: "Europe/Madrid" });
  await db.insert(services).values({ venueId, name: "all", openStart: "00:00", openEnd: "24:00" });
  await db
    .insert(tables)
    .values(Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), venueId, name: `T${i + 1}`, seats: 4 })));
}

async function book(venueId: string, date: string, contact: string): Promise<{ id: string; guestId: string }> {
  const res = await call(
    writeKey,
    "POST",
    `/v1/venues/${venueId}/reservations`,
    { date, time: "21:00", partySize: 2, guest: { name: "Ana", contact } },
    { "Idempotency-Key": `bl-${++idem}` },
  );
  expect(res.status).toBe(200);
  return { id: res.body.id, guestId: res.body.guest.guestId };
}

const stored = (venueId: string) =>
  db.select().from(guestBlocklist).where(eq(guestBlocklist.venueId, venueId)).orderBy(asc(guestBlocklist.createdAt));

const auditRows = (venueId: string) =>
  db.select().from(membershipAudit).where(eq(membershipAudit.venueId, venueId)).orderBy(asc(membershipAudit.id));

function hashOf(venueId: string, raw: string): string {
  const key = normalizeContact(raw, "ES");
  if (!key) throw new Error(`${raw} does not normalize`);
  return blocklistHash(blocklistKeys.current, venueId, key).hash;
}

async function fill(venueId: string, rows: number) {
  await db.execute(sql`
    INSERT INTO guest_blocklist (id, venue_id, kind, key_id, hash, created_by)
    SELECT gen_random_uuid()::text, ${venueId}, 'email', '00000000000000ff', encode(sha256(convert_to('fill-' || i, 'UTF8')), 'hex'), 'filler'
    FROM generate_series(1, ${rows}) AS i`);
}

beforeAll(async () => {
  await migrateDb();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE idempotency_keys, invitations, account, session, verification, "user", venue_memberships, grants, api_keys, venues RESTART IDENTITY CASCADE`,
  );
  responses.length = 0;
  admin = await signUp();
  adminB = await signUp();
  await seedVenue(A, admin);
  await seedVenue(B, adminB);
  await addKey(db, writeKey.apikey, "platform", [A, B], "write");
  await addKey(db, adminKey.apikey, "agent", [A, B], "admin");
});

describe("who may use the blocklist", () => {
  it("lets an admin session add, list, look up and remove", async () => {
    const added = await add(admin, A, { contact: "ana@example.com" });
    expect(added.status).toBe(200);
    const id = added.body.entries[0].id;
    expect((await list(admin, A)).body.entries.map((e: { id: string }) => e.id)).toEqual([id]);
    expect((await lookup(admin, A, { contact: "ana@example.com" })).body.entries[0].id).toBe(id);
    expect((await remove(admin, A, id)).status).toBe(200);
  });

  it("refuses write and read sessions and keys of every role, admin included, and changes nothing", async () => {
    const id = (await add(admin, A, { contact: "ana@example.com" })).body.entries[0].id;
    const before = { entries: await stored(A), audit: await auditRows(A) };
    const writer = await signUp();
    const reader = await signUp();
    await addMembership(db, writer.id, A, "write");
    await addMembership(db, reader.id, A, "read");
    const readKey = { apikey: "bl-read-key-0123456789abcdef" };
    await addKey(db, readKey.apikey, "reader", [A], "read");

    for (const who of [writer, reader, writeKey, readKey, adminKey]) {
      for (const res of [
        await add(who, A, { contact: "eva@example.com" }),
        await list(who, A),
        await lookup(who, A, { contact: "ana@example.com" }),
        await remove(who, A, id),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("forbidden");
      }
    }
    expect(await stored(A)).toEqual(before.entries);
    expect(await auditRows(A)).toEqual(before.audit);
  });

  it("answers unauthorized without credentials and venue_not_found outside the venue", async () => {
    expect((await list(null, A)).status).toBe(401);
    const outside = await add(adminB, A, { contact: "ana@example.com" });
    expect(outside.status).toBe(404);
    expect(outside.body.code).toBe("venue_not_found");
    expect(await stored(A)).toEqual([]);
  });
});

describe("adding", () => {
  it("adds a typed contact as its keyed hash and returns the entry without it", async () => {
    const res = await add(admin, A, { contact: "  Ana@Example.COM ", reason: "no_show" });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["entries"]);
    const [entry] = res.body.entries;
    expect(entry).toEqual({
      id: expect.any(String),
      kind: "email",
      reason: "no_show",
      createdBy: admin.id,
      createdAt: expect.any(String),
      expiresAt: new Date(Date.parse(entry.createdAt) + 400 * DAY_MS).toISOString(),
      active: true,
      created: true,
    });
    const [row] = await stored(A);
    expect(row).toMatchObject({ id: entry.id, hash: hashOf(A, "ana@example.com"), keyId: blocklistKeys.current.id });
  });

  it("refuses a contact that does not normalize, a bad reason, and a body naming both or neither", async () => {
    for (const body of [
      { contact: "not a contact" },
      { contact: "" },
      { contact: "ana@example.com", reason: "threw a glass" },
      { contact: "ana@example.com", reason: 3 },
      { contact: "ana@example.com", guestId: "g1" },
      {},
      { guestId: "" },
      { contact: 600123456 },
    ]) {
      const res = await add(admin, A, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.code).toBe("invalid_request");
    }
    expect(await stored(A)).toEqual([]);
    expect(await auditRows(A)).toHaveLength(0);
  });

  it("adds every contact of a guest and of the guests merged into it, and counts its booked bookings", async () => {
    const ana = await book(A, "2027-03-10", "ana@example.com");
    await book(A, "2027-03-11", "ana@example.com");
    const cancelled = await book(A, "2027-03-12", "ana@example.com");
    const phone = await book(A, "2027-03-13", "+34 600 123 456");
    await call(writeKey, "POST", `/v1/venues/${A}/reservations/${cancelled.id}/cancel`, {}, { "Idempotency-Key": "bl-cancel" });
    const merged = await call(
      adminKey,
      "POST",
      `/v1/venues/${A}/guests/${phone.guestId}/merge`,
      { intoGuestId: ana.guestId },
      { "Idempotency-Key": "bl-merge" },
    );
    expect(merged.status).toBe(200);

    const res = await add(admin, A, { guestId: ana.guestId, reason: "conduct" });
    expect(res.status).toBe(200);
    expect(res.body.bookedReservations).toBe(3);
    expect(res.body.entries.map((e: { kind: string; created: boolean }) => [e.kind, e.created]).sort()).toEqual([
      ["email", true],
      ["phone", true],
    ]);
    expect((await stored(A)).map((r) => r.hash).sort()).toEqual(
      [hashOf(A, "ana@example.com"), hashOf(A, "600123456")].sort(),
    );
    expect((await lookup(admin, A, { contact: "600 12 34 56" })).body.entries).toHaveLength(1);

    const again = await add(admin, A, { guestId: ana.guestId });
    expect(again.body.entries.map((e: { created: boolean }) => e.created)).toEqual([false, false]);
    expect(again.body.bookedReservations).toBe(3);
  });

  it("fails with guest_not_found for a merged-away guest, another venue's guest, a cleared guest, and an unknown id", async () => {
    const ana = await book(A, "2027-03-10", "ana@example.com");
    const eva = await book(A, "2027-03-10", "eva@example.com");
    const cleared = await book(A, "2027-03-10", "cleared@example.com");
    const other = await book(B, "2027-03-10", "bo@example.com");
    await call(adminKey, "POST", `/v1/venues/${A}/guests/${eva.guestId}/merge`, { intoGuestId: ana.guestId }, {
      "Idempotency-Key": "bl-merge-2",
    });
    await db.execute(sql`UPDATE guests SET email = NULL, phone = NULL, name = '' WHERE id = ${cleared.guestId}`);
    for (const guestId of [eva.guestId, other.guestId, cleared.guestId, "no-such-guest"]) {
      const res = await add(admin, A, { guestId });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("guest_not_found");
      expect((await lookup(admin, A, { guestId })).body.code).toBe("guest_not_found");
    }
    expect(await stored(A)).toEqual([]);
  });

  it("is a no-op for an entry that exists: same entry, original reason, no audit row", async () => {
    const first = (await add(admin, A, { contact: "ana@example.com", reason: "no_show" })).body.entries[0];
    const second = await add(admin, A, { contact: " ANA@example.com", reason: "conduct" });
    expect(second.status).toBe(200);
    expect(second.body.entries).toEqual([{ ...first, created: false }]);
    expect(await stored(A)).toHaveLength(1);
    expect((await auditRows(A)).filter((r) => r.action === "guest_blocked")).toHaveLength(1);
  });
});

describe("listing", () => {
  it("pages newest first, visiting every entry once, with ties and microsecond times", async () => {
    const ids: string[] = [];
    for (const contact of ["a@example.com", "b@example.com", "c@example.com", "d@example.com", "e@example.com"]) {
      ids.push((await add(admin, A, { contact })).body.entries[0].id);
    }
    const times = [
      "2026-01-01 00:00:00.000001+00",
      "2026-01-01 00:00:00.000002+00",
      "2026-01-01 00:00:00.000002+00",
      "2026-01-01 00:00:00.000003+00",
      "2026-02-01 00:00:00+00",
    ];
    for (const [i, id] of ids.entries()) {
      await db.execute(sql`UPDATE guest_blocklist SET created_at = ${times[i]}::timestamptz WHERE id = ${id}`);
    }
    const tied = [ids[1], ids[2]].sort().reverse();
    const expected = [ids[4], ids[3], ...tied, ids[0]];

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await list(admin, A, `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.entries.map((e: { id: string }) => e.id));
      cursor = res.body.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(seen).toEqual(expected);
    expect(pages).toBe(3);
  });

  it("keeps each venue's list and cursor to that venue", async () => {
    await add(admin, A, { contact: "a@example.com" });
    await add(admin, A, { contact: "b@example.com" });
    const own = (await add(adminB, B, { contact: "a@example.com" })).body.entries[0].id;
    const page = await list(admin, A, "?limit=1");
    expect(page.body.entries).toHaveLength(1);
    expect((await list(adminB, B)).body.entries.map((e: { id: string }) => e.id)).toEqual([own]);

    for (const query of [
      `?cursor=${encodeURIComponent(page.body.nextCursor)}`,
      "?cursor=garbage",
      "?limit=0",
      "?limit=201",
      "?limit=two",
    ]) {
      const res = await list(adminB, B, query);
      expect(res.status, query).toBe(400);
      expect(res.body.code).toBe("invalid_request");
    }
  });

  it("shows an entry made under a key that is no longer configured as inactive", async () => {
    const id = (await add(admin, A, { contact: "ana@example.com" })).body.entries[0].id;
    await db.update(guestBlocklist).set({ keyId: "0123456789abcdef" }).where(eq(guestBlocklist.id, id));
    const [entry] = (await list(admin, A)).body.entries;
    expect(entry).toMatchObject({ id, active: false });
  });

  it("dates expiry from the venue's retention period", async () => {
    await db.execute(sql`UPDATE venues SET retention_days = 30 WHERE id = ${A}`);
    const [entry] = (await add(admin, A, { contact: "ana@example.com" })).body.entries;
    expect(Date.parse(entry.expiresAt) - Date.parse(entry.createdAt)).toBe(30 * DAY_MS);
  });
});

describe("lookup", () => {
  it("returns the matching entries of this venue only, or none", async () => {
    const mine = (await add(admin, A, { contact: "ana@example.com", reason: "other" })).body.entries[0];
    await add(adminB, B, { contact: "ana@example.com" });
    const hit = await lookup(admin, A, { contact: "ANA@example.com" });
    expect(hit.status).toBe(200);
    const { created: _, ...view } = mine;
    expect(hit.body).toEqual({ entries: [view] });
    expect((await lookup(admin, A, { contact: "eva@example.com" })).body).toEqual({ entries: [] });
    const bad = await lookup(admin, A, { contact: "nobody" });
    expect(bad.status).toBe(400);
  });

  it("ignores a row of another venue even when it holds this venue's hash", async () => {
    await db.insert(guestBlocklist).values({
      id: "00000000-0000-4000-8000-0000000000bb",
      venueId: B,
      kind: "email",
      keyId: blocklistKeys.current.id,
      hash: hashOf(A, "eva@example.com"),
      createdBy: adminB.id,
    });
    expect((await lookup(admin, A, { contact: "eva@example.com" })).body).toEqual({ entries: [] });
    const added = await add(admin, A, { contact: "eva@example.com" });
    expect(added.body.entries[0].created).toBe(true);
  });
});

describe("removing", () => {
  it("removes once, then fails with blocklist_entry_not_found, and another venue cannot tell its ids apart", async () => {
    const entry = (await add(admin, A, { contact: "ana@example.com" })).body.entries[0];
    const foreign = await remove(adminB, B, entry.id);
    const unknown = await remove(adminB, B, "00000000-0000-4000-8000-000000000000");
    expect(foreign).toEqual(unknown);
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe("blocklist_entry_not_found");
    expect(await stored(A)).toHaveLength(1);

    const gone = await remove(admin, A, entry.id);
    expect(gone.status).toBe(200);
    const { created: _, ...view } = entry;
    expect(gone.body).toEqual({ entry: view });
    expect((await remove(admin, A, entry.id)).body.code).toBe("blocklist_entry_not_found");
    expect(await stored(A)).toEqual([]);
    expect((await auditRows(A)).map((r) => r.action)).toEqual(["guest_blocked", "guest_unblocked"]);
    expect(await auditRows(B)).toHaveLength(0);
  });
});

describe("the per-venue cap", () => {
  it(`holds ${BLOCKLIST_MAX_ENTRIES} entries and refuses an add that would pass it, adding nothing`, async () => {
    const ana = await book(A, "2027-03-10", "ana@example.com");
    const phone = await book(A, "2027-03-11", "600123456");
    await call(adminKey, "POST", `/v1/venues/${A}/guests/${phone.guestId}/merge`, { intoGuestId: ana.guestId }, {
      "Idempotency-Key": "bl-merge-cap",
    });
    await fill(A, BLOCKLIST_MAX_ENTRIES - 1);

    const both = await add(admin, A, { guestId: ana.guestId });
    expect(both.status).toBe(409);
    expect(both.body).toEqual({ code: "blocklist_limit_reached", message: "blocklist_limit_reached", retryable: false });
    expect(await stored(A)).toHaveLength(BLOCKLIST_MAX_ENTRIES - 1);
    expect(await auditRows(A)).toHaveLength(0);

    expect((await add(admin, A, { contact: "ana@example.com" })).status).toBe(200);
    expect((await add(admin, A, { contact: "eva@example.com" })).body.code).toBe("blocklist_limit_reached");
    const existing = await add(admin, A, { contact: "ana@example.com" });
    expect(existing.status).toBe(200);
    expect(existing.body.entries[0].created).toBe(false);
    expect((await add(adminB, B, { contact: "eva@example.com" })).status).toBe(200);
    expect(await stored(A)).toHaveLength(BLOCKLIST_MAX_ENTRIES);
  });

  it("lets exactly one of several concurrent adds take the last place", async () => {
    await fill(A, BLOCKLIST_MAX_ENTRIES - 1);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => add(admin, A, { contact: `racer-${i}@example.com` })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409, 409]);
    expect(await stored(A)).toHaveLength(BLOCKLIST_MAX_ENTRIES);
    expect((await auditRows(A)).filter((r) => r.action === "guest_blocked")).toHaveLength(1);
  });
});

describe("what leaves the engine", () => {
  it("writes audit rows of ids only, readable through the audit route", async () => {
    const ana = await book(A, "2027-03-10", "ana@example.com");
    const added = (await add(admin, A, { guestId: ana.guestId, reason: "conduct" })).body.entries[0];
    await remove(admin, A, added.id);
    const rows = await auditRows(A);
    expect(rows.map((r) => [r.action, r.actorUserId, r.blocklistEntryId, r.targetUserId, r.invitationId, r.role])).toEqual([
      ["guest_blocked", admin.id, added.id, null, null, null],
      ["guest_unblocked", admin.id, added.id, null, null, null],
    ]);
    const text = JSON.stringify(rows).toLowerCase();
    for (const needle of ["ana@example.com", "conduct", hashOf(A, "ana@example.com"), ana.guestId]) {
      expect(text).not.toContain(needle);
    }
    const read = await call(admin, "GET", `/v1/venues/${A}/audit`);
    expect(read.body.entries.map((e: { action: string; blocklistEntryId: string | null }) => [e.action, e.blocklistEntryId])).toEqual([
      ["guest_unblocked", added.id],
      ["guest_blocked", added.id],
    ]);
  });

  it("never answers with a hash or a contact, the one the caller sent included", async () => {
    const ana = await book(A, "2027-03-10", "ana@example.com");
    const phone = await book(A, "2027-03-11", "+34 600 123 456");
    responses.length = 0;
    await add(admin, A, { guestId: ana.guestId });
    await add(admin, A, { contact: "+34 600 123 456" });
    await add(admin, A, { contact: "  Eva@Example.com" });
    await lookup(admin, A, { contact: "  Eva@Example.com" });
    await lookup(admin, A, { guestId: phone.guestId });
    const page = await list(admin, A);
    await remove(admin, A, page.body.entries[0].id);
    await call(admin, "GET", `/v1/venues/${A}/audit`);

    const hashes = (await db.select({ hash: guestBlocklist.hash }).from(guestBlocklist)).map((r) => r.hash);
    expect(hashes.length).toBeGreaterThan(0);
    const all = responses.join("\n").toLowerCase();
    for (const needle of [
      ...hashes,
      hashOf(A, "eva@example.com"),
      "ana@example.com",
      "eva@example.com",
      "+34600123456",
      "600 123 456",
      "600123456",
    ]) {
      expect(all).not.toContain(needle);
    }
  });

  it("refuses a contact, or any undefined parameter, in the query string", async () => {
    const id = (await add(admin, A, { contact: "ana@example.com" })).body.entries[0].id;
    const q = "?contact=eva%40example.com";
    for (const res of [
      await call(admin, "GET", `/v1/venues/${A}/blocklist${q}`),
      await call(admin, "POST", `/v1/venues/${A}/blocklist${q}`, { contact: "eva@example.com" }),
      await call(admin, "POST", `/v1/venues/${A}/blocklist/lookup${q}`, { contact: "eva@example.com" }),
      await call(admin, "POST", `/v1/venues/${A}/blocklist?guestId=g1`, { contact: "eva@example.com" }),
      await call(admin, "DELETE", `/v1/venues/${A}/blocklist/${id}${q}`),
    ]) {
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("invalid_request");
    }
    expect((await stored(A)).map((r) => r.id)).toEqual([id]);
  });
});
