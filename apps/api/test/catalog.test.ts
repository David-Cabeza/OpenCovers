import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import {
  deleteService,
  deleteTable,
  listServices,
  listTables,
  upsertService,
  upsertTable,
} from "../src/lib/catalog";

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE account, session, verification, "user", venue_memberships, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe("catalog", () => {
  it("creates, updates, and deletes tables", async () => {
    await db.insert(venues).values({ id: "cat" }).onConflictDoNothing();

    await upsertTable(db, "cat", { id: "1", name: "T1", seats: 2 });
    await upsertTable(db, "cat", { id: "2", name: "T2", seats: 4 });
    expect(await listTables(db, "cat")).toEqual([
      { id: "1", name: "T1", seats: 2, zone: "", shape: "round", posX: 0, posY: 0 },
      { id: "2", name: "T2", seats: 4, zone: "", shape: "round", posX: 0, posY: 0 },
    ]);

    await upsertTable(db, "cat", { id: "1", name: "T1 Big", seats: 6 });
    const updated = await listTables(db, "cat");
    expect(updated[0]).toEqual({ id: "1", name: "T1 Big", seats: 6, zone: "", shape: "round", posX: 0, posY: 0 });

    await deleteTable(db, "cat", "2");
    expect(await listTables(db, "cat")).toEqual([
      { id: "1", name: "T1 Big", seats: 6, zone: "", shape: "round", posX: 0, posY: 0 },
    ]);
  });

  it("creates, updates, and deletes services", async () => {
    await upsertService(db, "cat", { name: "lunch", openStart: "12:00", openEnd: "16:00" });
    await upsertService(db, "cat", { name: "dinner", openStart: "19:00", openEnd: "23:00" });
    expect(await listServices(db, "cat")).toEqual([
      { name: "lunch", openStart: "12:00", openEnd: "16:00" },
      { name: "dinner", openStart: "19:00", openEnd: "23:00" },
    ]);

    await upsertService(db, "cat", { name: "lunch", openStart: "12:30", openEnd: "16:00" });
    expect(await listServices(db, "cat")).toEqual([
      { name: "lunch", openStart: "12:30", openEnd: "16:00" },
      { name: "dinner", openStart: "19:00", openEnd: "23:00" },
    ]);

    await deleteService(db, "cat", "dinner");
    expect(await listServices(db, "cat")).toEqual([
      { name: "lunch", openStart: "12:30", openEnd: "16:00" },
    ]);
  });

  it("blocks a read-only key from mutating the catalog over HTTP", async () => {
    await addKey(db, "read-key", "read-principal", ["cat"], "read");

    const post = await app.request("/v1/venues/cat/tables", {
      method: "POST",
      headers: { apikey: "read-key", "Content-Type": "application/json" },
      body: JSON.stringify({ id: "9", name: "T9", seats: 2 }),
    });
    expect(post.status).toBe(403);

    const del = await app.request("/v1/venues/cat/tables/1", {
      method: "DELETE",
      headers: { apikey: "read-key" },
    });
    expect(del.status).toBe(403);
  });
});
