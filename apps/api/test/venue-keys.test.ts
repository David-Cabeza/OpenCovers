import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { auth } from "../src/lib/auth";
import { addKey } from "../src/lib/api-keys";

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

async function createVenue(cookie: string): Promise<string> {
  const res = await app.request("/v1/venues", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Key Venue" }),
  });
  const { venue } = await res.json();
  return venue.id;
}

describe("venue keys", () => {
  it("lets a venue admin create, list, and revoke agent keys", async () => {
    const cookie = await signUpAndGetCookie();
    const venueId = await createVenue(cookie);

    const created = await app.request(`/v1/venues/${venueId}/keys`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ key: "agent-key-1", principal: "my-agent", role: "write" }),
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.keys).toHaveLength(1);
    expect(createdBody.keys[0].principal).toBe("my-agent");
    expect(createdBody.keys[0].role).toBe("write");
    const hash = createdBody.keys[0].hash;
    expect(typeof hash).toBe("string");

    const list = await app.request(`/v1/venues/${venueId}/keys`, {
      headers: { Cookie: cookie },
    });
    expect((await list.json()).keys).toEqual([
      { principal: "my-agent", role: "write", hash },
    ]);

    const agenda = await app.request(
      `/v1/venues/${venueId}/agenda?date=2026-11-12`,
      { headers: { apikey: "agent-key-1" } },
    );
    expect(agenda.status).toBe(200);

    const revoked = await app.request(`/v1/venues/${venueId}/keys`, {
      method: "DELETE",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ hash }),
    });
    expect((await revoked.json()).keys).toEqual([]);

    const after = await app.request(
      `/v1/venues/${venueId}/agenda?date=2026-11-12`,
      { headers: { apikey: "agent-key-1" } },
    );
    expect(after.status).toBe(401);
  });

  it("rejects an admin-role key from a venue admin", async () => {
    const cookie = await signUpAndGetCookie();
    const venueId = await createVenue(cookie);

    const res = await app.request(`/v1/venues/${venueId}/keys`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ key: "bad-admin", principal: "x", role: "admin" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a non-admin principal on key management", async () => {
    const cookie = await signUpAndGetCookie();
    const venueId = await createVenue(cookie);
    await addKey(db, "write-key", "writer", [venueId], "write");

    const res = await app.request(`/v1/venues/${venueId}/keys`, {
      headers: { apikey: "write-key" },
    });
    expect(res.status).toBe(403);
  });
});
