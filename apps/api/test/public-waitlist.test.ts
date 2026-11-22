// The public waitlist join of ADR-0021, section 3: C68 (setting and config), C69 (join), C70 (consent, contact and
// email), C71 (caps), C72 (blocklist) and C73 (idempotency). The token, read, leave, staff routes, retention and
// erasure are in public-waitlist-link.test.ts.
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => {
  process.env.PUBLIC_CHALLENGE_SECRET = "test-secret-for-the-public-waitlist-join";
  process.env.PUBLIC_POW_DIFFICULTY = "0";
  process.env.BLOCKLIST_KEY_PREVIOUS = Buffer.alloc(32, 9).toString("base64");
  return { sent: [] as { to: string; subject: string; text: string; html: string }[], failFor: new Set<string>() };
});

vi.mock("../src/lib/mailer", async (original) => ({
  ...(await original<typeof import("../src/lib/mailer")>()),
  sendEmail: async (_key: string, _from: string, to: string, subject: string, text: string, html = "") => {
    if (mail.failFor.has(to)) throw new Error(`Resend 422: could not send ${text}`);
    mail.sent.push({ to, subject, text, html });
  },
}));

import { migrateDb } from "../src/db/migrate";
import { auth } from "../src/lib/auth";
import {
  events,
  guestAudit,
  guests,
  idempotencyKeys,
  reservations,
  tableAllocations,
  venueOnlineBooking,
  venues,
  waitlist,
  waitlistLinks,
} from "../src/db/schema";
import { blocklistKeys, insertBlocklistEntry } from "../src/lib/blocklist";
import { blocklistHash, normalizeContact } from "../src/lib/contact";
import { formatEmailDay } from "../src/lib/email-messages";
import { WAITLIST_CAPS } from "../src/lib/public-waitlist";
import { solve } from "../src/lib/public-challenge";
import { addDays, isoWeekday } from "../src/lib/time";
import {
  ahead,
  app,
  challengeFor,
  db,
  entriesOf,
  join,
  joinBody,
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
  type Venue,
} from "./waitlist-helpers";

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE events, tombstones, idempotency_keys, table_allocations, reservations, guests, guest_audit, guest_blocklist, grants, api_keys, services, tables, venue_online_booking, sent_emails, waitlist, waitlist_links, self_service_links, venues RESTART IDENTITY CASCADE`,
  );
});

afterEach(() => {
  mail.failFor.clear();
  vi.restoreAllMocks();
});

const pause = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
async function settle() {
  // The join email goes after the answer, on a later turn of the event loop.
  await pause(100);
}
const mailTo = (address: string) => mail.sent.filter((m) => m.to === address);

async function config(v: Venue) {
  return (await app.request(`/v1/public/${v.key}`)).json();
}

async function readSetting(v: Venue, apikey = v.admin) {
  const res = await app.request(`/v1/venues/${v.id}/online-booking`, { headers: { apikey } });
  return (await res.json()).waitlistEnabled;
}

async function footprint(venueId: string) {
  const count = async (table: any) =>
    (await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.venueId, venueId)))[0]!.n;
  return {
    waitlist: await count(waitlist),
    links: await count(waitlistLinks),
    keys: await count(idempotencyKeys),
    reservations: await count(reservations),
    allocations: await count(tableAllocations),
    guests: await count(guests),
    audit: await count(guestAudit),
    events: await count(events),
  };
}

const UNAVAILABLE = { code: "waitlist_unavailable", message: "waitlist_unavailable", retryable: false };

async function expectUnavailable(res: Response) {
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual(UNAVAILABLE);
}

async function expectInvalid(res: Response) {
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ code: "invalid_request", message: "invalid_request", retryable: false });
}


/**
 * The join's answer carries `waitlistToken`, a UUID and 43 random base64url characters. A leak scan for a short string,
 * such as the table name "T0", matches that randomness about once in a hundred runs, so the scan reads the answer
 * without the token. Everything else in the answer is still scanned.
 */
function withoutToken(text: string): string {
  try {
    const body = JSON.parse(text);
    if (body && typeof body === "object") delete body.waitlistToken;
    return JSON.stringify(body);
  } catch {
    return text;
  }
}

describe("C68 public waitlist setting and config", () => {
  it("reads false for a venue that never set it, and only an admin changes it", async () => {
    const v = await makeVenue({ settings: { waitlistEnabled: false } });
    await db.delete(venueOnlineBooking).where(eq(venueOnlineBooking.venueId, v.id));
    expect(await readSetting(v)).toBe(false);
    expect(await readSetting(v, v.read)).toBe(false);
    for (const key of [v.read, v.write]) {
      const res = await putOnline(v.id, key, { waitlistEnabled: true });
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("forbidden");
    }
    const other = await makeVenue();
    expect((await putOnline(v.id, other.admin, { waitlistEnabled: true })).status).toBe(404);
    expect(await readSetting(v)).toBe(false);
  });

  it("round-trips true and false, keeps the value on a PUT without it, and refuses a value that is not a boolean", async () => {
    const v = await makeVenue({ settings: { waitlistEnabled: false } });
    expect((await (await putOnline(v.id, v.admin, { waitlistEnabled: true })).json()).waitlistEnabled).toBe(true);
    expect(await readSetting(v)).toBe(true);
    expect((await putOnline(v.id, v.admin, { maxPartySize: 6 })).status).toBe(200);
    expect(await readSetting(v)).toBe(true);
    for (const bad of [null, "true", 1, 0, [], {}]) {
      const res = await putOnline(v.id, v.admin, { waitlistEnabled: bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(await readSetting(v)).toBe(true);
    expect((await (await putOnline(v.id, v.admin, { waitlistEnabled: false })).json()).waitlistEnabled).toBe(false);
    expect(await readSetting(v)).toBe(false);
  });

  it("refuses true while the venue's email is off, changes nothing, and accepts it once email is on", async () => {
    const v = await makeVenue({ venue: { notificationsEnabled: false } });
    expect(await readSetting(v)).toBe(false);
    const before = (await db.select().from(venueOnlineBooking).where(eq(venueOnlineBooking.venueId, v.id)))[0];
    await expectInvalid(await putOnline(v.id, v.admin, { waitlistEnabled: true, maxPartySize: 6 }));
    expect((await db.select().from(venueOnlineBooking).where(eq(venueOnlineBooking.venueId, v.id)))[0]).toEqual(before);
    // `false` is always accepted.
    expect((await putOnline(v.id, v.admin, { waitlistEnabled: false })).status).toBe(200);
    await db.update(venues).set({ notificationsEnabled: true }).where(eq(venues.id, v.id));
    expect((await putOnline(v.id, v.admin, { waitlistEnabled: true })).status).toBe(200);
    expect(await readSetting(v)).toBe(true);
  });

  it("is true in the public config exactly when the setting, email, a way to send and a widget origin are there", async () => {
    const on = await makeVenue();
    expect((await config(on)).waitlistEnabled).toBe(true);
    const settingOff = await makeVenue({ settings: { waitlistEnabled: false } });
    expect((await config(settingOff)).waitlistEnabled).toBe(false);
    const noSender = await makeVenue({ venue: { resendApiKey: null } });
    expect(await readSetting(noSender)).toBe(true);
    expect((await config(noSender)).waitlistEnabled).toBe(false);
    expect((await config(noSender)).linkResend).toBe(false);
    // Email turned off later keeps the stored value, and the public channel reads the waitlist as off.
    const later = await makeVenue();
    await db.update(venues).set({ notificationsEnabled: false }).where(eq(venues.id, later.id));
    expect(await readSetting(later)).toBe(true);
    expect((await config(later)).waitlistEnabled).toBe(false);
    // One venue's change does not touch another.
    expect((await config(on)).waitlistEnabled).toBe(true);
  });

  it("refuses every join while it is false, alike and writing nothing; entries already made keep working", async () => {
    const v = await makeVenue();
    const first = await joined(v);
    await putOnline(v.id, v.admin, { waitlistEnabled: false });
    const before = await footprint(v.id);
    await expectUnavailable(await join(v.key, joinBody(v)));
    expect(await footprint(v.id)).toEqual(before);
    expect((await readEntry(first.token)).status).toBe(200);
    expect((await staffList(v, ahead(10))).body.entries).toHaveLength(1);

    // Email off: the same answer, and the link still works, also after online booking is off and the key rotates.
    const w = await makeVenue();
    const kept = await joined(w);
    await db.update(venues).set({ notificationsEnabled: false }).where(eq(venues.id, w.id));
    await expectUnavailable(await join(w.key, joinBody(w)));
    await putOnline(w.id, w.admin, { enabled: false });
    expect((await readEntry(kept.token)).status).toBe(200);
    await putOnline(w.id, w.admin, { enabled: true });
    await app.request(`/v1/venues/${w.id}/online-booking/rotate-key`, { method: "POST", headers: { apikey: w.admin } });
    expect((await readEntry(kept.token)).status).toBe(200);
    expect((await leave(kept.token)).status).toBe(200);
  });
});

describe("C69 public waitlist join", () => {
  it("adds one widget entry for the date and answers the guest view and a token, writing nothing else", async () => {
    const v = await makeVenue({ venue: { publicPhone: "+34 910 000 000" } });
    const before = await footprint(v.id);
    const contact = nextContact();
    const body = joinBody(v, { guest: { name: "  Ana Ruiz  ", contact: `  ${contact}  ` }, window: { from: "20:00", to: "22:00" } });
    const res = await join(v.key, body);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
    const answer = await res.json();
    expect(Object.keys(answer).sort()).toEqual(["entry", "waitlistToken"]);
    expect(answer.waitlistToken).toMatch(TOKEN);
    const [link] = await db.select().from(waitlistLinks).where(eq(waitlistLinks.id, answer.waitlistToken.split(".")[0]));
    expect(answer.entry).toEqual({
      venue: { name: v.name, locale: "es", theme: {}, phone: "+34 910 000 000", address: null },
      date: ahead(10),
      window: { from: "20:00", to: "22:00" },
      partySize: 2,
      status: "waiting",
      guest: { contact: `${contact[0]}***@example.com` },
      linkExpiresAt: link!.expiresAt.toISOString(),
    });
    const list = await staffList(v, ahead(10));
    expect(list.body.entries).toEqual([
      {
        id: link!.entryId,
        venueId: v.id,
        partySize: 2,
        zone: "",
        guestName: "Ana Ruiz",
        guestContact: contact,
        status: "waiting",
        reservationId: null,
        createdAt: expect.any(String),
        date: ahead(10),
        windowStart: "20:00",
        windowEnd: "22:00",
        source: "widget",
      },
    ]);
    expect(await footprint(v.id)).toEqual({ ...before, waitlist: 1, links: 1, keys: 1 });
    // No window: nulls.
    const plain = await joined(v);
    const [row] = await db.select().from(waitlist).where(eq(waitlist.id, plain.entryId));
    expect([row!.windowStart, row!.windowEnd]).toEqual([null, null]);
    expect(plain.answer.entry.window).toBeNull();
  });

  it("joins a full day and an available day, and is refused exactly where /days says closed or outside_window", async () => {
    const start = today();
    const closedWeekday = isoWeekday(addDays(start, 4));
    const v = await makeVenue({
      venue: { blockedDates: [{ from: addDays(start, 6), to: addDays(start, 6) }] },
      settings: { weekdays: [1, 2, 3, 4, 5, 6, 7].filter((d) => d !== closedWeekday), maxAdvanceDays: 9 },
      tables: 1,
    });
    const seen = new Set<string>();
    for (const partySize of [2, 6]) {
      const res = await app.request(`/v1/public/${v.key}/days?from=${addDays(start, -1)}&days=13&partySize=${partySize}`);
      const { days } = await res.json();
      for (const day of days as { date: string; status: string }[]) {
        seen.add(day.status);
        const answer = await join(v.key, joinBody(v, { date: day.date, partySize }));
        if (day.status === "available" || day.status === "full") {
          expect(answer.status, `${day.date} ${partySize} ${day.status}`).toBe(200);
        } else {
          expect(answer.status, `${day.date} ${partySize} ${day.status}`).toBe(409);
          expect((await answer.json()).code).toBe("waitlist_unavailable");
        }
      }
    }
    // A party of 6 at one table of 4 is `full` on every served day; a blocked date, a closed weekday, the past and
    // a date past the horizon each refuse.
    expect([...seen].sort()).toEqual(["available", "closed", "full", "outside_window"]);
  });

  it("refuses a malformed date, a party outside the online limits and a bad window with invalid_request", async () => {
    const v = await makeVenue({ settings: { minPartySize: 2, maxPartySize: 6 } });
    const before = await footprint(v.id);
    for (const date of ["2026-02-30", "26-01-01", "1899-12-31", "9999-01-01", 20260101, null]) {
      await expectInvalid(await join(v.key, joinBody(v, { date })));
    }
    for (const partySize of [1, 7, 0, 2.5, "2", null]) {
      await expectInvalid(await join(v.key, joinBody(v, { partySize })));
    }
    for (const window of [
      { from: "20:00" },
      { to: "22:00" },
      { from: "20:00", to: "20:00" },
      { from: "22:00", to: "20:00" },
      { from: "8:00", to: "9:00" },
      { from: "20:00", to: "24:00" },
      { from: "20:00", to: "22:00", note: "x" },
      null,
      "20:00-22:00",
    ]) {
      await expectInvalid(await join(v.key, joinBody(v, { window })));
    }
    expect(await footprint(v.id)).toEqual(before);
    // The window is a preference and is not checked against the service hours.
    expect((await join(v.key, joinBody(v, { window: { from: "05:00", to: "06:30" } }))).status).toBe(200);
  });

  it("refuses a missing or long name, an unlisted field and a bad locale, writing nothing", async () => {
    const v = await makeVenue();
    const before = await footprint(v.id);
    const contact = nextContact();
    const bodies = [
      joinBody(v, { guest: { contact } }),
      joinBody(v, { guest: { name: "   ", contact } }),
      joinBody(v, { guest: { name: "x".repeat(101), contact } }),
      joinBody(v, { guest: { name: "Ana", contact, consent: "granted" } }),
      joinBody(v, { guest: { name: "Ana" } }),
      joinBody(v, { guest: "Ana" }),
      ...["note", "commentary", "zone", "time", "tables", "phone", "marketing"].map((field) => joinBody(v, { [field]: "x" })),
      ...["EN", "xx", "es-ES", null, 1].map((locale) => joinBody(v, { locale })),
    ];
    for (const body of bodies) await expectInvalid(await join(v.key, body));
    expect(await footprint(v.id)).toEqual(before);
    expect((await join(v.key, joinBody(v, { guest: { name: ` ${"x".repeat(100)} `, contact } }))).status).toBe(200);
  });

  it("applies the bot checks of C45, each byte-identical to a malformed body and writing nothing", async () => {
    const v = await makeVenue();
    const other = await makeVenue();
    const before = await footprint(v.id);
    const malformed = await snapshot(await join(v.key, "{not json"));
    const used = challengeFor(v.key);
    expect((await join(v.key, joinBody(v, { challenge: used, solution: solve(used) }))).status).toBe(200);
    const fresh = challengeFor(v.key);
    const foreign = challengeFor(other.key);
    const cases = [
      joinBody(v, { honeypot: "bot" }),
      joinBody(v, { honeypot: 0 }),
      joinBody(v, { challenge: undefined }),
      joinBody(v, { solution: undefined }),
      joinBody(v, { challenge: { ...fresh, signature: `${fresh.signature.slice(0, -2)}AA` }, solution: solve(fresh) }),
      joinBody(v, { challenge: { ...fresh, difficulty: 1 }, solution: solve(fresh) }),
      joinBody(v, { challenge: challengeFor(v.key, Date.now()), solution: "0" }),
      joinBody(v, { challenge: challengeFor(v.key, Date.now() - 31 * 60_000), solution: "0" }),
      joinBody(v, { challenge: foreign, solution: solve(foreign) }),
      joinBody(v, { challenge: used, solution: solve(used) }),
      joinBody(v, { captchaToken: 5 }),
    ];
    for (const body of cases) {
      const res = await snapshot(await join(v.key, body));
      expect(res).toEqual(malformed);
    }
    expect(await footprint(v.id)).toEqual({ ...before, waitlist: 1, links: 1, keys: 1 });
  });

  it("refuses a challenge whose nonce a public create used", async () => {
    const v = await makeVenue();
    const challenge = challengeFor(v.key);
    const create = await app.request(`/v1/public/${v.key}/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ date: ahead(10), time: "20:00", partySize: 2, guest: { name: "Ana", contact: nextContact() }, challenge, solution: solve(challenge) }),
    });
    expect(create.status).toBe(200);
    await expectInvalid(await join(v.key, joinBody(v, { challenge, solution: solve(challenge) })));
  });

  it("answers an unknown, malformed, rotated or disabled key with the 404 of the config route", async () => {
    const v = await makeVenue();
    const rotated = await makeVenue();
    const oldKey = rotated.key;
    await app.request(`/v1/venues/${rotated.id}/online-booking/rotate-key`, { method: "POST", headers: { apikey: rotated.admin } });
    const disabled = await makeVenue();
    await putOnline(disabled.id, disabled.admin, { enabled: false });
    const reference = await snapshot(await app.request("/v1/public/pk_AAAAAAAAAAAAAAAAAAAAAA"));
    expect(reference.status).toBe(404);
    for (const key of ["pk_AAAAAAAAAAAAAAAAAAAAAA", "nope", oldKey, disabled.key]) {
      expect(await snapshot(await join(key, joinBody(v)))).toEqual(reference);
    }
  });

  it("answers the same with a staff cookie or an apikey, sets no cookie and sends no-store on every answer", async () => {
    const v = await makeVenue();
    const bad = joinBody(v, { emailConsent: false });
    const plain = await snapshot(await join(v.key, bad));
    expect(plain.headers).toContainEqual(["cache-control", "no-store"]);
    for (const headers of [{ apikey: v.admin }, { cookie: "better-auth.session_token=abc" }]) {
      expect(await snapshot(await join(v.key, bad, crypto.randomUUID(), headers))).toEqual(plain);
    }
    const ok = await join(v.key, joinBody(v), crypto.randomUUID(), { apikey: v.admin });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toBeNull();
    expect(ok.headers.get("access-control-allow-origin")).toBeNull();
    const closed = await join(v.key, joinBody(v, { date: addDays(today(), -1) }));
    expect(closed.headers.get("cache-control")).toBe("no-store");
  });

  it("answers the join, the read and the leave alike with a real staff session cookie (C40)", async () => {
    const v = await makeVenue();
    const signUp = await auth.api.signUpEmail({
      body: { name: "Staff", email: `wl-staff-${Date.now()}@example.com`, password: "password123" },
      asResponse: true,
    });
    const cookie = signUp.headers.get("set-cookie")!.split(";")[0]!;
    const bad = joinBody(v, { guest: { name: "Ana", contact: "+34 600 123 456" } });
    expect(await snapshot(await join(v.key, bad, crypto.randomUUID(), { cookie }))).toEqual(await snapshot(await join(v.key, bad)));
    const res = await join(v.key, joinBody(v), crypto.randomUUID(), { cookie, apikey: v.admin });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    const { waitlistToken } = await res.json();
    expect(await snapshot(await readEntry(waitlistToken, { cookie }))).toEqual(await snapshot(await readEntry(waitlistToken)));
    const key = crypto.randomUUID();
    const left = await snapshot(await leave(waitlistToken, key, { cookie, apikey: v.admin }));
    expect(left.status).toBe(200);
    expect(await snapshot(await leave(waitlistToken, key))).toEqual(left);
    expect(left.headers.map(([name]) => name)).not.toContain("set-cookie");
  });

  it("holds no id, source, name, count or full contact in any answer", async () => {
    const v = await makeVenue();
    const contact = nextContact("scan");
    const { answer, entryId } = await joined(v, { guest: { name: "Zebulon Quark", contact } });
    const answers = [
      JSON.stringify(answer),
      await (await join(v.key, joinBody(v, { guest: { name: "Zebulon Quark", contact } }))).text(),
      await (await join(v.key, joinBody(v, { date: addDays(today(), -3) }))).text(),
      await (await readEntry(answer.waitlistToken)).text(),
    ];
    expect(answer.waitlistToken).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    for (const raw of answers) {
      const text = withoutToken(raw);
      for (const leak of [entryId, v.id, "widget", "Zebulon", contact, "T0", "dinner", "consent", "source", "zone", "reservationId"]) {
        expect(text).not.toContain(leak);
      }
    }
  });

  it("scans an answer for leaks without the join's random token, which can hold any short string", () => {
    const answer = JSON.stringify({ waitlistToken: "00000000-0000-0000-0000-00000000000T0.zoneAAAAT0QMdinner", entry: { status: "waiting" } });
    expect(answer).toContain("T0");
    expect(withoutToken(answer)).not.toContain("T0");
    expect(withoutToken(answer)).not.toContain("zone");
    expect(withoutToken(answer)).toContain("waiting");
    expect(withoutToken(JSON.stringify({ error: { code: "T0" } }))).toContain("T0");
    expect(withoutToken("not json")).toBe("not json");
  });

  it("refuses a body over 16 KB with invalid_request", async () => {
    const v = await makeVenue();
    const res = await join(v.key, JSON.stringify({ ...joinBody(v), honeypot: "x".repeat(17 * 1024) }));
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("C70 consent, contact and the join email", () => {
  it("needs an email contact and emailConsent true, and sends nothing on a refusal", async () => {
    const v = await makeVenue();
    const before = await footprint(v.id);
    const sent = mail.sent.length;
    for (const contact of ["+34 600 123 456", "600123456", "not-an-email@", "ana@", "@example.com", "ana example.com"]) {
      await expectInvalid(await join(v.key, joinBody(v, { guest: { name: "Ana", contact } })));
    }
    for (const emailConsent of [undefined, false, null, "true", 1, "yes", {}]) {
      await expectInvalid(await join(v.key, joinBody(v, { emailConsent })));
    }
    await settle();
    expect(await footprint(v.id)).toEqual(before);
    expect(mail.sent.length).toBe(sent);
  });

  it("stores the consent time by the database clock and records no other consent", async () => {
    const v = await makeVenue();
    const contact = nextContact();
    const [{ before }] = (await db.execute(sql`select now() as before`)).rows as { before: Date }[];
    const { entryId } = await joined(v, { guest: { name: "Ana", contact } });
    const [{ after }] = (await db.execute(sql`select now() as after`)).rows as { after: Date }[];
    const [row] = await db.select().from(waitlist).where(eq(waitlist.id, entryId));
    expect(row!.consentAt).not.toBeNull();
    expect(row!.consentAt!.getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    expect(row!.consentAt!.getTime()).toBeLessThanOrEqual(new Date(after).getTime());
    // No guest record and no marketing consent: a later booking for the contact reads consent unknown (C14).
    expect(await db.select().from(guests).where(eq(guests.venueId, v.id))).toEqual([]);
    const booked = await staff(v, "POST", "/reservations", { date: ahead(10), time: "20:00", partySize: 2, guest: { name: "Ana", contact } });
    expect(booked.status).toBe(200);
    expect((await booked.json()).guest.consent).toBe("unknown");
  });

  it("sends one email after the commit with the venue, date, window, party and leave link, and no guest name", async () => {
    const v = await makeVenue();
    const contact = nextContact();
    const date = ahead(12);
    const { token } = await joined(v, { date, partySize: 3, window: { from: "20:30", to: "22:00" }, guest: { name: "Bartolomeo", contact } });
    await settle();
    const mails = mailTo(contact);
    expect(mails).toHaveLength(1);
    const [m] = mails;
    const all = `${m!.subject}\n${m!.text}\n${m!.html}`;
    expect(all).toContain(v.name);
    expect(m!.text).toContain(formatEmailDay(date, "es"));
    expect(m!.text).toContain("20:30–22:00");
    expect(m!.text).toContain("3");
    expect(m!.text).toContain(`/r/waitlist?lang=es#${token}`);
    expect(all).not.toContain("Bartolomeo");
    // A refused join and a repeat send nothing.
    await join(v.key, joinBody(v, { date, guest: { name: "Ana", contact } }));
    await settle();
    expect(mailTo(contact)).toHaveLength(1);
  });

  it("writes the text and the link's lang from the join's locale, then the venue's (C67)", async () => {
    const v = await makeVenue({ settings: { locale: "fr" } });
    const en = nextContact();
    const { token: enToken } = await joined(v, { locale: "en", guest: { name: "Ana", contact: en } });
    const none = nextContact();
    const { token: frToken } = await joined(v, { guest: { name: "Ana", contact: none } });
    await settle();
    // Only the es catalog ships, so both texts are es; the links carry the requested language.
    expect(mailTo(en)[0]!.text).toContain(`/r/waitlist?lang=en#${enToken}`);
    expect(mailTo(none)[0]!.text).toContain(`/r/waitlist?lang=fr#${frToken}`);
    expect(mailTo(en)[0]!.text).toContain("lista de espera");
    // The entry stores no language.
    expect(Object.keys((await db.select().from(waitlist).limit(1))[0]!)).not.toContain("locale");
  });

  it("answers the same and keeps the entry and link when the send fails, and never logs the token", async () => {
    const v = await makeVenue();
    const contact = nextContact();
    mail.failFor.add(contact);
    const logs: string[] = [];
    for (const method of ["error", "warn", "log", "info"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
    }
    const { answer, token, entryId } = await joined(v, { guest: { name: "Ana", contact } });
    await settle();
    expect(answer.waitlistToken).toMatch(TOKEN);
    expect(answer.entry.status).toBe("waiting");
    expect((await db.select().from(waitlist).where(eq(waitlist.id, entryId)))).toHaveLength(1);
    expect((await readEntry(token)).status).toBe(200);
    expect(logs.some((l) => l.includes("waitlist_join"))).toBe(true);
    for (const line of logs) expect(line).not.toContain(token.split(".")[1]!);
  });

  it("sends ten emails for ten joins by ten contacts on ten dates", async () => {
    const v = await makeVenue();
    const contacts = Array.from({ length: 10 }, () => nextContact("ten"));
    for (const [i, contact] of contacts.entries()) await joined(v, { date: ahead(2 + i), guest: { name: "Ana", contact } });
    await settle();
    for (const contact of contacts) expect(mailTo(contact)).toHaveLength(1);
  });
});

describe("C71 waitlist caps and waitlist_unavailable", () => {
  it("holds 2 open public entries per contact in a venue, the same contact in any case or spacing", async () => {
    const v = await makeVenue();
    const contact = nextContact();
    await joined(v, { date: ahead(3), guest: { name: "Ana", contact } });
    await joined(v, { date: ahead(4), guest: { name: "Ana", contact: `  ${contact.toUpperCase()} ` } });
    const before = await footprint(v.id);
    await expectUnavailable(await join(v.key, joinBody(v, { date: ahead(5), guest: { name: "Ana", contact } })));
    expect(await footprint(v.id)).toEqual(before);
    // Another venue is untouched.
    const other = await makeVenue();
    expect((await join(other.key, joinBody(other, { date: ahead(5), guest: { name: "Ana", contact } }))).status).toBe(200);
  });

  it("holds 1 per contact per date, and a cap on one date does not stop another", async () => {
    const v = await makeVenue();
    const contact = nextContact();
    await joined(v, { date: ahead(3), guest: { name: "Ana", contact } });
    await expectUnavailable(await join(v.key, joinBody(v, { date: ahead(3), guest: { name: "Eva", contact } })));
    expect((await join(v.key, joinBody(v, { date: ahead(4), guest: { name: "Ana", contact } }))).status).toBe(200);
  });

  it("holds 50 open public entries per date in a venue", async () => {
    const v = await makeVenue();
    const date = ahead(6);
    for (let i = 0; i < WAITLIST_CAPS.perDate; i++) await joined(v, { date });
    await expectUnavailable(await join(v.key, joinBody(v, { date })));
    expect((await join(v.key, joinBody(v, { date: ahead(7) }))).status).toBe(200);
    // A staff add is never refused by the caps, and does not count.
    expect((await staff(v, "POST", "/waitlist", { partySize: 2, guest: { name: "Staff", contact: nextContact() } })).status).toBe(201);
  });

  it("does not count cancelled, left, seated, past, staff or other venues' entries", async () => {
    const v = await makeVenue();
    const contact = nextContact();
    const guest = { name: "Ana", contact };
    const left = await joined(v, { date: ahead(3), guest });
    const cancelled = await joined(v, { date: ahead(4), guest });
    await expectUnavailable(await join(v.key, joinBody(v, { date: ahead(5), guest })));
    expect((await leave(left.token)).status).toBe(200);
    expect((await staff(v, "POST", `/waitlist/${cancelled.entryId}/cancel`)).status).toBe(200);
    const seated = await joined(v, { date: ahead(3), guest });
    const past = await joined(v, { date: ahead(4), guest });
    await db.update(waitlist).set({ status: "seated" }).where(eq(waitlist.id, seated.entryId));
    await db.update(waitlist).set({ date: addDays(today(), -1) }).where(eq(waitlist.id, past.entryId));
    await staff(v, "POST", "/waitlist", { partySize: 2, guest });
    const other = await makeVenue();
    await joined(other, { date: ahead(3), guest });
    await joined(v, { date: ahead(3), guest });
    await joined(v, { date: ahead(4), guest });
    await expectUnavailable(await join(v.key, joinBody(v, { date: ahead(5), guest })));
  });

  it("answers every cap byte for byte like a closed date, the waitlist off and email off", async () => {
    const v = await makeVenue();
    const contact = nextContact();
    await joined(v, { date: ahead(3), guest: { name: "Ana", contact } });
    await joined(v, { date: ahead(4), guest: { name: "Ana", contact } });
    const overContact = await snapshot(await join(v.key, joinBody(v, { date: ahead(5), guest: { name: "Ana", contact } })));
    const overDate = await snapshot(await join(v.key, joinBody(v, { date: ahead(3), guest: { name: "Ana", contact } })));
    const closed = await snapshot(await join(v.key, joinBody(v, { date: addDays(today(), -1) })));
    const off = await makeVenue({ settings: { waitlistEnabled: false } });
    const waitlistOff = await snapshot(await join(off.key, joinBody(off)));
    const mailOff = await makeVenue();
    await db.update(venues).set({ notificationsEnabled: false }).where(eq(venues.id, mailOff.id));
    const emailOff = await snapshot(await join(mailOff.key, joinBody(mailOff)));
    for (const answer of [overDate, closed, waitlistOff, emailOff]) expect(answer).toEqual(overContact);
    expect(overContact.status).toBe(409);
  });

  it("never passes a cap under concurrent joins", async () => {
    const v = await makeVenue();
    const contact = nextContact();
    const dates = Array.from({ length: 8 }, (_, i) => ahead(2 + i));
    const manyDates = await Promise.all(dates.map((date) => join(v.key, joinBody(v, { date, guest: { name: "Ana", contact } }))));
    expect(manyDates.filter((r) => r.status === 200)).toHaveLength(2);
    expect(manyDates.filter((r) => r.status === 409)).toHaveLength(6);

    const one = nextContact();
    const oneDate = await Promise.all(dates.map(() => join(v.key, joinBody(v, { date: ahead(11), guest: { name: "Ana", contact: one } }))));
    expect(oneDate.filter((r) => r.status === 200)).toHaveLength(1);

    const w = await makeVenue();
    const crowd = await Promise.all(Array.from({ length: 60 }, () => join(w.key, joinBody(w, { date: ahead(8) }))));
    expect(crowd.filter((r) => r.status === 200)).toHaveLength(WAITLIST_CAPS.perDate);
    expect(crowd.filter((r) => r.status === 409)).toHaveLength(10);
    const open = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(waitlist)
      .where(and(eq(waitlist.venueId, w.id), eq(waitlist.date, ahead(8))));
    expect(open[0]!.n).toBe(WAITLIST_CAPS.perDate);
  });

  it("neither counts toward nor is counted by the public create's caps", async () => {
    const v = await makeVenue({ settings: { maxOpenBookingsPerContact: 1 } });
    const contact = nextContact();
    await joined(v, { date: ahead(3), guest: { name: "Ana", contact } });
    await joined(v, { date: ahead(4), guest: { name: "Ana", contact } });
    const challenge = challengeFor(v.key);
    const create = await app.request(`/v1/public/${v.key}/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ date: ahead(5), time: "20:00", partySize: 2, guest: { name: "Ana", contact }, challenge, solution: solve(challenge) }),
    });
    expect(create.status).toBe(200);
    const w = await makeVenue({ settings: { maxOpenBookingsPerContact: 1 } });
    const c2 = nextContact();
    const c = challengeFor(w.key);
    await app.request(`/v1/public/${w.key}/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ date: ahead(5), time: "20:00", partySize: 2, guest: { name: "Ana", contact: c2 }, challenge: c, solution: solve(c) }),
    });
    expect((await join(w.key, joinBody(w, { date: ahead(5), guest: { name: "Ana", contact: c2 } }))).status).toBe(200);
  });
});

describe("C72 guest blocklist on the public join", () => {
  async function blockContact(v: Venue, contact: string, key = blocklistKeys.current) {
    await insertBlocklistEntry(db, v.id, blocklistHash(key, v.id, normalizeContact(contact, null)!), { reason: null, createdBy: "admin" });
  }

  it("declines a blocked contact last, with the create's body, leaving no entry, link, key or email", async () => {
    const v = await makeVenue();
    const contact = nextContact();
    await blockContact(v, contact.toUpperCase());
    const before = await footprint(v.id);
    const key = crypto.randomUUID();
    const body = joinBody(v, { guest: { name: "Ana", contact } });
    const res = await join(v.key, body, key);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "booking_declined", message: "booking_declined", retryable: false });
    await settle();
    expect(await footprint(v.id)).toEqual(before);
    expect(mailTo(contact)).toHaveLength(0);
    // Once an admin removes the entry, the same key joins.
    await db.execute(sql`delete from guest_blocklist where venue_id = ${v.id}`);
    expect((await join(v.key, body, key)).status).toBe(200);
  });

  it("matches an entry under the previous key during a rotation", async () => {
    const v = await makeVenue();
    const contact = nextContact();
    expect(blocklistKeys.previous).not.toBeNull();
    await blockContact(v, contact, blocklistKeys.previous!);
    expect((await join(v.key, joinBody(v, { guest: { name: "Ana", contact } }))).status).toBe(409);
  });

  it("gives a blocked contact the ordinary answer wherever the join would fail anyway", async () => {
    const v = await makeVenue();
    const contact = nextContact();
    const guest = { name: "Ana", contact };
    const made = [await joined(v, { date: ahead(3), guest }), await joined(v, { date: ahead(4), guest })];
    await blockContact(v, contact);
    // Entries already made are not changed.
    for (const m of made) expect((await (await readEntry(m.token)).json()).status).toBe("waiting");
    await expectUnavailable(await join(v.key, joinBody(v, { date: ahead(5), guest })));
    await expectUnavailable(await join(v.key, joinBody(v, { date: addDays(today(), -1), guest })));
    await expectInvalid(await join(v.key, joinBody(v, { guest, emailConsent: false })));
    await expectInvalid(await join(v.key, joinBody(v, { guest, honeypot: "x" })));
    const off = await makeVenue({ settings: { waitlistEnabled: false } });
    await blockContact(off, contact);
    await expectUnavailable(await join(off.key, joinBody(off, { guest })));
    // A phone on the list: a phone contact is refused as any phone is.
    await blockContact(v, "+34600123456");
    await expectInvalid(await join(v.key, joinBody(v, { guest: { name: "Ana", contact: "+34 600 123 456" } })));
  });

  it("never lets another venue's entry refuse, and a staff add is not checked", async () => {
    const a = await makeVenue();
    const b = await makeVenue();
    const contact = nextContact();
    await blockContact(a, contact);
    expect((await join(b.key, joinBody(b, { guest: { name: "Ana", contact } }))).status).toBe(200);
    expect((await staff(a, "POST", "/waitlist", { partySize: 2, guest: { name: "Ana", contact } })).status).toBe(201);
  });
});

