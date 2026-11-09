import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import {
  addKey,
  authenticate,
  authenticateAdmin,
  revokeKey,
} from "../src/lib/api-keys";

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE account, session, verification, "user", events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe("api keys", () => {
  it("authenticates a key with a venue grant", async () => {
    await addKey(db, "test-key", "test-principal", ["venue-a"], "write");
    expect(await authenticate(db, "test-key", "venue-a")).toEqual({
      ok: true,
      principal: "test-principal",
      role: "write",
    });
    expect(await authenticate(db, "test-key", "venue-b")).toEqual({
      ok: false,
      reason: "venue_not_found",
    });
    expect(await authenticate(db, "wrong-key", "venue-a")).toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });

  it("accepts a wildcard grant", async () => {
    await addKey(db, "wild-key", "wild-principal", ["*"], "read");
    expect(await authenticate(db, "wild-key", "any-venue")).toEqual({
      ok: true,
      principal: "wild-principal",
      role: "read",
    });
  });

  it("rejects a non-admin key for admin operations", async () => {
    await addKey(db, "write-key", "write-principal", ["*"], "write");
    expect(await authenticateAdmin(db, "write-key")).toEqual({
      ok: false,
      reason: "forbidden",
    });
    await addKey(db, "admin-key", "admin-principal", ["*"], "admin");
    expect(await authenticateAdmin(db, "admin-key")).toEqual({
      ok: true,
      principal: "admin-principal",
    });
  });

  it("revokes a key", async () => {
    await addKey(db, "revoke-key", "revoke-principal", ["*"], "read");
    await revokeKey(db, "revoke-key");
    expect(await authenticate(db, "revoke-key", "x")).toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });

  it("rejects a read-only key on a write over HTTP", async () => {
    await addKey(db, "read-key", "read-principal", ["*"], "read");
    const res = await app.request("/v1/venues/x/reservations", {
      method: "POST",
      headers: {
        apikey: "read-key",
        "Idempotency-Key": "k1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        date: "2026-11-12",
        time: "21:00",
        partySize: 2,
        tables: ["1"],
      }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "forbidden", message: "forbidden" });
  });
});
