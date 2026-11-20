import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, gt, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => {
  process.env.PUBLIC_CHALLENGE_SECRET = "test-secret-for-the-public-hardening";
  process.env.PUBLIC_POW_DIFFICULTY = "0";
  return [] as { to: string; subject: string; text: string; html: string }[];
});

vi.mock("../src/lib/mailer", async (original) => ({
  ...(await original<typeof import("../src/lib/mailer")>()),
  sendEmail: async (_key: string, _from: string, to: string, subject: string, text: string, html = "") => {
    sent.push({ to, subject, text, html });
  },
}));

import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import {
  guests,
  reservations,
  selfServiceLinks,
  sentEmails,
  services,
  tables,
  venueOnlineBooking,
  venues,
} from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { GUEST_MODIFY_EMAILS } from "../src/lib/notifications";
import { challengeConfigFromEnv, issueChallenge, solve } from "../src/lib/public-challenge";
import { runRetention } from "../src/lib/retention";
import { findLink } from "../src/lib/self-service";
import { addDays, localDateTime } from "../src/lib/time";
import { widgetCsp } from "../src/lib/widget-page";

const config = challengeConfigFromEnv();
const today = () => localDateTime(new Date(), "Europe/Madrid").date;
const ahead = (days: number) => addDays(today(), days);
const NEAR = ahead(30);

