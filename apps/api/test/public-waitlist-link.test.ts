// The public waitlist of ADR-0021, section 3, after the join: C74 (token and entry read), C75 (leave), C76 (staff
// waitlist with dates), C77 (seating a dated entry) and C78 (retention and erasure). The join is in
// public-waitlist.test.ts.
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => {
  process.env.PUBLIC_CHALLENGE_SECRET = "test-secret-for-the-public-waitlist-link";
  process.env.PUBLIC_POW_DIFFICULTY = "0";
  return { sent: [] as { to: string; text: string }[] };
});

vi.mock("../src/lib/mailer", async (original) => ({
  ...(await original<typeof import("../src/lib/mailer")>()),
  sendEmail: async (_key: string, _from: string, to: string, _subject: string, text: string) => {
    mail.sent.push({ to, text });
  },
}));

import { migrateDb } from "../src/db/migrate";
import { events, guests, idempotencyKeys, reservations, waitlist, waitlistLinks } from "../src/db/schema";
import { endOfDate, findWaitlistLink } from "../src/lib/public-waitlist";
import { solve } from "../src/lib/public-challenge";
import { runRetention } from "../src/lib/retention";
import { addDays } from "../src/lib/time";
import { erase } from "../src/lib/venue";
import {
  ahead,
  app,
  challengeFor,
  db,
  entriesOf,
  joined,
  leave,
  makeVenue,
  nextContact,
  putOnline,
  readEntry,
  snapshot,
  staff,
  staffList,
  today,
  TOKEN,
  TZ,
  type Venue,
} from "./waitlist-helpers";

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE events, tombstones, idempotency_keys, table_allocations, reservations, guests, guest_audit, guest_blocklist, grants, api_keys, services, tables, venue_online_booking, sent_emails, waitlist, waitlist_links, self_service_links, venues RESTART IDENTITY CASCADE`,
  );
});

afterEach(() => vi.restoreAllMocks());

const INVALID_LINK = { code: "self_service_link_invalid", message: "self_service_link_invalid", retryable: false };

async function expectLinkInvalid(res: Response) {
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual(INVALID_LINK);
}

async function booking(v: Venue) {
  const challenge = challengeFor(v.key);
  const res = await app.request(`/v1/public/${v.key}/reservations`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ date: ahead(10), time: "20:00", partySize: 2, guest: { name: "Ana", contact: nextContact() }, challenge, solution: solve(challenge) }),
  });
  return (await res.json()).selfServiceToken as string;
}

/** A venue whose one service is open all day, so a walk-in (a seat) works whenever the test runs. */
const allDay = () => makeVenue({ services: [{ name: "allday", openStart: "00:00", openEnd: "23:59" }] });

async function eventsOf(venueId: string) {
  return db.select().from(events).where(eq(events.venueId, venueId));
}

describe("C74 waitlist token and entry read", () => {
  it("is <linkId>.<secret>, stored as the SHA-256 of the secret only, one link per entry, apart from booking links", async () => {
    const v = await makeVenue();
    const { token, entryId } = await joined(v);
    expect(token).toMatch(TOKEN);
    const [linkId, secret] = token.split(".") as [string, string];
    const rows = await db.select().from(waitlistLinks).where(eq(waitlistLinks.entryId, entryId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: linkId,
      venueId: v.id,
      entryId,
      secretHash: createHash("sha256").update(secret).digest("hex"),
      revokedAt: null,
      leaveKey: null,
    });
    expect(rows[0]!.expiresAt.toISOString()).toBe(endOfDate(ahead(10), TZ).toISOString());
    // The database refuses a second link for the entry.
    await expect(
      db.insert(waitlistLinks).values({ id: crypto.randomUUID(), venueId: v.id, entryId, secretHash: "0".repeat(64), expiresAt: new Date() }),
    ).rejects.toThrow();
    const other = await joined(v);
    const [otherId, otherSecret] = other.token.split(".");
    expect(otherId).not.toBe(linkId);
    expect(otherSecret).not.toBe(secret);
  });

  it("expires at the end of the entry's date in the venue's time zone", () => {
    expect(endOfDate("2026-07-01", "Europe/Madrid").toISOString()).toBe("2026-07-01T22:00:00.000Z");
    expect(endOfDate("2026-12-31", "Europe/Madrid").toISOString()).toBe("2026-12-31T23:00:00.000Z");
    expect(endOfDate("2026-12-31", "America/New_York").toISOString()).toBe("2027-01-01T05:00:00.000Z");
  });

  it("reads the guest view, which changes nothing and holds no id, zone, source, consent or name", async () => {
    const v = await makeVenue({ venue: { publicPhone: "+34 910 000 000" } });
    const contact = nextContact();
    const { token, entryId, answer } = await joined(v, { guest: { name: "Zebulon", contact }, window: { from: "20:00", to: "21:30" } });
    const before = await db.select().from(waitlist).where(eq(waitlist.id, entryId));
    const linkBefore = await db.select().from(waitlistLinks).where(eq(waitlistLinks.entryId, entryId));
    const res = await readEntry(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const view = await res.json();
    expect(view).toEqual(answer.entry);
    expect(Object.keys(view).sort()).toEqual(["date", "guest", "linkExpiresAt", "partySize", "status", "venue", "window"]);
    expect(Object.keys(view.venue).sort()).toEqual(["address", "locale", "name", "phone", "theme"]);
    expect(view.guest).toEqual({ contact: `${contact[0]}***@example.com` });
    const text = JSON.stringify(view);
    for (const leak of [entryId, v.id, "widget", "Zebulon", contact, "consent", "zone", "reservationId"]) expect(text).not.toContain(leak);
    expect(await db.select().from(waitlist).where(eq(waitlist.id, entryId))).toEqual(before);
    expect(await db.select().from(waitlistLinks).where(eq(waitlistLinks.entryId, entryId))).toEqual(linkBefore);
    expect(await eventsOf(v.id)).toEqual([]);
  });

  it("reads every status until the link expires: cancelled by staff and seated", async () => {
    const v = await allDay();
    const cancelled = await joined(v);
    expect((await staff(v, "POST", `/waitlist/${cancelled.entryId}/cancel`)).status).toBe(200);
    expect((await (await readEntry(cancelled.token)).json()).status).toBe("cancelled");
    const seated = await joined(v, { date: ahead(1) });
    await db.update(waitlist).set({ date: today() }).where(eq(waitlist.id, seated.entryId));
    expect((await staff(v, "POST", `/waitlist/${seated.entryId}/seat`)).status).toBe(200);
    expect((await (await readEntry(seated.token)).json()).status).toBe("seated");
  });

  it("answers every failure with one 404, byte for byte", async () => {
    const v = await makeVenue();
    const reference = await snapshot(await readEntry(null));
    expect(reference.status).toBe(404);
    expect(JSON.parse(reference.body)).toEqual(INVALID_LINK);
    expect(reference.headers).toContainEqual(["cache-control", "no-store"]);
    const { token } = await joined(v);
    const [linkId, secret] = token.split(".") as [string, string];
    const expired = await joined(v);
    await db.update(waitlistLinks).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(waitlistLinks.id, expired.token.split(".")[0]!));
    const left = await joined(v);
    expect((await leave(left.token)).status).toBe(200);
    const erased = await joined(v);
    await erase(db, v.id, erased.body.guest.contact);
    const swap = secret.startsWith("A") ? `B${secret.slice(1)}` : `A${secret.slice(1)}`;
    const bookingToken = await booking(v);
    const failing = [
      "",
      "garbage",
      `${linkId}.${secret.slice(1)}`,
      `${linkId.toUpperCase()}.${secret}`,
      `${crypto.randomUUID()}.${secret}`,
      `${linkId}.${swap}`,
      expired.token,
      left.token,
      erased.token,
      bookingToken,
    ];
    for (const t of failing) expect(await snapshot(await readEntry(t)), t).toEqual(reference);
    // A waitlist token never works on the booking routes.
    const ss = await snapshot(await app.request("/v1/public/self-service", { headers: { "X-Self-Service-Token": token } }));
    expect(ss).toEqual(await snapshot(await app.request("/v1/public/self-service")));
    for (const path of ["modify", "cancel"]) {
      const res = await app.request(`/v1/public/self-service/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Self-Service-Token": token, "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ version: 1, partySize: 3 }),
      });
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("self_service_link_invalid");
    }
    // The booking token still reads its booking; the waitlist token still reads its entry.
    expect((await app.request("/v1/public/self-service", { headers: { "X-Self-Service-Token": bookingToken } })).status).toBe(200);
    expect((await readEntry(token)).status).toBe(200);
  });

  it("runs the same compare for an unknown link id, against a dummy hash", async () => {
    const v = await makeVenue();
    const { token } = await joined(v);
    const calls: number[] = [];
    const compare = (a: Buffer, b: Buffer) => (calls.push(b.length), a.equals(b));
    expect(await findWaitlistLink(db, `${crypto.randomUUID()}.${token.split(".")[1]}`, compare)).toBeNull();
    expect(await findWaitlistLink(db, token, compare)).not.toBeNull();
    expect(calls).toEqual([32, 32]);
  });

  it("works just before the expiry and fails just after, by the database clock", async () => {
    const v = await makeVenue();
    const { token } = await joined(v);
    const id = token.split(".")[0]!;
    await db.update(waitlistLinks).set({ expiresAt: sql`now() + interval '1 minute'` }).where(eq(waitlistLinks.id, id));
    expect((await readEntry(token)).status).toBe(200);
    await db.update(waitlistLinks).set({ expiresAt: sql`now() - interval '1 millisecond'` }).where(eq(waitlistLinks.id, id));
    await expectLinkInvalid(await readEntry(token));
  });

  it("keeps working with online booking off, a rotated key and the waitlist off, and ignores cookies and keys", async () => {
    const v = await makeVenue();
    const { token } = await joined(v);
    const plain = await snapshot(await readEntry(token));
    await putOnline(v.id, v.admin, { waitlistEnabled: false });
    await app.request(`/v1/venues/${v.id}/online-booking/rotate-key`, { method: "POST", headers: { apikey: v.admin } });
    await putOnline(v.id, v.admin, { enabled: false });
    expect((await readEntry(token)).status).toBe(200);
    for (const headers of [{ apikey: v.admin }, { cookie: "better-auth.session_token=abc" }]) {
      const res = await readEntry(token, headers);
      expect(res.status).toBe(200);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect(plain.status).toBe(200);
  });

  it("puts the token in no table and no log line", async () => {
    const v = await makeVenue();
    const logs: string[] = [];
    for (const method of ["error", "warn", "log", "info", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
    }
    const { token, key } = await joined(v);
    const secret = token.split(".")[1]!;
    await readEntry(token);
    await readEntry(`${crypto.randomUUID()}.${secret}`);
    await leave(token, key);
    await leave(token);
    await leave(token);
    const dump = await db.execute(sql`
      select coalesce(json_agg(t)::text, '') as rows from (
        select row_to_json(w) from waitlist w union all
        select row_to_json(l) from waitlist_links l union all
        select row_to_json(k) from idempotency_keys k union all
        select row_to_json(e) from events e union all
        select row_to_json(s) from sent_emails s
      ) t`);
    expect(String((dump.rows[0] as { rows: string }).rows)).not.toContain(secret);
    for (const line of logs) expect(line).not.toContain(secret);
  });
});

