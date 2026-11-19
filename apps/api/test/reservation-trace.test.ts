import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.PUBLIC_CHALLENGE_SECRET = "test-secret-for-the-public-form-challenge";
  process.env.PUBLIC_POW_DIFFICULTY = "4";
});

import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { events, services, tables } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { auth } from "../src/lib/auth";
import { addMembership } from "../src/lib/memberships";
import { challengeConfigFromEnv, issueChallenge, solve } from "../src/lib/public-challenge";
import { saturdayAhead } from "./dates";

const DATE = saturdayAhead();
const config = challengeConfigFromEnv();

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE account, session, verification, "user", venue_memberships, events, tombstones, idempotency_keys, table_allocations, reservations, guests, grants, api_keys, services, tables, venue_online_booking, venues RESTART IDENTITY CASCADE`,
  );
});

async function signUp(email: string, name = "Staff"): Promise<string> {
  const res = await auth.api.signUpEmail({
    body: { name, email, password: "password123" },
    asResponse: true,
  });
  return res.headers.get("set-cookie") as string;
}

async function makeVenue(cookie: string): Promise<string> {
  const res = await app.request("/v1/venues", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Trace Venue" }),
  });
  const id = (await res.json()).venue.id as string;
  await db.insert(services).values({ venueId: id, name: "dinner", openStart: "20:00", openEnd: "23:00" });
  await db.insert(tables).values(
    ["a", "b", "c", "d"].map((n) => ({ id: `${id}-${n}`, venueId: id, name: n, seats: 4 })),
  );
  return id;
}

const trace = (venueId: string, id: string, headers: Record<string, string>) =>
  app.request(`/v1/venues/${venueId}/reservations/${id}/trace`, { headers });

async function write(venueId: string, path: string, headers: Record<string, string>, key: string, body: unknown) {
  return app.request(`/v1/venues/${venueId}${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}

