// Input checks on the admin table routes (#385, part 1): POST /tables, PATCH and DELETE /tables/{tableId}.
// A bad request answers `invalid_request` (or a not-found code) and writes nothing, never a 500 or a silent 200.
import { asc, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";

const VENUE = "ti-a";
const OTHER = "ti-b";
const ADMIN = "ti-admin"; // admin of VENUE only
const ALL = "ti-all"; // admin key with the all-venues grant

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE account, session, verification, "user", venue_memberships, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
  await db.insert(venues).values([{ id: VENUE }, { id: OTHER }]);
  await addKey(db, ADMIN, "owner", [VENUE], "admin");
  await addKey(db, ALL, "operator", ["*"], "admin");
});

beforeEach(async () => {
  await db.delete(tables);
  await db.insert(tables).values([
    { id: "t1", venueId: VENUE, name: "T1", seats: 2, posX: 16, posY: 24, rotation: 0 },
    { id: "b1", venueId: OTHER, name: "B1", seats: 4, posX: 8, posY: 8, rotation: 90 },
  ]);
});

const snapshot = () => db.select().from(tables).orderBy(asc(tables.venueId), asc(tables.id));

function send(method: string, path: string, body?: string, key = ADMIN) {
  return app.request(`/v1/venues/${path}`, {
    method,
    headers: { apikey: key, "Content-Type": "application/json" },
    body,
  });
}

async function expectRejected(res: Response, code: string, status: number) {
  expect(res.status).toBe(status);
  expect((await res.json()).code).toBe(code);
}

const json = (value: unknown) => JSON.stringify(value);
const valid = { id: "t9", name: "T9", seats: 4 };

describe("POST /tables rejects a bad body and writes nothing", () => {
  const cases: [string, string | undefined][] = [
    ["a malformed JSON body", "{not json"],
    ["a null body", "null"],
    ["an empty body", ""],
    ["no body", undefined],
    ["seats over the int range", json({ ...valid, seats: 99999999999 })],
    ["seats over the maximum of 200", json({ ...valid, seats: 201 })],
    ["seats in exponent form beyond the maximum", json({ ...valid, seats: 1e12 })],
    ["an empty name", json({ ...valid, name: "" })],
    ["a blank name", json({ ...valid, name: "   " })],
    ["a name over 80 characters", json({ ...valid, name: "n".repeat(81) })],
    ["a shape outside the list", json({ ...valid, shape: "hexagon" })],
    ["a non-string shape", json({ ...valid, shape: 3 })],
    ["a null shape", json({ ...valid, shape: null })],
    ["a non-string zone", json({ ...valid, zone: 5 })],
    ["a null zone", json({ ...valid, zone: null })],
    ["a zone over 80 characters", json({ ...valid, zone: "z".repeat(81) })],
    ["an id with a space", json({ ...valid, id: "mesa 1" })],
    ["an id of 5000 characters", json({ ...valid, id: "x".repeat(5000) })],
    ["an id of 65 characters", json({ ...valid, id: "x".repeat(65) })],
    ["an id that is a dot path segment", json({ ...valid, id: ".." })],
    ["an id with a slash", json({ ...valid, id: "a/b" })],
    ["an unknown field", json({ ...valid, posX: 40 })],
  ];

  it.each(cases)("%s", async (_name, body) => {
    const before = await snapshot();
    await expectRejected(await send("POST", `${VENUE}/tables`, body), "invalid_request", 400);
    expect(await snapshot()).toEqual(before);
  });

  it("answers venue_not_found for an unknown venue, even with the all-venues key", async () => {
    const before = await snapshot();
    await expectRejected(await send("POST", "ti-nowhere/tables", json(valid), ALL), "venue_not_found", 404);
    expect(await snapshot()).toEqual(before);
  });
});

