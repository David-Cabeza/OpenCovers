import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, gt, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => {
  process.env.PUBLIC_CHALLENGE_SECRET = "test-secret-for-the-public-past-bookings-1234";
  process.env.PUBLIC_POW_DIFFICULTY = "0";
  return [] as { to: string; subject: string; text: string }[];
});

vi.mock("../src/lib/mailer", async (original) => ({
  ...(await original<typeof import("../src/lib/mailer")>()),
  sendEmail: async (_key: string, _from: string, to: string, subject: string, text: string) => {
    sent.push({ to, subject, text });
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
import { addDays, localDateTime, toTimestamp } from "../src/lib/time";
import { widgetCsp } from "../src/lib/widget-page";

const REAL_START = Date.now();
const config = challengeConfigFromEnv();
const today = () => localDateTime(new Date(), "Europe/Madrid").date;
const ahead = (days: number) => addDays(today(), days);
const NEAR = ahead(30);

beforeAll(async () => {
  const dist = mkdtempSync(path.join(tmpdir(), "oc-widget-past-"));
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
  const id = `pa-${venueCount}`;
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
  const challenge = issueChallenge(config, bookingKey, REAL_START - 10_000);
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


const NOW_TIME = "21:00";
const setClock = () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(toTimestamp(today(), NOW_TIME, "Europe/Madrid"));
};
afterEach(() => vi.useRealTimers());

function staff(v: Venue, path: string, payload: unknown) {
  return app.request(`/v1/venues/${v.id}${path}`, {
    method: "POST",
    headers: { apikey: v.admin, "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(payload),
  });
}

async function times(v: Venue, date: string, partySize = 2) {
  const res = await app.request(`/v1/public/${v.key}/availability?date=${date}&partySize=${partySize}`);
  expect(res.status).toBe(200);
  return (await res.json()) as { times: string[]; reason: string | null };
}

describe("public channel never takes a start in the past (C62)", () => {
  it("a past date lists nothing, with reason past_date", async () => {
    const v = await makeVenue();
    expect(await times(v, "2020-01-01")).toMatchObject({ times: [], reason: "past_date" });
    expect(await times(v, addDays(today(), -1))).toMatchObject({ times: [], reason: "past_date" });
  });

  it("refuses a create on a past date and writes nothing", async () => {
    const v = await makeVenue();
    const res = await publicCreate(v.key, createBody(v.key, { date: "2020-01-01", time: "20:00" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("lead_time_violation");
    expect(await db.select().from(reservations).where(eq(reservations.venueId, v.id))).toHaveLength(0);
  });

  it("today: slots before now are not listed and not bookable, later ones are", async () => {
    setClock();
    const v = await makeVenue();
    const listed = await times(v, today());
    expect(listed.reason).toBeNull();
    expect(listed.times.length).toBeGreaterThan(0);
    expect(listed.times.every((t) => t >= NOW_TIME)).toBe(true);
    const early = await publicCreate(v.key, createBody(v.key, { date: today(), time: "20:00" }));
    expect(early.status).toBe(400);
    expect((await early.json()).code).toBe("lead_time_violation");
    const later = await publicCreate(v.key, createBody(v.key, { date: today(), time: listed.times[0] }));
    expect(later.status).toBe(200);
  });

  it("a positive lead time still applies on top", async () => {
    setClock();
    const v = await makeVenue({ settings: { leadTimeMinutes: 90 } });
    const listed = await times(v, today());
    expect(listed.times.every((t) => t >= "22:30")).toBe(true);
    const res = await publicCreate(v.key, createBody(v.key, { date: today(), time: "22:00" }));
    expect((await res.json()).code).toBe("lead_time_violation");
  });

  it("a date past the horizon gives reason beyond_horizon, a free date has none", async () => {
    const v = await makeVenue({ settings: { maxAdvanceDays: 10 } });
    expect(await times(v, addDays(today(), 20))).toMatchObject({ times: [], reason: "beyond_horizon" });
    const ok = await times(v, addDays(today(), 3));
    expect(ok.times.length).toBeGreaterThan(0);
    expect(ok.reason).toBeNull();
  });

  it("the staff channel still takes a past booking and a walk-in", async () => {
    const v = await makeVenue();
    const created = await staff(v, "/reservations", {
      date: "2020-01-01",
      time: "20:00",
      partySize: 2,
      guest: { name: "Staff Entry", contact: nextContact() },
    });
    expect(created.status).toBe(200);
    const early = await staff(v, "/reservations/walk-in", { date: "2020-01-01", time: "20:30", partySize: 2, guest: { name: "Walk In", contact: nextContact() } });
    expect(early.status).toBe(200);
  });

  it("parallel public creates for one future slot still give one booking", async () => {
    const v = await makeVenue();
    await db.delete(tables).where(eq(tables.venueId, v.id));
    await db.insert(tables).values({ id: `${v.id}-solo`, venueId: v.id, name: "Solo", seats: 4 });
    const results = await Promise.all(
      [1, 2, 3].map(() => publicCreate(v.key, createBody(v.key, { date: NEAR, time: "21:00" }))),
    );
    const codes = await Promise.all(results.map(async (r) => (r.status === 200 ? "ok" : (await r.json()).code)));
    expect(codes.filter((c) => c === "ok")).toHaveLength(1);
    expect(codes.filter((c) => c === "slot_taken")).toHaveLength(2);
  });
});