describe("C75 waitlist leave", () => {
  it("cancels through the staff cancel and revokes the link in one write, with no event and no email", async () => {
    const v = await makeVenue();
    const { token, entryId } = await joined(v);
    await new Promise((r) => setTimeout(r, 50));
    const mails = mail.sent.length;
    const key = crypto.randomUUID();
    const res = await leave(token, key);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const view = await res.json();
    expect(view.status).toBe("cancelled");
    expect((await staffList(v, ahead(10))).body.entries).toEqual([]);
    const [link] = await db.select().from(waitlistLinks).where(eq(waitlistLinks.entryId, entryId));
    expect(link!.revokedAt).not.toBeNull();
    expect(link!.leaveKey).toBe(`public:${key}`);
    expect(await eventsOf(v.id)).toEqual([]);
    await new Promise((r) => setTimeout(r, 50));
    expect(mail.sent.length).toBe(mails);
    // Then the token reads nothing and leaves nothing, apart from a repeat of this leave.
    await expectLinkInvalid(await readEntry(token));
    await expectLinkInvalid(await leave(token));
    const before = await db.select().from(waitlist).where(eq(waitlist.id, entryId));
    const again = await leave(token, key.toUpperCase());
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(view);
    expect(await db.select().from(waitlist).where(eq(waitlist.id, entryId))).toEqual(before);
  });

  it("stops replaying once the link would have expired and after an erasure", async () => {
    const v = await makeVenue();
    const a = await joined(v);
    const keyA = crypto.randomUUID();
    expect((await leave(a.token, keyA)).status).toBe(200);
    await db.update(waitlistLinks).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(waitlistLinks.entryId, a.entryId));
    await expectLinkInvalid(await leave(a.token, keyA));
    const b = await joined(v);
    const keyB = crypto.randomUUID();
    expect((await leave(b.token, keyB)).status).toBe(200);
    await erase(db, v.id, b.body.guest.contact);
    await expectLinkInvalid(await leave(b.token, keyB));
  });

  it("fails with invalid_transition after staff seat or cancel, changes nothing and keeps the link", async () => {
    const v = await allDay();
    const cancelled = await joined(v);
    await staff(v, "POST", `/waitlist/${cancelled.entryId}/cancel`);
    const res = await leave(cancelled.token);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("invalid_transition");
    const [link] = await db.select().from(waitlistLinks).where(eq(waitlistLinks.entryId, cancelled.entryId));
    expect(link!.revokedAt).toBeNull();
    expect((await readEntry(cancelled.token)).status).toBe(200);
    const seated = await joined(v, { date: ahead(2) });
    await db.update(waitlist).set({ date: today() }).where(eq(waitlist.id, seated.entryId));
    await staff(v, "POST", `/waitlist/${seated.entryId}/seat`);
    expect((await leave(seated.token)).status).toBe(409);
    expect((await (await readEntry(seated.token)).json()).status).toBe("seated");
  });

  it("needs a UUID key, and refuses a key of another kind", async () => {
    const v = await makeVenue();
    const { token, key } = await joined(v);
    for (const bad of [null, "", "nope"]) {
      const res = await leave(token, bad);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_request");
    }
    expect((await leave(token, key)).status).toBe(400);
    const other = await joined(v);
    const used = crypto.randomUUID();
    expect((await leave(other.token, used)).status).toBe(200);
    const third = await joined(v);
    expect((await leave(third.token, used)).status).toBe(400);
    expect((await (await readEntry(token)).json()).status).toBe("waiting");
    expect((await (await readEntry(third.token)).json()).status).toBe("waiting");
  });

  it("ends a race with a staff cancel, a seat or another leave with one outcome", async () => {
    const v = await allDay();
    for (let i = 0; i < 3; i++) {
      const a = await joined(v, { date: ahead(3 + i) });
      const [mine, theirs] = await Promise.all([leave(a.token), staff(v, "POST", `/waitlist/${a.entryId}/cancel`, undefined, null)]);
      expect([mine.status, theirs.status].sort()).toEqual([200, 409]);

      const b = await joined(v, { date: ahead(3 + i) });
      const leaves = await Promise.all([leave(b.token), leave(b.token), leave(b.token)]);
      expect(leaves.filter((r) => r.status === 200)).toHaveLength(1);
      expect(leaves.every((r) => r.status === 200 || r.status === 404 || r.status === 409)).toBe(true);

      const c = await joined(v, { date: ahead(1) });
      await db.update(waitlist).set({ date: today() }).where(eq(waitlist.id, c.entryId));
      const [left, seat] = await Promise.all([leave(c.token), staff(v, "POST", `/waitlist/${c.entryId}/seat`)]);
      expect([left.status, seat.status].sort()).toEqual([200, 409]);
      const [row] = await db.select().from(waitlist).where(eq(waitlist.id, c.entryId));
      const seated = await db.select().from(reservations).where(and(eq(reservations.venueId, v.id), eq(reservations.id, row!.reservationId ?? "-")));
      expect(row!.status === "seated").toBe(seated.length === 1);
      expect(["seated", "cancelled"]).toContain(row!.status);
    }
  });

  it("is not revoked by a staff cancel (Q8)", async () => {
    const v = await makeVenue();
    const { token, entryId } = await joined(v);
    await staff(v, "POST", `/waitlist/${entryId}/cancel`);
    const [link] = await db.select().from(waitlistLinks).where(eq(waitlistLinks.entryId, entryId));
    expect(link!.revokedAt).toBeNull();
    expect((await readEntry(token)).status).toBe(200);
  });
});