describe("C65 reservation trace", () => {
  it("lists a key's create, modify and cancel in order with their keys", async () => {
    const cookie = await signUp("trace-api@example.com");
    const venueId = await makeVenue(cookie);
    await addKey(db, "agent-key", "agent-1", [venueId], "write");
    await addKey(db, "reader-key", "reader-1", [venueId], "read");
    const h = { apikey: "agent-key" };

    const created = await write(venueId, "/reservations", h, "k-create", {
      date: DATE, time: "20:00", partySize: 2, guest: { name: "Ana", contact: "ana@example.com" },
    });
    const { id } = await created.json();
    await write(venueId, `/reservations/${id}/modify`, h, "k-modify", { partySize: 3 });
    await write(venueId, `/reservations/${id}/cancel`, h, "k-cancel", {});

    const res = await trace(venueId, id, { apikey: "reader-key" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reservationId).toBe(id);
    expect(body.source).toBe("api");
    expect(body.actor).toBe("agent-1");
    expect(body.entries.map((e: any) => [e.type, e.version, e.idempotencyKey])).toEqual([
      ["created", 1, "k-create"],
      ["modified", 2, "k-modify"],
      ["cancelled", 3, "k-cancel"],
    ]);
    expect(Date.parse(body.entries[0].occurredAt)).not.toBeNaN();
    expect(JSON.stringify(body)).not.toContain("ana@example.com");
  });

  it("names a staff member's booking as staff", async () => {
    const cookie = await signUp("trace-staff@example.com");
    const venueId = await makeVenue(cookie);
    const created = await write(venueId, "/reservations", { Cookie: cookie }, "s-create", {
      date: DATE, time: "20:00", partySize: 2, guest: { name: "Luis" },
    });
    const { id } = await created.json();
    const body = await (await trace(venueId, id, { Cookie: cookie })).json();
    expect(body.source).toBe("staff");
    expect(body.actor).toBe("trace-staff@example.com");
  });

  it("names a public booking as widget", async () => {
    const cookie = await signUp("trace-widget@example.com");
    const venueId = await makeVenue(cookie);
    const enable = await app.request(`/v1/venues/${venueId}/online-booking`, {
      method: "PUT",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    const { bookingKey } = await enable.json();
    const widgetKey = crypto.randomUUID();
    const challenge = issueChallenge(config, bookingKey, Date.now() - 10_000);
    const booked = await app.request(`/v1/public/${bookingKey}/reservations`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": widgetKey },
      body: JSON.stringify({
        date: DATE, time: "20:00", partySize: 2,
        guest: { name: "Diner", contact: "diner@example.com" },
        challenge, solution: solve(challenge),
      }),
    });
    expect(booked.status).toBe(200);
    const agenda = await (
      await app.request(`/v1/venues/${venueId}/agenda?date=${DATE}`, { headers: { Cookie: cookie } })
    ).json();
    const id = agenda.reservations[0].id;
    const body = await (await trace(venueId, id, { Cookie: cookie })).json();
    expect(body.source).toBe("widget");
    expect(body.actor).toBe("widget");
    expect(body.entries.map((e: any) => [e.type, e.idempotencyKey])).toEqual([["created", widgetKey]]);
  });

  it("returns reservation_not_found for an unknown id or another venue's reservation", async () => {
    const cookie = await signUp("trace-iso@example.com");
    const venueA = await makeVenue(cookie);
    const venueB = await makeVenue(cookie);
    const created = await write(venueA, "/reservations", { Cookie: cookie }, "iso-create", {
      date: DATE, time: "20:00", partySize: 2, guest: { name: "Eva" },
    });
    const { id } = await created.json();
    for (const [venue, rid] of [[venueB, id], [venueA, "nope"]]) {
      const res = await trace(venue, rid, { Cookie: cookie });
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("reservation_not_found");
    }
  });
});

describe("C65 each entry's persisted origin", () => {
  const origins = (body: any) => body.entries.map((e: any) => [e.type, e.channel, e.actor, e.recorded]);

  it("shows a key's create, a session's modify and a guest's cancel, each with its own channel and actor", async () => {
    const cookie = await signUp("trace-origin@example.com", "Marta Chef");
    const venueId = await makeVenue(cookie);
    await addKey(db, "origin-key", "origin-1", [venueId], "write");
    const created = await write(venueId, "/reservations", { apikey: "origin-key" }, "o-create", {
      date: DATE, time: "20:00", partySize: 2, guest: { name: "Ana", contact: "ana-o@example.com" },
    });
    const { id } = await created.json();
    expect((await write(venueId, `/reservations/${id}/modify`, { Cookie: cookie }, "o-modify", { partySize: 3 })).status).toBe(200);
    const link = await write(venueId, `/reservations/${id}/self-service-link`, { Cookie: cookie }, "o-link", {});
    const { selfServiceToken } = await link.json();
    const cancelled = await app.request("/v1/public/self-service/cancel", {
      method: "POST",
      headers: { "X-Self-Service-Token": selfServiceToken, "Idempotency-Key": crypto.randomUUID() },
    });
    expect(cancelled.status).toBe(200);

    const body = await (await trace(venueId, id, { Cookie: cookie })).json();
    const rows = origins(body);
    expect(rows.map((r: any[]) => [r[0], r[1], r[3]])).toEqual([
      ["created", "api", true],
      ["modified", "staff", true],
      ["cancelled", "widget", true],
    ]);
    expect(rows[0][2]).toMatch(/^key_[0-9a-f]{12}$/);
    expect(rows[1][2]).toBe("Marta Chef");
    expect(rows[2][2]).toBeNull();
    const text = JSON.stringify(body);
    expect(text).not.toContain("trace-origin@example.com");
    expect(text).not.toContain("ana-o@example.com");
    expect(text).not.toContain("Ana");
  });

  it("tells an mcp-marked key from a plain one", async () => {
    const cookie = await signUp("trace-mcp@example.com");
    const venueId = await makeVenue(cookie);
    await addKey(db, "mcp-key", "mcp-1", [venueId], "write");
    const created = await write(venueId, "/reservations", { apikey: "mcp-key", "X-OpenCovers-Channel": "mcp" }, "m-create", {
      date: DATE, time: "20:00", partySize: 2, guest: { name: "Eva" },
    });
    const { id } = await created.json();
    await write(venueId, `/reservations/${id}/modify`, { apikey: "mcp-key" }, "m-modify", { partySize: 3 });
    const body = await (await trace(venueId, id, { Cookie: cookie })).json();
    expect(body.entries.map((e: any) => e.channel)).toEqual(["mcp", "api"]);
    expect(body.entries[0].actor).toBe(body.entries[1].actor);
  });

  it("gives a staff member whose name looks like an email, or who left the venue, a null actor", async () => {
    const owner = await signUp("trace-owner@example.com", "trace-owner@example.com");
    const venueId = await makeVenue(owner);
    const book = async (key: string) =>
      (await (await write(venueId, "/reservations", { Cookie: owner }, key, {
        date: DATE, time: "20:00", partySize: 2, guest: { name: "Luis" },
      })).json()).id as string;
    const emailNamed = await book("n-create-1");
    const left = await signUp("trace-left@example.com", "Pedro Left");
    const [leftUser] = (await db.execute(sql`SELECT id FROM "user" WHERE email = 'trace-left@example.com'`)).rows as { id: string }[];
    await addMembership(db, leftUser.id, venueId, "write");
    const leftId = (await (await write(venueId, "/reservations", { Cookie: left }, "n-create-2", {
      date: DATE, time: "20:00", partySize: 2, guest: { name: "Eva" },
    })).json()).id as string;
    expect(origins(await (await trace(venueId, leftId, { Cookie: owner })).json())).toEqual([["created", "staff", "Pedro Left", true]]);
    await db.execute(sql`DELETE FROM venue_memberships WHERE user_id = ${leftUser.id}`);
    expect(origins(await (await trace(venueId, emailNamed, { Cookie: owner })).json())).toEqual([["created", "staff", null, true]]);
    expect(origins(await (await trace(venueId, leftId, { Cookie: owner })).json())).toEqual([["created", "staff", null, true]]);
  });

  it("reads an event stored without an origin as derived or unknown, without failing", async () => {
    const cookie = await signUp("trace-legacy@example.com");
    const venueId = await makeVenue(cookie);
    await addKey(db, "legacy-key", "legacy-1", [venueId], "write");
    const created = await write(venueId, "/reservations", { apikey: "legacy-key" }, "l-create", {
      date: DATE, time: "20:00", partySize: 2, guest: { name: "Eva" },
    });
    const { id } = await created.json();
    await write(venueId, `/reservations/${id}/modify`, { apikey: "legacy-key" }, "l-modify", { partySize: 3 });
    await db.update(events).set({ channel: null, actor: null }).where(eq(events.reservationId, id));
    const res = await trace(venueId, id, { Cookie: cookie });
    expect(res.status).toBe(200);
    expect(origins(await res.json())).toEqual([
      ["created", "api", null, false],
      ["modified", null, null, false],
    ]);
  });
});
