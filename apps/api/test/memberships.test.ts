import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { user } from "../src/db/schema";
import { auth } from "../src/lib/auth";
import {
  addMembership,
  getMembership,
  listVenuesForUser,
} from "../src/lib/memberships";
import { createVenue } from "../src/lib/venue";

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE account, session, verification, "user", venue_memberships, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

async function signUpAndGetCookie(): Promise<string> {
  const res = await auth.api.signUpEmail({
    body: {
      name: "Owner",
      email: `owner-${Math.random().toString(36).slice(2)}@example.com`,
      password: "password123",
    },
    asResponse: true,
  });
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("signup did not set a session cookie");
  return cookie;
}

describe("memberships", () => {
  it("adds, reads, and lists memberships", async () => {
    const now = new Date();
    await db.insert(user).values([
      { id: "user-1", name: "One", email: "one@example.com", emailVerified: false, createdAt: now, updatedAt: now },
      { id: "user-2", name: "Two", email: "two@example.com", emailVerified: false, createdAt: now, updatedAt: now },
    ]);

    await createVenue(db, "user-1", { id: "venue-m", name: "Mara" });
    await addMembership(db, "user-2", "venue-m", "read");

    expect(await getMembership(db, "user-1", "venue-m")).toEqual({
      venueId: "venue-m",
      role: "admin",
    });
    expect(await getMembership(db, "user-2", "venue-m")).toEqual({
      venueId: "venue-m",
      role: "read",
    });
    expect(await getMembership(db, "user-3", "venue-m")).toBeNull();

    const venues = await listVenuesForUser(db, "user-1");
    expect(venues).toHaveLength(1);
    expect(venues[0].id).toBe("venue-m");
    expect(venues[0].role).toBe("admin");
  });
});

describe("session auth over HTTP", () => {
  it("creates a venue and lists it for the signed-in user", async () => {
    const cookie = await signUpAndGetCookie();

    const create = await app.request("/v1/venues", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Casa Lola", timezone: "Europe/Madrid" }),
    });
    expect(create.status).toBe(201);
    const { venue } = await create.json();
    expect(venue.name).toBe("Casa Lola");

    const list = await app.request("/v1/venues", {
      headers: { Cookie: cookie },
    });
    expect(list.status).toBe(200);
    const { venues } = await list.json();
    expect(venues).toHaveLength(1);
    expect(venues[0].id).toBe(venue.id);
    expect(venues[0].role).toBe("admin");
  });

  it("rejects venue access without a session or API key", async () => {
    const res = await app.request("/v1/venues/x/config");
    expect(res.status).toBe(401);
  });

  it("allows the session to read a venue route and blocks a read-only member on writes", async () => {
    const cookie = await signUpAndGetCookie();
    const create = await app.request("/v1/venues", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Readonly" }),
    });
    const { venue } = await create.json();

    const agenda = await app.request(
      `/v1/venues/${venue.id}/agenda?date=2026-11-12`,
      { headers: { Cookie: cookie } },
    );
    expect(agenda.status).toBe(200);

    const write = await app.request(`/v1/venues/${venue.id}/config`, {
      method: "PUT",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, noticeAddress: "x@example.com" }),
    });
    expect(write.status).toBe(200);
  });
});