describe("C76 staff waitlist with dates", () => {
  it("carries date, window and source on every answer, and a staff add is a same-day entry whatever it sends", async () => {
    const v = await makeVenue();
    const added = await staff(v, "POST", "/waitlist", { partySize: 2, date: ahead(3), source: "widget", windowStart: "20:00", guest: { name: "Eva" } });
    expect(added.status).toBe(201);
    const [entry] = (await added.json()).entries;
    expect(entry).toMatchObject({ date: null, windowStart: null, windowEnd: null, source: "staff" });
    expect(Object.keys(entry).sort()).toEqual(
      ["createdAt", "date", "guestContact", "guestName", "id", "partySize", "reservationId", "source", "status", "venueId", "windowEnd", "windowStart", "zone"],
    );
    const cancel = await staff(v, "POST", `/waitlist/${entry.id}/cancel`);
    expect((await cancel.json()).entries).toEqual([]);
  });

  it("lists today's queue without a date, the same with today's date, and a date's entries with one", async () => {
    const v = await makeVenue();
    const sameDay = await (await staff(v, "POST", "/waitlist", { partySize: 2 })).json();
    const later = await joined(v, { date: ahead(5) });
    const todays = await joined(v, { date: ahead(6) });
    await db.update(waitlist).set({ date: today() }).where(eq(waitlist.id, todays.entryId));
    const past = await joined(v, { date: ahead(7) });
    await db.update(waitlist).set({ date: addDays(today(), -1) }).where(eq(waitlist.id, past.entryId));

    const plain = await staffList(v);
    expect(plain.body.entries.map((e: { id: string }) => e.id)).toEqual([sameDay.entries[0].id, todays.entryId]);
    expect((await staffList(v, today())).body).toEqual(plain.body);
    expect((await staffList(v, ahead(5))).body.entries.map((e: { id: string }) => e.id)).toEqual([later.entryId]);
    expect((await staffList(v, addDays(today(), -1))).body.entries.map((e: { id: string }) => e.id)).toEqual([past.entryId]);
    expect((await staffList(v, ahead(5), v.read)).status).toBe(200);
    for (const bad of ["tomorrow", "2026-02-30", "1899-12-31", ""]) {
      const res = await staffList(v, bad);
      expect(res.status, bad).toBe(400);
    }
    const other = await makeVenue();
    expect((await staffList(other, ahead(5))).body.entries).toEqual([]);
    const text = JSON.stringify(plain.body) + JSON.stringify((await staffList(v, ahead(5))).body);
    expect(text).not.toContain("consent");
    expect(text).not.toContain(later.token.split(".")[1]);
  });
});