describe("POST /tables still accepts what the staff app sends", () => {
  it("accepts the table form body with each shape and the edge values", async () => {
    for (const shape of ["round", "oval", "square", "rectangle", "long", "rect"]) {
      const res = await send("POST", `${VENUE}/tables`, json({ id: `s-${shape}`, name: "M", seats: 1, zone: "Sala", shape }));
      expect(res.status, shape).toBe(200);
    }
    const edge = { id: `T_9.a-${"x".repeat(57)}`, name: "n".repeat(80), seats: 200, zone: "" };
    const res = await send("POST", `${VENUE}/tables`, json(edge));
    expect(res.status).toBe(200);
    // A banquet table seats more than 100.
    expect((await send("POST", `${VENUE}/tables`, json({ id: "banquet", name: "Banquete", seats: 101 }))).status).toBe(200);
    const { tables: list } = await res.json();
    expect(list).toContainEqual({ ...edge, shape: "round", posX: 0, posY: 0, rotation: 0 });
  });
});

describe("PATCH /tables/{tableId} rejects a bad body and writes nothing", () => {
  const cases: [string, string | undefined][] = [
    ["a malformed JSON body", "{not json"],
    ["a null body", "null"],
    ["an empty body", ""],
    ["no body", undefined],
    ["an array body", json([{ x: 8 }])],
    ["an empty object", json({})],
    ["a fractional x", json({ x: 1.5 })],
    ["an x over the int range", json({ x: 1e12 })],
    ["an x over 10000", json({ x: 10001 })],
    ["a negative y", json({ y: -8 })],
    ["a rotation of 360", json({ rotation: 360 })],
    ["a string x", json({ x: "40" })],
    ["a null rotation", json({ rotation: null })],
    ["a name, which only POST sets", json({ name: "Renamed" })],
    ["seats, which only POST sets", json({ seats: 6 })],
    ["a body id", json({ id: "t2", x: 8 })],
  ];

  it.each(cases)("%s", async (_name, body) => {
    const before = await snapshot();
    await expectRejected(await send("PATCH", `${VENUE}/tables/t1`, body), "invalid_request", 400);
    expect(await snapshot()).toEqual(before);
  });

  it("answers table_not_found for an unknown id and for another venue's id alike", async () => {
    const before = await snapshot();
    const unknown = await send("PATCH", `${VENUE}/tables/nope`, json({ x: 8 }));
    const foreign = await send("PATCH", `${VENUE}/tables/b1`, json({ x: 8 }));
    expect(unknown.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual(await unknown.json());
    expect(await snapshot()).toEqual(before);
  });

  it("answers venue_not_found for an unknown venue, even with the all-venues key", async () => {
    const before = await snapshot();
    await expectRejected(await send("PATCH", "ti-nowhere/tables/t1", json({ x: 8 }), ALL), "venue_not_found", 404);
    expect(await snapshot()).toEqual(before);
  });

  it("still moves and rotates a table as the floor editor does", async () => {
    const res = await send("PATCH", `${VENUE}/tables/t1`, json({ x: 10000, y: 0, rotation: 270 }));
    expect(res.status).toBe(200);
    const { tables: list } = await res.json();
    expect(list).toContainEqual(expect.objectContaining({ id: "t1", posX: 10000, posY: 0, rotation: 270 }));
  });
});

describe("DELETE /tables/{tableId}", () => {
  it("answers 200 for an unknown id and another venue's id alike, and deletes nothing", async () => {
    const before = await snapshot();
    const unknown = await send("DELETE", `${VENUE}/tables/nope`);
    const foreign = await send("DELETE", `${VENUE}/tables/b1`);
    expect(unknown.status).toBe(200);
    expect(foreign.status).toBe(200);
    expect(await foreign.json()).toEqual(await unknown.json());
    expect(await snapshot()).toEqual(before);
  });

  it("answers venue_not_found for an unknown venue, even with the all-venues key", async () => {
    const before = await snapshot();
    await expectRejected(await send("DELETE", "ti-nowhere/tables/t1", undefined, ALL), "venue_not_found", 404);
    expect(await snapshot()).toEqual(before);
  });
});