describe("C73 public waitlist idempotency", () => {
  it("needs a UUID key", async () => {
    const v = await makeVenue();
    const before = await footprint(v.id);
    for (const key of [null, "", "abc", "123e4567-e89b-12d3-a456-42661417400", "public:0f8fad5b-d9cb-469f-a165-70867728950e"]) {
      await expectInvalid(await join(v.key, joinBody(v), key));
    }
    expect(await footprint(v.id)).toEqual(before);
  });

  it("replays a repeat with the same entry and no token, adding, minting and sending nothing", async () => {
    const v = await makeVenue();
    const contact = nextContact();
    const first = await joined(v, { guest: { name: "Ana", contact } });
    await settle();
    const before = await footprint(v.id);
    // The challenge is spent, and then too old: the repeat still replays.
    const again = await join(v.key, first.body, first.key);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ entry: first.answer.entry, waitlistToken: null });
    const old = challengeFor(v.key, Date.now() - 40 * 60_000);
    const late = await join(v.key, { ...first.body, challenge: old, solution: "0" }, first.key.toUpperCase());
    expect(late.status).toBe(200);
    expect((await late.json()).waitlistToken).toBeNull();
    // A different body returns the first entry.
    const different = await join(v.key, joinBody(v, { date: ahead(20), partySize: 4 }), first.key);
    expect((await different.json()).entry).toEqual(first.answer.entry);
    await settle();
    expect(await footprint(v.id)).toEqual(before);
    expect(mailTo(contact)).toHaveLength(1);
    expect((await readEntry(first.token)).status).toBe(200);
    // The replay shows the entry as the guest now sees it.
    await staff(v, "POST", `/waitlist/${first.entryId}/cancel`);
    expect((await (await join(v.key, first.body, first.key)).json()).entry.status).toBe("cancelled");
  });

  it("makes one entry for concurrent joins with one key", async () => {
    const v = await makeVenue();
    const body = joinBody(v);
    const key = crypto.randomUUID();
    const answers = await Promise.all(Array.from({ length: 6 }, () => join(v.key, body, key)));
    expect(answers.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    const bodies = await Promise.all(answers.map((r) => r.json()));
    expect(new Set(bodies.map((b) => JSON.stringify(b.entry))).size).toBe(1);
    expect(bodies.filter((b) => b.waitlistToken !== null)).toHaveLength(1);
    expect((await footprint(v.id)).waitlist).toBe(1);
  });

  it("stores no key for a failed join, so the same key joins once the cause is gone", async () => {
    const v = await makeVenue({ settings: { waitlistEnabled: false } });
    const body = joinBody(v);
    const key = crypto.randomUUID();
    await expectUnavailable(await join(v.key, body, key));
    await putOnline(v.id, v.admin, { waitlistEnabled: true });
    expect((await join(v.key, body, key)).status).toBe(200);
  });

  it("keeps the kinds apart: create, join, guest modify and cancel, and leave never replay each other", async () => {
    const v = await makeVenue();
    const challenge = challengeFor(v.key);
    const createKey = crypto.randomUUID();
    const createBody = { date: ahead(10), time: "20:00", partySize: 2, guest: { name: "Ana", contact: nextContact() }, challenge, solution: solve(challenge) };
    const create = (key: string) =>
      app.request(`/v1/public/${v.key}/reservations`, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(createBody),
      });
    const created = await create(createKey);
    expect(created.status).toBe(200);
    const booking = (await created.json()).selfServiceToken as string;
    const before = await footprint(v.id);
    await expectInvalid(await join(v.key, joinBody(v), createKey));
    expect(await footprint(v.id)).toEqual(before);

    const first = await joined(v);
    await expectInvalid(await create(first.key));
    const modify = await app.request("/v1/public/self-service/modify", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Self-Service-Token": booking, "Idempotency-Key": first.key },
      body: JSON.stringify({ version: 1, partySize: 3 }),
    });
    await expectInvalid(modify);
    const cancel = await app.request("/v1/public/self-service/cancel", {
      method: "POST",
      headers: { "X-Self-Service-Token": booking, "Idempotency-Key": first.key },
    });
    await expectInvalid(cancel);
    await expectInvalid(await leave(first.token, first.key));
    expect((await (await readEntry(first.token)).json()).status).toBe("waiting");

    const second = await joined(v);
    const leaveKey = crypto.randomUUID();
    expect((await leave(second.token, leaveKey)).status).toBe(200);
    const mid = await footprint(v.id);
    await expectInvalid(await join(v.key, joinBody(v), leaveKey));
    expect(await footprint(v.id)).toEqual(mid);
  });

  it("keeps public keys apart from staff keys, and keys of two venues apart", async () => {
    const v = await makeVenue();
    const w = await makeVenue();
    const key = crypto.randomUUID();
    expect((await staff(v, "POST", "/waitlist", { partySize: 2 }, key)).status).toBe(201);
    expect((await join(v.key, joinBody(v), key)).status).toBe(200);
    expect((await join(w.key, joinBody(w), key)).status).toBe(200);
    expect(await entriesOf(v.id)).toHaveLength(2);
    expect(await entriesOf(w.id)).toHaveLength(1);
  });
});