describe("C77 seating a dated entry", () => {
  it("seats today's public entry and refuses another date with invalid_transition, writing nothing", async () => {
    const v = await allDay();
    const future = await joined(v, { date: ahead(4) });
    const past = await joined(v, { date: ahead(5) });
    await db.update(waitlist).set({ date: addDays(today(), -1) }).where(eq(waitlist.id, past.entryId));
    const key = crypto.randomUUID();
    for (const e of [future, past]) {
      const res = await staff(v, "POST", `/waitlist/${e.entryId}/seat`, undefined, key);
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("invalid_transition");
    }
    expect((await entriesOf(v.id)).every((e) => e.status === "waiting")).toBe(true);
    expect(await db.select().from(reservations).where(eq(reservations.venueId, v.id))).toEqual([]);
    expect(await db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.venueId, v.id), eq(idempotencyKeys.key, key)))).toEqual([]);
    expect(await eventsOf(v.id)).toEqual([]);
    // The same key then seats a same-day entry.
    const sameDay = (await (await staff(v, "POST", "/waitlist", { partySize: 2 })).json()).entries[0];
    expect((await staff(v, "POST", `/waitlist/${sameDay.id}/seat`, undefined, key)).status).toBe(200);
    // Today's public entry seats like any other, and its guest view reads seated.
    const todays = await joined(v, { date: ahead(1) });
    await db.update(waitlist).set({ date: today() }).where(eq(waitlist.id, todays.entryId));
    expect((await staff(v, "POST", `/waitlist/${todays.entryId}/seat`)).status).toBe(200);
    expect((await (await readEntry(todays.token)).json()).status).toBe("seated");
    // The status check comes first: a cancelled future entry is still invalid_transition.
    await staff(v, "POST", `/waitlist/${future.entryId}/cancel`);
    expect((await staff(v, "POST", `/waitlist/${future.entryId}/seat`)).status).toBe(409);
  });
});

