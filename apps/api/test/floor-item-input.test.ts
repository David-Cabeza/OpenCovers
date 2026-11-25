// Input checks on the admin floor item routes (#385, part 2): POST /floor-items, PATCH and DELETE /floor-items/{itemId}.
// A bad request answers `invalid_request` (or a not-found code) and writes nothing, never a 500 or a silent 200.
import { asc, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { floorItems, idempotencyKeys, services, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";

const VENUE = "fi-a";
const OTHER = "fi-b";
const ADMIN = "fi-admin"; // admin of VENUE only
const ALL = "fi-all"; // admin key with the all-venues grant

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE account, session, verification, "user", venue_memberships, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, floor_items, tables, venues RESTART IDENTITY CASCADE`,
  );
  await db.insert(venues).values([{ id: VENUE }, { id: OTHER }]);
  await addKey(db, ADMIN, "owner", [VENUE], "admin");
  await addKey(db, ALL, "operator", ["*"], "admin");
});

beforeEach(async () => {
  await db.delete(floorItems);
  await db.delete(idempotencyKeys);
  await db.insert(floorItems).values([
    { id: "i1", venueId: VENUE, type: "bar", label: "Barra", posX: 16, posY: 24, width: 200, height: 44, rotation: 0 },
    { id: "o1", venueId: OTHER, type: "plant", label: "", posX: 8, posY: 8, width: 28, height: 28, rotation: 90 },
  ]);
});

const snapshot = () => db.select().from(floorItems).orderBy(asc(floorItems.venueId), asc(floorItems.id));

function send(method: string, path: string, body?: string, key = ADMIN, headers: Record<string, string> = {}) {
  return app.request(`/v1/venues/${path}`, {
    method,
    headers: { apikey: key, "Content-Type": "application/json", ...headers },
    body,
  });
}

async function expectRejected(res: Response, code: string, status: number) {
  expect(res.status).toBe(status);
  expect((await res.json()).code).toBe(code);
}

const json = (value: unknown) => JSON.stringify(value);
const valid = { type: "bar", label: "Barra", width: 200, height: 44 };

describe("POST /floor-items rejects a bad body and writes nothing", () => {
  const cases: [string, string | undefined][] = [
    ["a malformed JSON body", "{not json"],
    ["a null body", "null"],
    ["an empty body", ""],
    ["no body", undefined],
    ["an array body", json([valid])],
    ["a number body", "5"],
    ["an empty object", "{}"],
    ["a missing type", json({ label: "x" })],
    ["an empty type", json({ ...valid, type: "" })],
    ["a numeric type", json({ ...valid, type: 3 })],
    ["a null type", json({ ...valid, type: null })],
    ["a type over 32 characters", json({ ...valid, type: "t".repeat(33) })],
    ["a type with a space", json({ ...valid, type: "big bar" })],
    ["a type with upper case", json({ ...valid, type: "Bar" })],
    ["a non-string label", json({ ...valid, label: 5 })],
    ["a null label", json({ ...valid, label: null })],
    ["a label over 80 characters", json({ ...valid, label: "l".repeat(81) })],
    ["a string posX", json({ ...valid, posX: "9" })],
    ["a null posX", json({ ...valid, posX: null })],
    ["a fractional posX", json({ ...valid, posX: 1.5 })],
    ["a negative posY", json({ ...valid, posY: -1 })],
    ["posX over 10000", json({ ...valid, posX: 10001 })],
    ["posX in exponent form beyond the int range", json({ ...valid, posX: 1e12 })],
    ["width of 0", json({ ...valid, width: 0 })],
    ["width over 2000", json({ ...valid, width: 2001 })],
    ["a fractional height", json({ ...valid, height: 40.5 })],
    ["height over the int range", json({ ...valid, height: 99999999999 })],
    ["a null width", json({ ...valid, width: null })],
    ["a body id", json({ ...valid, id: "mine" })],
    ["a rotation", json({ ...valid, rotation: 90 })],
    ["an unknown field", json({ ...valid, color: "red" })],
  ];

  it.each(cases)("%s", async (_name, body) => {
    const before = await snapshot();
    await expectRejected(await send("POST", `${VENUE}/floor-items`, body), "invalid_request", 400);
    expect(await snapshot()).toEqual(before);
  });

  it("answers venue_not_found for an unknown venue, even with the all-venues key", async () => {
    const before = await snapshot();
    await expectRejected(await send("POST", "fi-nowhere/floor-items", json(valid), ALL), "venue_not_found", 404);
    expect(await snapshot()).toEqual(before);
  });
});

describe("POST /floor-items still accepts what the staff app and the demo send", () => {
  it("accepts every element type of the editor with its size, and the demo items", async () => {
    const sent = [
      { type: "bar", label: "Barra", width: 200, height: 44 },
      { type: "large-plant", label: "Planta grande", width: 64, height: 64 },
      { type: "wine-rack", label: "Vinoteca", width: 96, height: 24 },
      { type: "window", label: "Ventana", width: 80, height: 6 },
      { type: "plant", label: "", posX: 540, posY: 200, width: 40, height: 40 },
      { type: "kitchen", label: "Cocina", posX: 620, posY: 340, width: 160, height: 100 },
    ];
    for (const body of sent) {
      const res = await send("POST", `${VENUE}/floor-items`, json(body));
      expect(res.status, body.type).toBe(201);
    }
    expect((await snapshot()).filter((r) => r.venueId === VENUE)).toHaveLength(1 + sent.length);
  });

  it("applies the defaults and accepts the edge values", async () => {
    const res = await send("POST", `${VENUE}/floor-items`, json({ type: "x" }));
    expect(res.status).toBe(201);
    expect((await res.json()).item).toMatchObject({ type: "x", label: "", posX: 0, posY: 0, width: 80, height: 40, rotation: 0 });
    const edge = { type: "t".repeat(32), label: "l".repeat(80), posX: 10000, posY: 0, width: 2000, height: 1 };
    expect((await send("POST", `${VENUE}/floor-items`, json(edge))).status).toBe(201);
  });
});

describe("POST /floor-items with an Idempotency-Key", () => {
  const KEY = { "Idempotency-Key": "fi-key-1" };

  it("returns the first item on a repeat and adds no second one", async () => {
    const first = await send("POST", `${VENUE}/floor-items`, json(valid), ADMIN, KEY);
    expect(first.status).toBe(201);
    const created = (await first.json()).item;
    const again = await send("POST", `${VENUE}/floor-items`, json(valid), ADMIN, KEY);
    expect(again.status).toBe(201);
    const body = await again.json();
    expect(body.item).toEqual(created);
    expect(body.items.filter((i: { type: string }) => i.type === "bar")).toHaveLength(2); // the seeded one and this one
    expect((await snapshot()).filter((r) => r.venueId === VENUE)).toHaveLength(2);
  });

  it("adds an item for each repeat without a key, as before", async () => {
    await send("POST", `${VENUE}/floor-items`, json(valid));
    await send("POST", `${VENUE}/floor-items`, json(valid));
    expect((await snapshot()).filter((r) => r.venueId === VENUE)).toHaveLength(3);
  });

  it("keeps the key apart per venue", async () => {
    await send("POST", `${VENUE}/floor-items`, json(valid), ALL, KEY);
    const res = await send("POST", `${OTHER}/floor-items`, json(valid), ALL, KEY);
    expect(res.status).toBe(201);
  });

  it("refuses an empty or over-long key, writing nothing", async () => {
    const before = await snapshot();
    for (const k of ["", "k".repeat(201)]) {
      await expectRejected(await send("POST", `${VENUE}/floor-items`, json(valid), ADMIN, { "Idempotency-Key": k }), "invalid_request", 400);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("answers the repeat of a key whose item was deleted without making a new one", async () => {
    const created = (await (await send("POST", `${VENUE}/floor-items`, json(valid), ADMIN, KEY)).json()).item;
    await send("DELETE", `${VENUE}/floor-items/${created.id}`);
    const again = await send("POST", `${VENUE}/floor-items`, json(valid), ADMIN, KEY);
    expect(again.status).toBe(201);
    expect((await again.json()).item).toBeUndefined();
    expect((await snapshot()).filter((r) => r.venueId === VENUE)).toHaveLength(1);
  });
});

describe("PATCH /floor-items/{itemId} rejects a bad body and writes nothing", () => {
  const cases: [string, string | undefined][] = [
    ["a malformed JSON body", "{not json"],
    ["a null body", "null"],
    ["an empty body", ""],
    ["no body", undefined],
    ["an array body", "[]"],
    ["an empty object", "{}"],
    ["a string x", json({ x: "5" })],
    ["a null x", json({ x: null })],
    ["a fractional x", json({ x: 1.5 })],
    ["a negative y", json({ y: -1 })],
    ["x over 10000", json({ x: 10001 })],
    ["x beyond the int range", json({ x: 1e12 })],
    ["rotation of 360", json({ rotation: 360 })],
    ["a negative rotation", json({ rotation: -90 })],
    ["a fractional rotation", json({ rotation: 90.5 })],
    ["width of 0", json({ width: 0 })],
    ["width over 2000", json({ width: 2001 })],
    ["a fractional height", json({ height: 2.5 })],
    ["a null height", json({ height: null })],
    ["a type", json({ type: "plant" })],
    ["a label", json({ x: 1, label: "otra" })],
    ["a body id", json({ x: 1, id: "other" })],
    ["a valid field next to an invalid one", json({ x: 5, y: "6" })],
  ];

  it.each(cases)("%s", async (_name, body) => {
    const before = await snapshot();
    await expectRejected(await send("PATCH", `${VENUE}/floor-items/i1`, body), "invalid_request", 400);
    expect(await snapshot()).toEqual(before);
  });

  it("answers venue_not_found for an unknown venue, even with the all-venues key", async () => {
    const before = await snapshot();
    await expectRejected(await send("PATCH", "fi-nowhere/floor-items/i1", json({ x: 1 }), ALL), "venue_not_found", 404);
    expect(await snapshot()).toEqual(before);
  });
});

describe("PATCH /floor-items/{itemId}", () => {
  it("keeps accepting the moves, resizes and rotations the editor sends", async () => {
    for (const body of [{ x: 0, y: 0 }, { x: 10000, y: 10000 }, { rotation: 270 }, { width: 2000, height: 1 }, { x: 40, y: 8, width: 120, height: 24, rotation: 90 }]) {
      expect((await send("PATCH", `${VENUE}/floor-items/i1`, json(body))).status, json(body)).toBe(200);
    }
    const [row] = (await snapshot()).filter((r) => r.id === "i1");
    expect(row).toMatchObject({ posX: 40, posY: 8, width: 120, height: 24, rotation: 90 });
  });

  it("answers the same floor_item_not_found for an unknown id and another venue's item, and changes nothing", async () => {
    const before = await snapshot();
    const unknown = await send("PATCH", `${VENUE}/floor-items/nope`, json({ x: 5 }));
    const foreign = await send("PATCH", `${VENUE}/floor-items/o1`, json({ x: 5 }));
    await expectRejected(unknown, "floor_item_not_found", 404);
    await expectRejected(foreign, "floor_item_not_found", 404);
    expect(await snapshot()).toEqual(before);
  });
});

describe("DELETE /floor-items/{itemId}", () => {
  it("answers 200 and the same items for an unknown id and another venue's item, deleting nothing", async () => {
    const before = await snapshot();
    const unknown = await send("DELETE", `${VENUE}/floor-items/nope`);
    const foreign = await send("DELETE", `${VENUE}/floor-items/o1`);
    expect(unknown.status).toBe(200);
    expect(foreign.status).toBe(200);
    expect(await unknown.json()).toEqual(await foreign.json());
    expect(await snapshot()).toEqual(before);
  });

  it("deletes an item of the venue", async () => {
    const res = await send("DELETE", `${VENUE}/floor-items/i1`);
    expect(res.status).toBe(200);
    expect((await res.json()).items).toEqual([]);
  });

  it("answers venue_not_found for an unknown venue, even with the all-venues key", async () => {
    const before = await snapshot();
    await expectRejected(await send("DELETE", "fi-nowhere/floor-items/i1", undefined, ALL), "venue_not_found", 404);
    expect(await snapshot()).toEqual(before);
  });
});

describe("POST /services bounds the name", () => {
  const body = (name: string) => json({ name, openStart: "12:00", openEnd: "16:00" });

  it("refuses a name over 200 characters and stores nothing", async () => {
    await expectRejected(await send("POST", `${VENUE}/services`, body("n".repeat(201))), "invalid_request", 400);
    expect(await db.select().from(services)).toEqual([]);
  });

  it("accepts a name of 200 characters", async () => {
    expect((await send("POST", `${VENUE}/services`, body("n".repeat(200)))).status).toBe(200);
  });
});
