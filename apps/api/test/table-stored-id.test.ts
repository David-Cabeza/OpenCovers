// A table stored before the id rule of C79 can still be edited: POST /tables applies the rule to a new id only.
import { and, asc, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";

const VENUE = "tsi-a";
const OTHER = "tsi-b";
const ADMIN = "tsi-admin";

const STORED: [string, string][] = [
  ["an id with a space", "mesa 1"],
  ["an id with a colon", "sala:1"],
  ["an id with a slash", "a/b"],
  ["an id of 65 characters", "x".repeat(65)],
  ["an id of 2000 characters", "y".repeat(2000)],
];

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE account, session, verification, "user", venue_memberships, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
  await db.insert(venues).values([{ id: VENUE }, { id: OTHER }]);
  await addKey(db, ADMIN, "owner", [VENUE], "admin");
});

beforeEach(async () => {
  await db.delete(tables);
});

const insert = (venueId: string, id: string) =>
  db.insert(tables).values({ id, venueId, name: "Old", seats: 2, posX: 16, posY: 24, rotation: 90 });

const snapshot = () => db.select().from(tables).orderBy(asc(tables.venueId), asc(tables.id));

const post = (id: string, extra: Record<string, unknown> = {}) =>
  app.request(`/v1/venues/${VENUE}/tables`, {
    method: "POST",
    headers: { apikey: ADMIN, "Content-Type": "application/json" },
    body: JSON.stringify({ id, name: "Renamed", seats: 4, zone: "Sala", shape: "oval", ...extra }),
  });

async function expectRejected(res: Response) {
  expect(res.status).toBe(400);
  expect((await res.json()).code).toBe("invalid_request");
}

describe("POST /tables on a table stored with an id outside the rule", () => {
  it.each(STORED)("edits the table with %s and keeps its id and layout", async (_label, id) => {
    await insert(VENUE, id);
    const res = await post(id);
    expect(res.status).toBe(200);
    expect(await snapshot()).toEqual([
      { id, venueId: VENUE, name: "Renamed", seats: 4, zone: "Sala", shape: "oval", posX: 16, posY: 24, rotation: 90 },
    ]);
  });

  it.each(STORED)("refuses %s when no table of the venue has it, also if another venue does", async (_label, id) => {
    await insert(OTHER, id);
    const before = await snapshot();
    await expectRejected(await post(id));
    expect(await snapshot()).toEqual(before);
  });

  it("still checks the other fields of a stored table", async () => {
    await insert(VENUE, "mesa 1");
    const before = await snapshot();
    for (const extra of [{ name: "n".repeat(81) }, { seats: 201 }, { zone: "z".repeat(81) }, { shape: "hexagon" }]) {
      await expectRejected(await post("mesa 1", extra));
    }
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    ["an id longer than any lookup", "z".repeat(5000)],
    ["an id with a NUL character", "a\u0000b"],
  ])("refuses %s with invalid_request", async (_label, id) => {
    await expectRejected(await post(id));
    expect(await db.select().from(tables).where(and(eq(tables.venueId, VENUE)))).toEqual([]);
  });
});