describe("C78 retention and erasure of public waitlist entries", () => {
  it("deletes a public entry with its link on the first run after its date, in any status, and keeps later ones", async () => {
    const v = await makeVenue();
    const other = await makeVenue();
    const date = ahead(3);
    const waiting = await joined(v, { date });
    const left = await joined(v, { date });
    await leave(left.token);
    const later = await joined(v, { date: ahead(4) });
    const elsewhere = await joined(other, { date: ahead(5) });
    const sameDay = await (await staff(v, "POST", "/waitlist", { partySize: 2, guest: { name: "Eva", contact: nextContact() } })).json();

    // Just before the local midnight that ends the date the entries stay; just after, they go.
    const end = endOfDate(date, TZ);
    await runRetention(db, new Date(end.getTime() - 60_000));
    expect(await entriesOf(v.id)).toHaveLength(4);
    await runRetention(db, new Date(end.getTime() + 60_000));
    const ids = (await entriesOf(v.id)).map((e) => e.id).sort();
    expect(ids).toEqual([later.entryId, sameDay.entries[0].id].sort());
    expect(await db.select().from(waitlistLinks).where(eq(waitlistLinks.entryId, waiting.entryId))).toEqual([]);
    await expectLinkInvalid(await readEntry(waiting.token));
    await expectLinkInvalid(await readEntry(left.token));
    expect((await readEntry(later.token)).status).toBe(200);
    expect((await readEntry(elsewhere.token)).status).toBe(200);
    // A second run changes nothing.
    await runRetention(db, new Date(end.getTime() + 60_000));
    expect((await entriesOf(v.id)).length).toBe(2);

    // Bounded batches, and overlapping runs delete each entry once.
    const many = await makeVenue();
    for (let i = 0; i < 6; i++) await joined(many, { date: ahead(8) });
    await db.update(waitlist).set({ date: addDays(today(), -2) }).where(eq(waitlist.venueId, many.id));
    await runRetention(db, new Date(), { size: 2, perRun: 2 });
    expect((await entriesOf(many.id)).length).toBe(2);
    await Promise.all([runRetention(db, new Date(), { size: 1, perRun: 5 }), runRetention(db, new Date(), { size: 1, perRun: 5 })]);
    expect(await entriesOf(many.id)).toEqual([]);
    expect(await eventsOf(v.id)).toEqual([]);
  });

  it("still deletes same-day entries past the retention period (C18)", async () => {
    const v = await makeVenue();
    const added = await (await staff(v, "POST", "/waitlist", { partySize: 2, guest: { name: "Eva", contact: nextContact() } })).json();
    await runRetention(db, new Date(Date.now() + 401 * 86_400_000));
    expect((await entriesOf(v.id)).map((e) => e.id)).not.toContain(added.entries[0].id);
  });

  it("erases public entries with their links by guest id and by the contact fallback, and counts them", async () => {
    const v = await makeVenue();
    const other = await makeVenue();
    const contact = nextContact();
    const challenge = challengeFor(v.key);
    const created = await app.request(`/v1/public/${v.key}/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ date: ahead(10), time: "20:00", partySize: 2, guest: { name: "Ana", contact }, challenge, solution: solve(challenge) }),
    });
    const a = await joined(v, { date: ahead(3), guest: { name: "Ana", contact: contact.toUpperCase() } });
    const keyA = crypto.randomUUID();
    const b = await joined(v, { date: ahead(4), guest: { name: "Ana", contact } });
    expect((await leave(b.token, keyA)).status).toBe(200);
    const kept = await joined(v, { date: ahead(3) });
    const elsewhere = await joined(other, { date: ahead(3), guest: { name: "Ana", contact } });
    expect(created.status).toBe(200);

    const [guest] = await db.select({ id: guests.id }).from(guests).where(and(eq(guests.venueId, v.id), eq(guests.email, contact)));
    const res = await erase(db, v.id, guest!.id);
    expect(res.erasedWaitlistEntries).toBe(2);
    for (const t of [a.token, b.token]) await expectLinkInvalid(await readEntry(t));
    await expectLinkInvalid(await leave(b.token, keyA));
    expect(await db.select().from(waitlistLinks).where(eq(waitlistLinks.entryId, a.entryId))).toEqual([]);
    expect((await readEntry(kept.token)).status).toBe(200);
    expect((await readEntry(elsewhere.token)).status).toBe(200);

    // A guest who only joined the waitlist has no record: the contact fallback reaches the entry.
    const only = nextContact();
    const c = await joined(v, { date: ahead(5), guest: { name: "Ana", contact: only } });
    expect((await erase(db, v.id, only)).erasedWaitlistEntries).toBe(1);
    await expectLinkInvalid(await readEntry(c.token));
    // Erasure by principal does not reach the waitlist.
    const d = await joined(v, { date: ahead(6) });
    await erase(db, v.id, undefined, "widget");
    expect((await readEntry(d.token)).status).toBe(200);
    expect(await eventsOf(v.id)).not.toContainEqual(expect.objectContaining({ reservationId: c.entryId }));
  });
});
