import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";

const V = "tv";
const OTHER = "tv-other";

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE account, session, verification, "user", venue_memberships, floor_items, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
  for (const id of [V, OTHER]) {
    await db.insert(venues).values({ id, timezone: "Europe/Madrid", enabled: true });
    await db.insert(tables).values({ id: "1", venueId: id, name: `T-${id}`, seats: 4 });
    await db.insert(services).values({ venueId: id, name: "lunch", openStart: "12:00", openEnd: "16:00" });
    await addKey(db, `admin-${id}`, "owner", [id], "admin");
  }
});

function call(method: string, path: string, body?: unknown, raw?: string, venue = V) {
  return app.request(`/v1/venues/${venue}${path}`, {
    method,
    headers: { apikey: `admin-${venue}`, "content-type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}

const snapshot = async () => ({
  tables: await db.select().from(tables).orderBy(tables.venueId, tables.id),
  services: await db.select().from(services).orderBy(services.venueId, services.name),
});

async function expectRefused(method: string, path: string, body?: unknown, raw?: string) {
  const before = await snapshot();
  const res = await call(method, path, body, raw);
  expect(res.status, JSON.stringify({ method, path, body, raw })).toBe(400);
  expect(((await res.json()) as { code: string }).code).toBe("invalid_request");
  expect(await snapshot()).toEqual(before);
}

const valid = { id: "ok1", name: "Mesa", seats: 4 };

describe("POST /tables validation", () => {
  it.each([undefined, "", "{", "null", "[]", "5", '"x"'])("refuses the body %j", async (raw) => {
    await expectRefused("POST", "/tables", undefined, raw ?? "");
  });

  it.each([
    ["id missing", { name: "M", seats: 2 }],
    ["id empty", { ...valid, id: "" }],
    ["id number", { ...valid, id: 5 }],
    ["id with spaces", { ...valid, id: "a b" }],
    ["id with slash", { ...valid, id: "a/b" }],
    ["id 65 chars", { ...valid, id: "a".repeat(65) }],
    ["id 5000 chars", { ...valid, id: "a".repeat(5000) }],
    ["name missing", { id: "n", seats: 2 }],
    ["name empty", { ...valid, name: "" }],
    ["name blank", { ...valid, name: "   " }],
    ["name number", { ...valid, name: 3 }],
    ["name 101 chars", { ...valid, name: "n".repeat(101) }],
    ["seats missing", { id: "n", name: "M" }],
    ["seats 0", { ...valid, seats: 0 }],
    ["seats negative", { ...valid, seats: -1 }],
    ["seats fractional", { ...valid, seats: 2.5 }],
    ["seats 201", { ...valid, seats: 201 }],
    ["seats 5000", { ...valid, seats: 5000 }],
    ["seats overflowing an integer", { ...valid, seats: 99999999999 }],
    ["seats string", { ...valid, seats: "4" }],
    ["seats null", { ...valid, seats: null }],
    ["zone number", { ...valid, zone: 4 }],
    ["zone null", { ...valid, zone: null }],
    ["zone 101 chars", { ...valid, zone: "z".repeat(101) }],
    ["shape unknown", { ...valid, shape: "hexagon" }],
    ["shape number", { ...valid, shape: 1 }],
    ["shape empty", { ...valid, shape: "" }],
    ["unknown field", { ...valid, posX: 5 }],
  ])("refuses %s and writes nothing", async (_label, body) => {
    await expectRefused("POST", "/tables", body);
  });

  it("accepts the values the staff app and the demo template send", async () => {
    for (const shape of ["round", "oval", "square", "rectangle", "long", "rect"]) {
      const res = await call("POST", "/tables", { id: `s-${shape}`, name: "Mesa 1", seats: 2, zone: "Terraza", shape });
      expect(res.status).toBe(200);
    }
    for (const id of ["1", "T1", "mesa_2", "a.b-c:9", "a".repeat(64)]) {
      expect((await call("POST", "/tables", { id, name: "M", seats: 200 })).status).toBe(200);
    }
    expect((await call("POST", "/tables", { id: "z", name: "M", seats: 1, zone: "" })).status).toBe(200);
    expect((await call("POST", "/tables", { id: "z", name: "M", seats: 1, zone: undefined, shape: undefined })).status).toBe(200);
  });

  it("stores the trimmed name and answers with the venue tables", async () => {
    const res = await call("POST", "/tables", { id: "trim", name: "  Mesa 9  ", seats: 3 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tables: { id: string; name: string; shape: string }[] };
    expect(body.tables.find((t) => t.id === "trim")).toMatchObject({ name: "Mesa 9", shape: "round" });
  });
});

describe("PATCH /tables/{tableId} validation", () => {
  it.each([undefined, "", "{", "null", "[]", "5"])("refuses the body %j", async (raw) => {
    await expectRefused("PATCH", "/tables/1", undefined, raw ?? "");
  });

  it.each([
    ["x fractional", { x: 1.5 }],
    ["x huge", { x: 1e12 }],
    ["x overflowing", { x: 99999999999 }],
    ["x string", { x: "5" }],
    ["x null", { x: null }],
    ["x NaN-like", { x: 1e999 }],
    ["y fractional", { y: 0.1 }],
    ["y over the bound", { y: 10001 }],
    ["y under the bound", { y: -10001 }],
    ["rotation fractional", { rotation: 90.5 }],
    ["rotation over", { rotation: 361 }],
    ["rotation boolean", { rotation: true }],
    ["name ignored before", { name: "x" }],
    ["seats ignored before", { seats: 9 }],
    ["one bad field spoils a good one", { x: 5, y: "no" }],
  ])("refuses %s and writes nothing", async (_label, body) => {
    await expectRefused("PATCH", "/tables/1", body);
  });

  it("moves and rotates a table", async () => {
    const res = await call("PATCH", "/tables/1", { x: 120, y: -40, rotation: 90 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tables: { id: string; posX: number; posY: number; rotation: number }[] };
    expect(body.tables.find((t) => t.id === "1")).toMatchObject({ posX: 120, posY: -40, rotation: 90 });
    expect((await call("PATCH", "/tables/1", { rotation: 270 })).status).toBe(200);
    expect((await call("PATCH", "/tables/1", {})).status).toBe(200);
  });

  it("answers invalid_request for an unknown table, and for a table of another venue, writing nothing", async () => {
    await db.insert(tables).values({ id: "only-other", venueId: OTHER, name: "O", seats: 2 }).onConflictDoNothing();
    await expectRefused("PATCH", "/tables/nope", { x: 5 });
    await expectRefused("PATCH", "/tables/only-other", { x: 5 });
    await expectRefused("PATCH", "/tables/nope", {});
    await expectRefused("PATCH", `/tables/${"a".repeat(300)}`, { x: 5 });
  });

  it("answers an unknown id of this venue the same as another venue's id", async () => {
    const a = await call("PATCH", "/tables/nope", { x: 5 });
    const b = await call("PATCH", "/tables/only-other", { x: 5 });
    expect(b.status).toBe(a.status);
    expect(await b.json()).toEqual(await a.json());
  });
});

describe("DELETE of an unknown table or service", () => {
  it("answers 200 and changes nothing", async () => {
    const before = await snapshot();
    for (const path of ["/tables/nope", "/tables/only-other", "/services/ghost", "/services/%20"]) {
      const res = await call("DELETE", path);
      expect(res.status, path).toBe(200);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("refuses an id or name over the length bound", async () => {
    await expectRefused("DELETE", `/tables/${"a".repeat(300)}`);
    await expectRefused("DELETE", `/services/${"a".repeat(300)}`);
  });

  it("still deletes a known table and a known service", async () => {
    await call("POST", "/tables", { id: "gone", name: "G", seats: 2 });
    const res = await call("DELETE", "/tables/gone");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { tables: { id: string }[] }).tables.some((t) => t.id === "gone")).toBe(false);
    const del = await call("DELETE", "/services/lunch");
    expect(del.status).toBe(200);
    expect(((await del.json()) as { services: unknown[] }).services).toEqual([]);
    expect((await db.select().from(services)).filter((s) => s.venueId === OTHER)).toHaveLength(1);
  });
});
