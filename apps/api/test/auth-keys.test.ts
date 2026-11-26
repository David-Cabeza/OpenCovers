import { asc, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { apiKeys, grants, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { auth } from "../src/lib/auth";

// `/v1/auth/keys` administers keys of every venue, so only an `admin` key that holds the all-venues grant (`*`) may
// call it. An `admin` key limited to named venues is refused with `forbidden` and writes nothing (C10).

const V1 = "auth-keys-v1";
const V2 = "auth-keys-v2";
const KEYS = {
  root: "t18-root-admin-all-venues",
  scoped: "t18-admin-v1-only",
  scopedBoth: "t18-admin-v1-and-v2",
  v2Writer: "t18-write-v2",
  allRead: "t18-read-all-venues",
  allWrite: "t18-write-all-venues",
};

beforeEach(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE account, session, verification, "user", venue_memberships, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
  await db.insert(venues).values([
    { id: V1, name: "Venue one" },
    { id: V2, name: "Venue two" },
  ]);
  await addKey(db, KEYS.root, "root", ["*"], "admin");
  await addKey(db, KEYS.scoped, "v1-admin", [V1], "admin");
  await addKey(db, KEYS.scopedBoth, "v1-v2-admin", [V1, V2], "admin");
  await addKey(db, KEYS.v2Writer, "v2-writer", [V2], "write");
  await addKey(db, KEYS.allRead, "all-reader", ["*"], "read");
  await addKey(db, KEYS.allWrite, "all-writer", ["*"], "write");
});

async function keyTable() {
  const keys = await db.select().from(apiKeys).orderBy(asc(apiKeys.hash));
  const granted = await db.select().from(grants).orderBy(asc(grants.keyHash), asc(grants.venueId));
  return { keys, granted };
}

function call(method: "GET" | "POST" | "DELETE", headers: Record<string, string>, body?: unknown) {
  return app.request("/v1/auth/keys", {
    method,
    headers: body === undefined ? headers : { ...headers, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const forbidden = { code: "forbidden", message: "forbidden", retryable: false };
const unauthorized = { code: "unauthorized", message: "unauthorized", retryable: false };

async function agenda(venueId: string, key: string) {
  return app.request(`/v1/venues/${venueId}/agenda?date=2026-11-12`, { headers: { apikey: key } });
}

describe("/v1/auth/keys needs an all-venues admin key", () => {
  it("refuses an admin key limited to named venues on all three routes and writes nothing", async () => {
    const before = await keyTable();
    for (const key of [KEYS.scoped, KEYS.scopedBoth]) {
      const requests: [ "GET" | "POST" | "DELETE", unknown ][] = [
        ["GET", undefined],
        ["POST", { key: "t18-minted-admin", principal: "x", role: "admin" }],
        ["POST", { key: "t18-minted-read", principal: "x", role: "read", venues: [V1] }],
        ["DELETE", { key: KEYS.v2Writer }],
        ["DELETE", { key: KEYS.root }],
      ];
      for (const [method, body] of requests) {
        const res = await call(method, { apikey: key }, body);
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual(forbidden);
      }
    }
    expect(await keyTable()).toEqual(before);
  });

  it("lets an all-venues admin key list, create and revoke", async () => {
    const list = await call("GET", { apikey: KEYS.root });
    expect(list.status).toBe(200);
    const { keys } = await list.json();
    expect(keys).toHaveLength(6);
    expect(keys).toContainEqual({ principal: "v1-admin", role: "admin" });

    const created = await call("POST", { apikey: KEYS.root }, {
      key: "t18-new-read-v2-0123456789abcdefghijklmnop",
      principal: "new-reader",
      role: "read",
      venues: [V2],
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({ ok: true });
    expect((await agenda(V2, "t18-new-read-v2-0123456789abcdefghijklmnop")).status).toBe(200);
    expect((await agenda(V1, "t18-new-read-v2-0123456789abcdefghijklmnop")).status).toBe(404);

    const revoked = await call("DELETE", { apikey: KEYS.root }, { key: "t18-new-read-v2-0123456789abcdefghijklmnop" });
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual({ ok: true });
    expect((await agenda(V2, "t18-new-read-v2-0123456789abcdefghijklmnop")).status).toBe(401);
  });

  it("keeps the documented errors for read and write keys, unknown keys and staff sessions", async () => {
    for (const key of [KEYS.allRead, KEYS.allWrite, KEYS.v2Writer]) {
      const res = await call("GET", { apikey: key });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(forbidden);
    }
    const unknown = await call("POST", { apikey: "t18-not-registered" }, { key: "k", principal: "x", role: "admin" });
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual(unauthorized);

    const signUp = await auth.api.signUpEmail({
      body: { name: "Owner", email: "auth-keys-owner@example.com", password: "password123" },
      asResponse: true,
    });
    const cookie = signUp.headers.get("set-cookie");
    if (!cookie) throw new Error("signup did not set a session cookie");
    const before = await keyTable();
    for (const [method, body] of [
      ["GET", undefined],
      ["POST", { key: "t18-session-made", principal: "x", role: "admin" }],
      ["DELETE", { key: KEYS.allRead }],
    ] as const) {
      const res = await call(method, { Cookie: cookie }, body);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(unauthorized);
    }
    expect(await keyTable()).toEqual(before);
  });

  it("still lets a venue-limited admin key manage its own venue's keys", async () => {
    const created = await app.request(`/v1/venues/${V1}/keys`, {
      method: "POST",
      headers: { apikey: KEYS.scoped, "Content-Type": "application/json" },
      body: JSON.stringify({ key: "t18-v1-agent-0123456789abcdefghijklmnop", principal: "v1-agent", role: "write" }),
    });
    expect(created.status).toBe(201);
    const { keys } = await created.json();
    const agent = keys.find((k: { principal: string }) => k.principal === "v1-agent");
    expect(agent).toMatchObject({ role: "write" });
    expect((await agenda(V1, "t18-v1-agent-0123456789abcdefghijklmnop")).status).toBe(200);
    expect((await agenda(V2, "t18-v1-agent-0123456789abcdefghijklmnop")).status).toBe(404);

    const elsewhere = await app.request(`/v1/venues/${V2}/keys`, { headers: { apikey: KEYS.scoped } });
    expect(elsewhere.status).toBe(404);

    const revoked = await app.request(`/v1/venues/${V1}/keys`, {
      method: "DELETE",
      headers: { apikey: KEYS.scoped, "Content-Type": "application/json" },
      body: JSON.stringify({ hash: agent.hash }),
    });
    expect(revoked.status).toBe(200);
    expect((await agenda(V1, "t18-v1-agent-0123456789abcdefghijklmnop")).status).toBe(401);
  });

  it("does not let a venue-limited admin key reach another venue through a key it mints", async () => {
    expect((await agenda(V2, KEYS.scoped)).status).toBe(404);
    const minted = await call("POST", { apikey: KEYS.scoped }, {
      key: "t18-escalated",
      principal: "x",
      role: "admin",
    });
    expect(minted.status).toBe(403);
    expect((await agenda(V2, "t18-escalated")).status).toBe(401);
    expect((await agenda(V1, "t18-escalated")).status).toBe(401);
  });
});
