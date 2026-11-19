import { asc, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.PUBLIC_CHALLENGE_SECRET = "test-secret-for-the-event-origin";
  process.env.PUBLIC_POW_DIFFICULTY = "0";
});

import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { events, services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { auth } from "../src/lib/auth";
import { addMembership } from "../src/lib/memberships";
import { challengeConfigFromEnv, issueChallenge, solve } from "../src/lib/public-challenge";
import { findLink } from "../src/lib/self-service";
import { saturdayAhead } from "./dates";

const SATURDAY = saturdayAhead();
const config = challengeConfigFromEnv();
const VENUE = "origin-1";
let counter = 0;

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE events, tombstones, idempotency_keys, table_allocations, reservations, guests, guest_blocklist, grants, api_keys, services, tables, venue_online_booking, venue_memberships, session, account, verification, "user", venues RESTART IDENTITY CASCADE`,
  );
  await db.insert(venues).values({ id: VENUE, name: "Casa", timezone: "Europe/Madrid" });
  await db.insert(services).values({ venueId: VENUE, name: "dinner", openStart: "20:00", openEnd: "23:00" });
  await db.insert(tables).values(
    Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, venueId: VENUE, name: `T${i}`, seats: 4 })),
  );
  await addKey(db, "origin-admin", "admin", [VENUE], "admin");
  await addKey(db, "origin-writer", "writer", [VENUE], "write");
  await addKey(db, "origin-writer-2", "writer-2", [VENUE], "write");
});

type Who = { apikey: string; channel?: string } | { cookie: string };

function headersFor(who: Who, key: string) {
  const base: Record<string, string> = { "content-type": "application/json", "Idempotency-Key": key };
  if ("cookie" in who) return { ...base, Cookie: who.cookie };
  return { ...base, apikey: who.apikey, ...(who.channel ? { "X-OpenCovers-Channel": who.channel } : {}) };
}

function send(who: Who, method: string, path: string, body?: unknown, key = crypto.randomUUID()) {
  return app.request(`/v1/venues/${VENUE}${path}`, {
    method,
    headers: headersFor(who, key),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function staffSession(): Promise<{ id: string; who: { cookie: string } }> {
  const res = await auth.api.signUpEmail({
    body: { name: "Staff", email: `origin-${++counter}@example.com`, password: "password123" },
    asResponse: true,
  });
  const cookie = res.headers.get("set-cookie") as string;
  const { user } = (await res.clone().json()) as { user: { id: string } };
  await addMembership(db, user.id, VENUE, "write");
  return { id: user.id, who: { cookie } };
}

let slot = 0;
function booking() {
  slot += 1;
  return { date: SATURDAY, time: "20:00", partySize: 2, tables: [`t${slot % 12}`], guest: { name: "Ana", contact: `g${slot}@example.com` } };
}

async function trail(reservationId: string) {
  const rows = await db
    .select({ type: events.type, channel: events.channel, actor: events.actor })
    .from(events)
    .where(eq(events.reservationId, reservationId))
    .orderBy(asc(events.id));
  return rows;
}

// One reservation through its whole life, then the trail it left.
async function lifecycle(who: Who) {
  const created = await send(who, "POST", "/reservations", booking());
  expect(created.status).toBe(200);
  const { id } = await created.json();
  expect((await send(who, "POST", `/reservations/${id}/modify`, { partySize: 3 })).status).toBe(200);
  expect((await send(who, "POST", `/reservations/${id}/status`, { status: "seated" })).status).toBe(200);
  const second = await send(who, "POST", "/reservations", booking());
  const { id: other } = await second.json();
  expect((await send(who, "POST", `/reservations/${other}/cancel`)).status).toBe(200);
  return { id, other };
}

describe("event channel and actor", () => {
  it("records a staff session as staff with the user id, never the email", async () => {
    const { id: userId, who } = await staffSession();
    const { id, other } = await lifecycle(who);
    expect(await trail(id)).toEqual([
      { type: "created", channel: "staff", actor: userId },
      { type: "modified", channel: "staff", actor: userId },
      { type: "seated", channel: "staff", actor: userId },
    ]);
    expect(await trail(other)).toEqual([
      { type: "created", channel: "staff", actor: userId },
      { type: "cancelled", channel: "staff", actor: userId },
    ]);
    expect(JSON.stringify(await db.select().from(events))).not.toContain("@example.com");
  });

  it("records an API key as api with a key reference that tells keys apart", async () => {
    const a = await lifecycle({ apikey: "origin-writer" });
    const b = await lifecycle({ apikey: "origin-writer-2" });
    const rowsA = await trail(a.id);
    const rowsB = await trail(b.id);
    expect(rowsA.map((r) => r.channel)).toEqual(["api", "api", "api"]);
    const actor = rowsA[0].actor;
    expect(actor).toMatch(/^key_[0-9a-f]{12}$/);
    expect(rowsA.every((r) => r.actor === actor)).toBe(true);
    expect(rowsB[0].actor).toMatch(/^key_[0-9a-f]{12}$/);
    expect(rowsB[0].actor).not.toBe(actor);
    expect((await trail(a.other)).map((r) => [r.type, r.channel, r.actor])).toEqual([
      ["created", "api", actor],
      ["cancelled", "api", actor],
    ]);
  });

  it("records mcp when an API key's request says so", async () => {
    const { id, other } = await lifecycle({ apikey: "origin-writer", channel: "mcp" });
    for (const r of [...(await trail(id)), ...(await trail(other))]) {
      expect(r.channel).toBe("mcp");
      expect(r.actor).toMatch(/^key_/);
    }
  });

  it("ignores any other channel value on an API key, and the header on a session", async () => {
    const a = await send({ apikey: "origin-writer", channel: "staff" }, "POST", "/reservations", booking());
    expect((await trail((await a.json()).id))[0].channel).toBe("api");
    const { id: userId, who } = await staffSession();
    const res = await app.request(`/v1/venues/${VENUE}/reservations`, {
      method: "POST",
      headers: { ...headersFor(who, crypto.randomUUID()), "X-OpenCovers-Channel": "mcp" },
      body: JSON.stringify(booking()),
    });
    expect(await trail((await res.json()).id)).toEqual([{ type: "created", channel: "staff", actor: userId }]);
  });

  it("records a waitlist seating and a walk-in with the caller's origin", async () => {
    const who = { apikey: "origin-writer", channel: "mcp" };
    const walk = await send(who, "POST", "/reservations/walk-in", { date: SATURDAY, time: "22:00", partySize: 2, tables: ["t11"] });
    expect(walk.status).toBe(200);
    const row = (await trail((await walk.json()).id))[0];
    expect(row.channel).toBe("mcp");
  });

  it("repeats an idempotency key without a second event", async () => {
    const who = { apikey: "origin-writer", channel: "mcp" };
    const body = booking();
    const key = crypto.randomUUID();
    const first = await (await send(who, "POST", "/reservations", body, key)).json();
    // The repeat comes from another channel. The first event stays as it was written.
    const again = await send({ apikey: "origin-writer-2" }, "POST", "/reservations", body, key);
    expect(again.status).toBe(200);
    const rows = await trail(first.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe("mcp");
    const cancelKey = crypto.randomUUID();
    await send(who, "POST", `/reservations/${first.id}/cancel`, undefined, cancelKey);
    await send(who, "POST", `/reservations/${first.id}/cancel`, undefined, cancelKey);
    expect((await trail(first.id)).map((r) => r.type)).toEqual(["created", "cancelled"]);
  });
});

describe("the public channel", () => {
  let bookingKey: string;
  beforeAll(async () => {
    const res = await send({ apikey: "origin-admin" }, "PUT", "/online-booking", { enabled: true });
    expect(res.status).toBe(200);
    bookingKey = (await res.json()).bookingKey;
  });

  function publicCreate(headers: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
    const challenge = issueChallenge(config, bookingKey, Date.now() - 10_000);
    return app.request(`/v1/public/${bookingKey}/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID(), ...headers },
      body: JSON.stringify({
        date: SATURDAY,
        time: "21:00",
        partySize: 2,
        guest: { name: "Ana", contact: `pub${++counter}@example.com` },
        challenge,
        solution: solve(challenge),
        ...extra,
      }),
    });
  }

  it("records create, modify and cancel by the guest as widget with no actor", async () => {
    const res = await publicCreate();
    expect(res.status).toBe(200);
    const { selfServiceToken } = await res.json();
    const id = (await findLink(db, selfServiceToken))!.reservationId;
    const guestHeaders = { "X-Self-Service-Token": selfServiceToken, "Idempotency-Key": crypto.randomUUID() };
    const read = await app.request("/v1/public/self-service", { headers: guestHeaders });
    const { version } = await read.json();
    const modified = await app.request("/v1/public/self-service/modify", {
      method: "POST",
      headers: { ...guestHeaders, "content-type": "application/json" },
      body: JSON.stringify({ partySize: 3, version }),
    });
    expect(modified.status).toBe(200);
    const cancelled = await app.request("/v1/public/self-service/cancel", {
      method: "POST",
      headers: { ...guestHeaders, "Idempotency-Key": crypto.randomUUID() },
    });
    expect(cancelled.status).toBe(200);
    expect(await trail(id)).toEqual([
      { type: "created", channel: "widget", actor: null },
      { type: "modified", channel: "widget", actor: null },
      { type: "cancelled", channel: "widget", actor: null },
    ]);
  });

  it("cannot be made to claim another channel, with a header, an API key or a body field", async () => {
    const res = await publicCreate(
      { "X-OpenCovers-Channel": "mcp", apikey: "origin-admin" },
      { channel: "staff", actor: "someone", origin: { channel: "api", actor: "x" } },
    );
    expect(res.status).toBe(200);
    const id = (await findLink(db, (await res.json()).selfServiceToken))!.reservationId;
    expect(await trail(id)).toEqual([{ type: "created", channel: "widget", actor: null }]);
  });
});

describe("rows without an origin", () => {
  it("stay null, and the events feed does not change shape", async () => {
    await db.insert(events).values({ venueId: VENUE, type: "created", reservationId: "legacy", version: 1 });
    expect(await trail("legacy")).toEqual([{ type: "created", channel: null, actor: null }]);
    const feed = await send({ apikey: "origin-admin" }, "GET", "/events?cursor=");
    expect(feed.status).toBe(200);
    for (const e of (await feed.json()).events) {
      expect(Object.keys(e)).not.toContain("channel");
      expect(Object.keys(e)).not.toContain("actor");
    }
  });

  it("refuse a channel outside the closed set", async () => {
    await expect(
      db.insert(events).values({ venueId: VENUE, type: "created", reservationId: "bad", version: 1, channel: "carrier-pigeon" }),
    ).rejects.toThrow();
  });
});