beforeAll(async () => {
  const dist = mkdtempSync(path.join(tmpdir(), "oc-widget-hd-"));
  mkdirSync(path.join(dist, ".vite"));
  mkdirSync(path.join(dist, "assets"));
  writeFileSync(
    path.join(dist, ".vite", "manifest.json"),
    JSON.stringify({ "src/main.tsx": { file: "assets/main-H1.js", isEntry: true } }),
  );
  writeFileSync(path.join(dist, "assets", "main-H1.js"), "");
  process.env.WIDGET_DIST = dist;
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE events, tombstones, idempotency_keys, table_allocations, reservations, guests, guest_blocklist, grants, api_keys, services, tables, venue_online_booking, sent_emails, venues RESTART IDENTITY CASCADE`,
  );
});

interface Venue {
  id: string;
  admin: string;
  key: string;
}

let venueCount = 0;
async function makeVenue(
  opts: { venue?: Partial<typeof venues.$inferInsert>; settings?: Record<string, unknown> } = {},
): Promise<Venue> {
  venueCount += 1;
  const id = `hd-${venueCount}`;
  await db.insert(venues).values({ id, name: `Casa ${venueCount}`, timezone: "Europe/Madrid", ...opts.venue });
  await db.insert(services).values({ venueId: id, name: "dinner", openStart: "20:00", openEnd: "23:00" });
  await db.insert(tables).values([4, 4].map((s, i) => ({ id: `${id}-t${i}`, venueId: id, name: `T${i}`, seats: s })));
  const admin = `${id}-admin`;
  await addKey(db, admin, `admin-${id}`, [id], "admin");
  const res = await app.request(`/v1/venues/${id}/online-booking`, {
    method: "PUT",
    headers: { apikey: admin, "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, ...opts.settings }),
  });
  if (res.status !== 200) throw new Error(`enable failed: ${await res.text()}`);
  return { id, admin, key: (await res.json()).bookingKey };
}

let contacts = 0;
const nextContact = () => `hguest${++contacts}@example.com`;

function createBody(bookingKey: string, overrides: Record<string, unknown> = {}) {
  const challenge = issueChallenge(config, bookingKey, Date.now() - 10_000);
  return {
    date: NEAR,
    time: "20:00",
    partySize: 2,
    guest: { name: "Ana García", contact: nextContact() },
    challenge,
    solution: solve(challenge),
    ...overrides,
  };
}

function publicCreate(bookingKey: string, payload: unknown, key: string = crypto.randomUUID()) {
  return app.request(`/v1/public/${bookingKey}/reservations`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(payload),
  });
}

async function book(v: Venue, overrides: Record<string, unknown> = {}) {
  const createKey = crypto.randomUUID();
  const body = createBody(v.key, overrides);
  const res = await publicCreate(v.key, body, createKey);
  if (res.status !== 200) throw new Error(`create failed: ${await res.text()}`);
  const { selfServiceToken } = await res.json();
  const link = await findLink(db, selfServiceToken);
  return { id: link!.reservationId, token: selfServiceToken as string, createKey, body };
}

function modify(token: string, payload: unknown) {
  return app.request("/v1/public/self-service/modify", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Self-Service-Token": token },
    body: JSON.stringify(payload),
  });
}

function cancel(token: string) {
  return app.request("/v1/public/self-service/cancel", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID(), "X-Self-Service-Token": token },
  });
}

function staff(v: Venue, path: string, payload: unknown, method = "POST") {
  return app.request(`/v1/venues/${v.id}${path}`, {
    method,
    headers: { apikey: v.admin, "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(payload),
  });
}

async function confirmations(id: string) {
  await new Promise((resolve) => setTimeout(resolve, 150));
  return db
    .select({ version: sentEmails.version })
    .from(sentEmails)
    .where(and(eq(sentEmails.reservationId, id), eq(sentEmails.kind, "confirmation"), gt(sentEmails.version, 1)));
}

const mailing = { notificationsEnabled: true, noticeAddress: "venue@example.com", fromEmail: "venue@example.com" };

describe("guest modify emails are capped per reservation", () => {
  it("sends one confirmation for ten party toggles inside the window, and every modify succeeds", async () => {
    const v = await makeVenue({ venue: mailing });
    const b = await book(v);
    let version = 1;
    for (let i = 0; i < 10; i++) {
      const res = await modify(b.token, { version, partySize: i % 2 === 0 ? 3 : 2 });
      expect(res.status).toBe(200);
      version = (await res.json()).version;
    }
    expect(version).toBe(11);
    expect(await confirmations(b.id)).toHaveLength(1);
    const contact = (b.body.guest as { contact: string }).contact;
    expect(sent.filter((m) => m.to === contact)).toHaveLength(2);
  });

  it("sends again after the window, up to the per-reservation cap", async () => {
    const v = await makeVenue({ venue: mailing });
    const b = await book(v);
    let version = 1;
    for (let i = 0; i < GUEST_MODIFY_EMAILS.perReservation + 2; i++) {
      await db
        .update(sentEmails)
        .set({ createdAt: sql`now() - make_interval(mins => ${GUEST_MODIFY_EMAILS.intervalMinutes + 1})` })
        .where(eq(sentEmails.reservationId, b.id));
      const res = await modify(b.token, { version, partySize: i % 2 === 0 ? 3 : 2 });
      expect(res.status).toBe(200);
      version = (await res.json()).version;
      await confirmations(b.id);
    }
    expect(await confirmations(b.id)).toHaveLength(GUEST_MODIFY_EMAILS.perReservation);
  });

  it("sends nothing for a modify that changes nothing", async () => {
    const v = await makeVenue({ venue: mailing });
    const b = await book(v);
    await modify(b.token, { version: 1, commentary: "window seat" });
    const res = await modify(b.token, { version: 2, partySize: 2 });
    expect(res.status).toBe(200);
    expect(await confirmations(b.id)).toHaveLength(0);
  });

  it("leaves staff party changes uncapped", async () => {
    const v = await makeVenue({ venue: mailing });
    const b = await book(v);
    for (const partySize of [3, 2, 3]) {
      expect((await staff(v, `/reservations/${b.id}/modify`, { partySize })).status).toBe(200);
    }
    expect(await confirmations(b.id)).toHaveLength(3);
  });

  it("keeps the guest name out of guest-bound emails and in the venue notice", async () => {
    const v = await makeVenue({ venue: mailing });
    const contact = nextContact();
    const b = await book(v, { guest: { name: "Win a prize at https://evil.example", contact } });
    await cancel(b.token);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const toGuest = sent.filter((m) => m.to === contact);
    expect(toGuest.map((m) => m.subject).length).toBe(2);
    for (const mail of toGuest) expect(mail.text).not.toContain("evil.example");
    const toVenue = sent.filter((m) => m.to === "venue@example.com");
    for (const mail of toGuest) expect(mail.html).not.toContain("evil.example");
    expect(toVenue.some((m) => m.text.includes("evil.example") && m.html.includes("evil.example"))).toBe(true);
    for (const mail of toVenue) expect(mail.html).not.toMatch(/<a [^>]*evil\.example/);
  });
});

describe("public horizon and retention", () => {
  it("defaults the public horizon to 365 days when venue and online settings are null", async () => {
    const v = await makeVenue();
    expect((await publicCreate(v.key, createBody(v.key, { date: "9999-12-28" }))).status).toBe(400);
    const res = await publicCreate(v.key, createBody(v.key, { date: ahead(366) }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("beyond_booking_horizon");
    expect((await publicCreate(v.key, createBody(v.key, { date: ahead(365) }))).status).toBe(200);
    const cfg = await (await app.request(`/v1/public/${v.key}`)).json();
    expect(cfg.maxAdvanceDays).toBe(365);
  });

  it("lets an explicit horizon win, stricter or looser", async () => {
    const loose = await makeVenue({ settings: { maxAdvanceDays: 500 } });
    expect((await publicCreate(loose.key, createBody(loose.key, { date: ahead(400) }))).status).toBe(200);
    const strict = await makeVenue({ venue: { maxAdvanceDays: 10 }, settings: { maxAdvanceDays: 500 } });
    expect((await publicCreate(strict.key, createBody(strict.key, { date: ahead(11) }))).status).toBe(400);
  });

  it("answers 9999-12-31 with a client error on every route, never a 500", async () => {
    const v = await makeVenue({ settings: { maxAdvanceDays: 1000 } });
    expect((await publicCreate(v.key, createBody(v.key, { date: "9999-12-31", time: "22:00" }))).status).toBe(400);
    const created = await staff(v, "/reservations", { date: "9999-12-31", time: "22:00", partySize: 2 });
    expect(created.status).toBe(400);
    expect((await created.json()).code).toBe("invalid_request");
    const walkIn = await staff(v, "/reservations/walk-in", { date: "9999-12-31", time: "22:00", partySize: 2 });
    expect(walkIn.status).toBe(400);
    for (const date of ["9999-12-31", "0001-01-01", "2030-02-30", "abc"]) {
      for (const path of [
        `/availability?date=${date}&partySize=2`,
        `/availability/explain?date=${date}&time=22:00&partySize=2`,
        `/agenda?date=${date}`,
        `/pacing?date=${date}`,
        `/floor?date=${date}&time=22:00`,
      ]) {
        const res = await app.request(`/v1/venues/${v.id}${path}`, { headers: { apikey: v.admin } });
        expect([path, res.status]).toEqual([path, 400]);
      }
      const avail = await app.request(`/v1/public/${v.key}/availability?date=${date}&partySize=2`);
      expect(avail.status).toBe(400);
    }
  });

  it("does not let a stranger's future booking, cancelled, keep a guest from retention", async () => {
    const v = await makeVenue({ settings: { maxAdvanceDays: 1000 } });
    const contact = nextContact();
    const first = await staff(v, "/reservations", { date: NEAR, time: "20:00", partySize: 2, guest: { name: "Real", contact } });
    const { id: realId } = await first.json();
    const old = new Date("2020-01-01T20:00:00Z");
    await db
      .update(reservations)
      .set({ startsAt: old, endsAt: new Date(old.getTime() + 7_200_000), date: "2020-01-01" })
      .where(eq(reservations.id, realId));
    const [{ guestId }] = await db.select({ guestId: reservations.guestId }).from(reservations).where(eq(reservations.id, realId));
    await db.update(guests).set({ lastVisitAt: old }).where(eq(guests.id, guestId!));

    const stranger = await book(v, { date: ahead(300), guest: { name: "Stranger", contact } });
    const [guest] = await db.select().from(guests).where(eq(guests.id, guestId!));
    expect(guest.lastVisitAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect((await cancel(stranger.token)).status).toBe(200);

    await db.update(guests).set({ lastVisitAt: old }).where(eq(guests.id, guestId!));
    await db.update(venues).set({ retentionDays: 30 }).where(eq(venues.id, v.id));
    await runRetention(db);
    const [after] = await db.select().from(guests).where(eq(guests.id, guestId!));
    expect(after.email).toBeNull();
    const [cancelled] = await db.select().from(reservations).where(eq(reservations.id, stranger.id));
    expect(cancelled.erased).toBe(true);
  });
});

describe("erased bookings cannot be revived by a create replay", () => {
  it("refuses the replay of an erased booking's create key and mints no link", async () => {
    const v = await makeVenue();
    const b = await book(v);
    const [{ guestId }] = await db.select({ guestId: reservations.guestId }).from(reservations).where(eq(reservations.id, b.id));
    expect((await staff(v, "/erasure", { guestId })).status).toBe(200);
    const replay = await publicCreate(v.key, b.body, b.createKey);
    const text = await replay.text();
    expect(replay.status).toBe(400);
    expect(JSON.parse(text).code).toBe("invalid_request");
    expect(await db.select().from(selfServiceLinks).where(eq(selfServiceLinks.reservationId, b.id))).toHaveLength(0);
    expect(text).toBe(JSON.stringify({ code: "invalid_request", message: "invalid_request", retryable: false }));
    expect(await db.select().from(reservations).where(eq(reservations.venueId, v.id))).toHaveLength(1);
  });

  it("refuses a staff reissue for an erased booking", async () => {
    const v = await makeVenue();
    const b = await book(v);
    await staff(v, "/erasure", { principal: "widget" });
    const res = await staff(v, `/reservations/${b.id}/self-service-link`, {});
    expect(res.status).toBe(409);
    expect(await db.select().from(selfServiceLinks).where(eq(selfServiceLinks.reservationId, b.id))).toHaveLength(0);
  });

  it("refuses the replay after retention erased the booking", async () => {
    const v = await makeVenue();
    const b = await book(v);
    const old = new Date("2020-01-01T20:00:00Z");
    await db
      .update(reservations)
      .set({ startsAt: old, endsAt: new Date(old.getTime() + 7_200_000), date: "2020-01-01" })
      .where(eq(reservations.id, b.id));
    await db.update(guests).set({ lastVisitAt: old });
    await db.update(venues).set({ retentionDays: 1 }).where(eq(venues.id, v.id));
    await runRetention(db);
    const replay = await publicCreate(v.key, b.body, b.createKey);
    expect(replay.status).toBe(400);
  });
});

describe("allowedOrigins are plain origins", () => {
  const put = (v: Venue, allowedOrigins: string[]) => staff(v, "/online-booking", { allowedOrigins }, "PUT");

  it("rejects values that are not exactly an https origin", async () => {
    const v = await makeVenue();
    for (const bad of [
      "https://a.example; script-src *",
      "https://a.example;",
      "https://a.example,https://b.example",
      "https://a'b.example",
      "https://a.example:443",
      "https://a.example/",
      "https://a_b.example",
      "https://a.example:99999",
    ]) {
      const res = await put(v, [bad]);
      expect(res.status, bad).toBe(400);
    }
    const ok = await put(v, ["https://Shop.Example:8443", "https://xn--caf-dma.example"]);
    expect(ok.status).toBe(200);
    expect((await ok.json()).allowedOrigins).toEqual(["https://shop.example:8443", "https://xn--caf-dma.example"]);
  });

  it("drops stored entries that are not safe CSP sources", async () => {
    expect(widgetCsp(["https://ok.example", "https://evil.example; script-src *", "https://a.example,x"])).toMatch(
      /frame-ancestors 'self' https:\/\/ok\.example$/,
    );
    expect(widgetCsp(["https://evil.example; script-src *"])).toMatch(/frame-ancestors 'none'$/);
    const v = await makeVenue();
    await db
      .update(venueOnlineBooking)
      .set({ allowedOrigins: ["https://ok.example", "https://evil.example; script-src 'unsafe-inline'"] })
      .where(eq(venueOnlineBooking.venueId, v.id));
    const page = await app.request(`/w/${v.key}`);
    expect(page.headers.get("content-security-policy")).toMatch(/frame-ancestors 'self' https:\/\/ok\.example$/);
  });
});
