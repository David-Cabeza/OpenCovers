import { formatEmailDate } from "../src/lib/email-messages";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => {
  process.env.PUBLIC_CHALLENGE_SECRET = "test-secret-for-the-lost-link-resend";
  process.env.PUBLIC_POW_DIFFICULTY = "0";
  return { sent: [] as { to: string; subject: string; text: string }[], failFor: new Set<string>() };
});

vi.mock("../src/lib/mailer", async (original) => ({
  ...(await original<typeof import("../src/lib/mailer")>()),
  sendEmail: async (_key: string, _from: string, to: string, subject: string, text: string) => {
    if (mail.failFor.has(to)) throw new Error(`Resend 422: could not send ${text}`);
    mail.sent.push({ to, subject, text });
  },
}));

import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { events, reservations, selfServiceLinks, sentEmails, services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { LINK_RESEND, RESEND_KIND } from "../src/lib/link-resend";
import { buildLinkEmail } from "../src/lib/mailer";
import { challengeConfigFromEnv, issueChallenge, solve } from "../src/lib/public-challenge";
import { addDays, localDateTime } from "../src/lib/time";

const config = challengeConfigFromEnv();
const ahead = (days: number) => addDays(localDateTime(new Date(), "Europe/Madrid").date, days);

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE events, tombstones, idempotency_keys, table_allocations, reservations, guests, guest_blocklist, grants, api_keys, services, tables, venue_online_booking, sent_emails, venues RESTART IDENTITY CASCADE`,
  );
});

afterEach(() => {
  mail.failFor.clear();
  vi.restoreAllMocks();
});

interface Venue {
  id: string;
  admin: string;
  key: string;
}

const mailing = { notificationsEnabled: true, resendApiKey: "re_test", fromEmail: "venue@example.com" };

let venueCount = 0;
async function makeVenue(venue: Partial<typeof venues.$inferInsert> = mailing): Promise<Venue> {
  venueCount += 1;
  const id = `lr-${venueCount}`;
  await db.insert(venues).values({ id, name: `Casa ${venueCount}`, timezone: "Europe/Madrid", ...venue });
  await db.insert(services).values({ venueId: id, name: "dinner", openStart: "20:00", openEnd: "23:00" });
  await db.insert(tables).values([0, 1, 2, 3, 4, 5, 6].map((i) => ({ id: `${id}-t${i}`, venueId: id, name: `T${i}`, seats: 4 })));
  const admin = `${id}-admin`;
  await addKey(db, admin, `admin-${id}`, [id], "admin");
  const res = await app.request(`/v1/venues/${id}/online-booking`, {
    method: "PUT",
    headers: { apikey: admin, "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, maxOpenBookingsPerContact: null }),
  });
  if (res.status !== 200) throw new Error(`enable failed: ${await res.text()}`);
  return { id, admin, key: (await res.json()).bookingKey };
}

let contacts = 0;
const nextContact = () => `Resend.Guest${++contacts}@Example.com`;

async function book(v: Venue, contact: string, date = ahead(30)) {
  const challenge = issueChallenge(config, v.key, Date.now() - 10_000);
  const createKey = crypto.randomUUID();
  const body = { date, time: "20:00", partySize: 2, guest: { name: "Ana", contact }, challenge, solution: solve(challenge) };
  const res = await app.request(`/v1/public/${v.key}/reservations`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": createKey },
    body: JSON.stringify(body),
  });
  if (res.status !== 200) throw new Error(`create failed: ${await res.text()}`);
  const { selfServiceToken } = await res.json();
  const [link] = await db
    .select({ reservationId: selfServiceLinks.reservationId })
    .from(selfServiceLinks)
    .where(eq(selfServiceLinks.id, selfServiceToken.split(".")[0]));
  return { id: link.reservationId, token: selfServiceToken as string, createKey, body };
}

function staff(v: Venue, path: string, payload: unknown) {
  return app.request(`/v1/venues/${v.id}${path}`, {
    method: "POST",
    headers: { apikey: v.admin, "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(payload),
  });
}

function resend(key: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(`/v1/public/${key}/self-service/resend`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const read = (token: string) => app.request("/v1/public/self-service", { headers: { "X-Self-Service-Token": token } });

const pause = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(probe: () => T | Promise<T>, ok: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 40; i++) {
    const value = await probe();
    if (ok(value)) return value;
    await pause(25);
  }
  throw new Error("timed out");
}

const tokensIn = (text: string) => [...text.matchAll(/\/r\?lang=[a-z]{2}#([0-9a-f-]{36}\.[A-Za-z0-9_-]{43})/g)].map((m) => m[1]);
/** The link emails sent to an address. A booking's own confirmation goes there too and is left out. */
const mailTo = (address: string) => mail.sent.filter((m) => m.to === address && tokensIn(m.text).length > 0);

async function snapshot(res: Response) {
  return { status: res.status, body: await res.text(), headers: [...res.headers.entries()] };
}

async function liveLinks(reservationId: string) {
  return db
    .select()
    .from(selfServiceLinks)
    .where(and(eq(selfServiceLinks.reservationId, reservationId), sql`${selfServiceLinks.revokedAt} is null`));
}

describe("the answer is the same whatever the address matches (C51)", () => {
  it("answers 202 with one body and one set of headers for a match, no match, email off, erased, cancelled and past", async () => {
    const v = await makeVenue();
    const off = await makeVenue({ notificationsEnabled: false, resendApiKey: "re_test", fromEmail: "venue@example.com" });
    const match = nextContact();
    await book(v, match);
    const offContact = nextContact();
    await book(off, offContact);
    const cancelled = nextContact();
    const c = await book(v, cancelled);
    expect((await staff(v, `/reservations/${c.id}/cancel`, {})).status).toBe(200);
    const erased = nextContact();
    const e = await book(v, erased);
    const [{ guestId }] = await db.select({ guestId: reservations.guestId }).from(reservations).where(eq(reservations.id, e.id));
    expect((await staff(v, "/erasure", { guestId })).status).toBe(200);
    const past = nextContact();
    const p = await book(v, past);
    const old = new Date(Date.now() - 86_400_000);
    await db
      .update(reservations)
      .set({ startsAt: old, endsAt: new Date(old.getTime() + 7_200_000) })
      .where(eq(reservations.id, p.id));

    const answers = [
      await snapshot(await resend(v.key, { email: match })),
      await snapshot(await resend(v.key, { email: "nobody@example.com" })),
      await snapshot(await resend(off.key, { email: offContact })),
      await snapshot(await resend(v.key, { email: cancelled })),
      await snapshot(await resend(v.key, { email: erased })),
      await snapshot(await resend(v.key, { email: past })),
    ];
    expect(answers[0]).toEqual({
      status: 202,
      body: JSON.stringify({ accepted: true }),
      headers: [
        ["cache-control", "no-store"],
        ["content-type", "application/json"],
      ],
    });
    for (const answer of answers) expect(answer).toEqual(answers[0]);
    await waitFor(() => mailTo(match).length, (n) => n === 1);
    await pause();
    for (const address of [offContact, cancelled, erased, past, "nobody@example.com"]) expect(mailTo(address)).toHaveLength(0);
    expect(await db.select().from(selfServiceLinks).where(eq(selfServiceLinks.reservationId, e.id))).toHaveLength(0);
    for (const unchanged of [c, p]) {
      expect((await liveLinks(unchanged.id)).map((l) => l.id)).toEqual([unchanged.token.split(".")[0]]);
    }
  });

  it("changes nothing with email off", async () => {
    const v = await makeVenue({ notificationsEnabled: false, resendApiKey: "re_test", fromEmail: "venue@example.com" });
    const contact = nextContact();
    const b = await book(v, contact);
    expect((await resend(v.key, { email: contact })).status).toBe(202);
    await pause();
    expect((await read(b.token)).status).toBe(200);
    expect(await db.select().from(sentEmails).where(eq(sentEmails.reservationId, b.id))).toHaveLength(0);
  });

  it("does not rotate when the venue has no way to send the email", async () => {
    const v = await makeVenue({ notificationsEnabled: true, fromEmail: "" });
    const contact = nextContact();
    const b = await book(v, contact);
    expect((await resend(v.key, { email: contact })).status).toBe(202);
    await pause();
    expect((await read(b.token)).status).toBe(200);
    expect(mailTo(contact)).toHaveLength(0);
  });
});

describe("a resend rotates the link and mails the stored address", () => {
  it("kills the old token, mails a working one to the address on the booking, and changes no version", async () => {
    const v = await makeVenue();
    const stored = nextContact();
    const b = await book(v, `  ${stored} `);
    expect((await resend(v.key, { email: `  ${stored.toLowerCase()}\t` })).status).toBe(202);
    const [message] = await waitFor(() => mailTo(stored), (m) => m.length === 1);
    const anyCase = mail.sent.filter((m) => m.to.toLowerCase().includes(stored.toLowerCase()) && tokensIn(m.text).length > 0);
    expect(anyCase).toEqual([message]);
    const [token] = tokensIn(message.text);
    expect(message.text).toContain("http://localhost:3000/r?lang=es#");
    expect(message.text).not.toContain("Ana");
    expect((await read(b.token)).status).toBe(404);
    const fresh = await read(token);
    expect(fresh.status).toBe(200);
    expect((await fresh.json()).version).toBe(1);
    expect(await liveLinks(b.id)).toHaveLength(1);
  });

  it("puts at most perEmail bookings in one email, the earliest first, and leaves the rest alone", async () => {
    const v = await makeVenue();
    const contact = nextContact();
    const booked = [];
    for (let day = LINK_RESEND.perEmail + 1; day >= 1; day--) booked.push({ day, ...(await book(v, contact, ahead(day))) });
    expect((await resend(v.key, { email: contact })).status).toBe(202);
    const [message] = await waitFor(() => mailTo(contact.trim()), (m) => m.length === 1);
    expect(tokensIn(message.text)).toHaveLength(LINK_RESEND.perEmail);
    const dates = [...message.text.matchAll(/^- (.+) a las /gm)].map((m) => m[1]);
    expect(dates).toEqual([1, 2, 3, 4, 5].map((d) => formatEmailDate(ahead(d), "es")));
    const latest = booked.find((b) => b.day === LINK_RESEND.perEmail + 1)!;
    expect((await read(latest.token)).status).toBe(200);
  });

  it("matches bookings staff made for the address, and never another venue's", async () => {
    const v = await makeVenue();
    const other = await makeVenue();
    const contact = nextContact();
    const made = await staff(v, "/reservations", { date: ahead(20), time: "21:00", partySize: 3, guest: { name: "Eva", contact } });
    expect(made.status).toBe(200);
    const elsewhere = await book(other, contact);
    expect((await resend(v.key, { email: contact })).status).toBe(202);
    const [message] = await waitFor(() => mailTo(contact), (m) => m.length === 1);
    expect(message.text).toContain(`${formatEmailDate(ahead(20), "es")} a las 21:00, 3 personas`);
    expect((await read(elsewhere.token)).status).toBe(200);
  });

  it("lets a replayed create rotate again after a resend (C44), so only the newest link works", async () => {
    const v = await makeVenue();
    const contact = nextContact();
    const b = await book(v, contact);
    await resend(v.key, { email: contact });
    const [message] = await waitFor(() => mailTo(contact), (m) => m.length === 1);
    const [emailed] = tokensIn(message.text);
    const replay = await app.request(`/v1/public/${v.key}/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": b.createKey },
      body: JSON.stringify(b.body),
    });
    expect(replay.status).toBe(200);
    const { selfServiceToken } = await replay.json();
    expect((await read(emailed)).status).toBe(404);
    expect((await read(selfServiceToken)).status).toBe(200);
    expect(await db.select().from(reservations).where(eq(reservations.venueId, v.id))).toHaveLength(1);
  });

  it("serializes with a guest cancel and modify on the same booking", async () => {
    const v = await makeVenue();
    const contact = nextContact();
    const b = await book(v, contact);
    const guestCall = (path: string, payload?: unknown) =>
      app.request(`/v1/public/self-service/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Self-Service-Token": b.token },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
    const answers = await Promise.all([
      guestCall("modify", { version: 1, commentary: "window" }),
      resend(v.key, { email: contact }),
      guestCall("cancel"),
    ]);
    for (const res of answers) expect([200, 202, 404, 409]).toContain(res.status);
    await pause(400);
    const [row] = await db.select().from(reservations).where(eq(reservations.id, b.id));
    expect(await liveLinks(b.id)).toHaveLength(row.status === "cancelled" ? 0 : 1);
    expect(mailTo(contact)).toHaveLength(row.status === "cancelled" ? 0 : 1);
  });
});

describe("caps keep the route from being a mail relay", () => {
  const ledger = (id: string) =>
    db.select().from(sentEmails).where(and(eq(sentEmails.reservationId, id), eq(sentEmails.kind, RESEND_KIND)));
  const age = (id: string) =>
    db
      .update(sentEmails)
      .set({ createdAt: sql`now() - make_interval(mins => ${LINK_RESEND.intervalMinutes + 1})` })
      .where(eq(sentEmails.reservationId, id));

  it("sends one email for ten concurrent resends of one address", async () => {
    const v = await makeVenue();
    const contact = nextContact();
    const b = await book(v, contact);
    const answers = await Promise.all(Array.from({ length: 10 }, () => resend(v.key, { email: contact.toUpperCase() })));
    expect(answers.map((r) => r.status)).toEqual(Array(10).fill(202));
    await waitFor(() => mailTo(contact), (m) => m.length === 1);
    await pause(400);
    expect(mailTo(contact)).toHaveLength(1);
    expect(await ledger(b.id)).toHaveLength(1);
    expect(await db.select().from(selfServiceLinks).where(eq(selfServiceLinks.reservationId, b.id))).toHaveLength(2);
    const [token] = tokensIn(mailTo(contact)[0].text);
    expect((await read(token)).status).toBe(200);
  });

  it("sends again after the interval, perReservation times at most, and keeps the last link after that", async () => {
    const v = await makeVenue();
    const contact = nextContact();
    const b = await book(v, contact);
    for (let i = 1; i <= LINK_RESEND.perReservation + 2; i++) {
      await age(b.id);
      await resend(v.key, { email: contact });
      await waitFor(() => ledger(b.id), (rows) => rows.length === Math.min(i, LINK_RESEND.perReservation));
      await pause(50);
    }
    await pause();
    const sent = mailTo(contact);
    expect(sent).toHaveLength(LINK_RESEND.perReservation);
    expect((await ledger(b.id)).map((r) => r.version).sort()).toEqual([1, 2, 3]);
    const [last] = tokensIn(sent.at(-1)!.text);
    expect((await read(last)).status).toBe(200);
  });

  it("sends nothing inside the interval, whatever the case or spacing of the address", async () => {
    const v = await makeVenue();
    const contact = nextContact();
    await book(v, contact);
    await resend(v.key, { email: contact });
    await waitFor(() => mailTo(contact), (m) => m.length === 1);
    await resend(v.key, { email: ` ${contact.toUpperCase()} ` });
    await pause();
    expect(mailTo(contact)).toHaveLength(1);
  });
});

describe("what the route refuses", () => {
  it("answers invalid_request for a body that is not one email, and sends nothing", async () => {
    const v = await makeVenue();
    const invalid = JSON.stringify({ code: "invalid_request", message: "invalid_request", retryable: false });
    for (const body of ["not json", "[]", {}, { email: 5 }, { email: "nope" }, { email: "+34 600 000 000" }, { email: `${"a".repeat(250)}@x.es` }]) {
      const res = await resend(v.key, body);
      expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 400]);
      expect(await res.text()).toBe(invalid);
    }
  });

  it("answers an unknown, malformed, rotated or disabled key with the public 404", async () => {
    const v = await makeVenue();
    const off = await makeVenue();
    await app.request(`/v1/venues/${off.id}/online-booking`, {
      method: "PUT",
      headers: { apikey: off.admin, "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    const rotated = await app.request(`/v1/venues/${v.id}/online-booking/rotate-key`, {
      method: "POST",
      headers: { apikey: v.admin },
    });
    expect(rotated.status).toBe(200);
    const reference = await snapshot(await app.request("/v1/public/pk_ZZZZZZZZZZZZZZZZZZZZZZ"));
    for (const key of ["pk_ZZZZZZZZZZZZZZZZZZZZZZ", "nope", v.key, off.key]) {
      const answer = await snapshot(await resend(key, { email: "a@example.com" }));
      expect(answer).toEqual(reference);
    }
    expect(reference.status).toBe(404);
  });

  it("refuses a body over 16 KB", async () => {
    const v = await makeVenue();
    const res = await resend(v.key, JSON.stringify({ email: "a@example.com" }) + " ".repeat(16 * 1024));
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("sends no CORS header and answers alike with staff credentials", async () => {
    const v = await makeVenue();
    const contact = nextContact();
    await book(v, contact);
    const plain = await snapshot(await resend(v.key, { email: contact }));
    const withCookie = await snapshot(
      await resend(v.key, { email: contact }, { cookie: "better-auth.session_token=x", origin: "https://evil.example" }),
    );
    const withKey = await snapshot(await resend(v.key, { email: contact }, { apikey: v.admin }));
    expect(withCookie).toEqual(plain);
    expect(withKey).toEqual(plain);
    expect(plain.headers.some(([name]) => name.startsWith("access-control-") || name === "set-cookie")).toBe(false);
  });
});

describe("tokens stay out of logs, events and the ledger", () => {
  it("logs no token when the send fails, and writes none to events or sent_emails", async () => {
    const v = await makeVenue();
    const contact = nextContact();
    const b = await book(v, contact);
    mail.failFor.add(contact);
    const logged: unknown[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(...args));
    }
    expect((await resend(v.key, { email: contact })).status).toBe(202);
    await waitFor(() => JSON.stringify(logged), (text) => text.includes("self_service_link failed"));
    const [link] = await liveLinks(b.id);
    expect(link.id).not.toBe(b.token.split(".")[0]);
    const text = JSON.stringify(logged);
    expect(text).toContain("self_service_link failed");
    expect(text).not.toContain(link.id);
    expect(text).not.toContain("/r?lang");
    const stored = JSON.stringify([
      ...(await db.select().from(events).where(eq(events.reservationId, b.id))),
      ...(await db.select().from(sentEmails).where(eq(sentEmails.reservationId, b.id))),
    ]);
    expect(stored).not.toContain(link.id);
    expect(stored).not.toContain(b.token.split(".")[0]);
  });
});

describe("the public config says whether the resend can send", () => {
  it("is true with email on and a way to send, false otherwise", async () => {
    const on = await makeVenue();
    const off = await makeVenue({ notificationsEnabled: false });
    expect((await (await app.request(`/v1/public/${on.key}`)).json()).linkResend).toBe(true);
    expect((await (await app.request(`/v1/public/${off.key}`)).json()).linkResend).toBe(false);
  });
});

describe("the resend follows each booking's stored locale (ADR-0024, C51, C67)", () => {
  const langs = (text: string) => [...text.matchAll(/\/r\?lang=([a-z]{2})#/g)].map((m) => m[1]);

  async function bookIn(v: Venue, contact: string, date: string, locale?: string) {
    const b = await book(v, contact, date);
    if (locale) await db.update(reservations).set({ guestLocale: locale }).where(eq(reservations.id, b.id));
    return b;
  }

  async function setLocale(v: Venue, locale: string) {
    const res = await app.request(`/v1/venues/${v.id}/online-booking`, {
      method: "PUT",
      headers: { apikey: v.admin, "content-type": "application/json" },
      body: JSON.stringify({ locale }),
    });
    expect(res.status).toBe(200);
  }

  it("gives each link its own booking's locale and writes the text of the earliest, falling back to es without a catalog", async () => {
    const v = await makeVenue();
    const contact = nextContact();
    await bookIn(v, contact, ahead(30), "en");
    await bookIn(v, contact, ahead(31), "fr");
    await bookIn(v, contact, ahead(32));
    expect((await resend(v.key, { email: contact }, { "accept-language": "de" })).status).toBe(202);
    const [message] = await waitFor(() => mailTo(contact), (m) => m.length === 1);
    expect(langs(message.text)).toEqual(["en", "fr", "es"]);
    // Only the es catalog ships, so the en text falls back to es.
    expect(message.subject).toBe(buildLinkEmail([], "es").subject);
  });

  it("uses the venue's locale for a booking with no stored locale, shipped catalog or not", async () => {
    const v = await makeVenue();
    await setLocale(v, "fr");
    const contact = nextContact();
    await bookIn(v, contact, ahead(30));
    await bookIn(v, contact, ahead(31), "pt");
    expect((await resend(v.key, { email: contact })).status).toBe(202);
    const [message] = await waitFor(() => mailTo(contact), (m) => m.length === 1);
    expect(langs(message.text)).toEqual(["fr", "pt"]);
  });
});
