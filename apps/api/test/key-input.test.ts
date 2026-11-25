// Input checks on the key routes (#385, part 3): POST and DELETE /v1/venues/{venueId}/keys and /v1/auth/keys.
// A bad request answers `invalid_request` (or a not-found or conflict code) and writes nothing, never a 500 or a
// silent success.
import { asc, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { apiKeys, grants, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { sha256Hex } from "../src/lib/reservations";

const VENUE = "ki-a";
const OTHER = "ki-b";
const ADMIN = "ki-admin"; // admin of VENUE only, stored before the length rule
const ALL = "ki-all"; // admin key with the all-venues grant
const AGENT = "ki-agent-0123456789abcdefghijklmnopq"; // a write key of VENUE, 36 characters
const FOREIGN = "ki-foreign-0123456789abcdefghijklmno"; // a write key of OTHER only

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE account, session, verification, "user", venue_memberships, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
  await db.insert(venues).values([{ id: VENUE }, { id: OTHER }]);
});

beforeEach(async () => {
  await db.delete(grants);
  await db.delete(apiKeys);
  await addKey(db, ADMIN, "owner", [VENUE], "admin");
  await addKey(db, ALL, "operator", ["*"], "admin");
  await addKey(db, AGENT, "agent", [VENUE], "write");
  await addKey(db, FOREIGN, "foreign", [OTHER], "write");
});

const snapshot = async () => ({
  keys: await db.select().from(apiKeys).orderBy(asc(apiKeys.hash)),
  grants: await db.select().from(grants).orderBy(asc(grants.keyHash), asc(grants.venueId)),
});

function send(method: string, path: string, body?: string, key = ADMIN) {
  return app.request(path, { method, headers: { apikey: key, "Content-Type": "application/json" }, body });
}

async function expectRejected(res: Response, code: string, status: number) {
  expect(res.status).toBe(status);
  expect(await res.json()).toEqual({ code, message: expect.any(String), retryable: false });
}

const agenda = (venueId: string, key: string) =>
  app.request(`/v1/venues/${venueId}/agenda?date=2026-11-12`, { headers: { apikey: key } });

const json = (value: unknown) => JSON.stringify(value);
const NEW = "ki-new-0123456789abcdefghijklmnopqrs"; // 35 characters
const valid = { key: NEW, principal: "new-agent", role: "write" };
const keysPath = (venueId = VENUE) => `/v1/venues/${venueId}/keys`;

const badBodies: [string, string | undefined][] = [
  ["a malformed JSON body", "{not json"],
  ["a null body", "null"],
  ["an empty body", ""],
  ["no body", undefined],
  ["an array body", json([valid])],
  ["a number body", "5"],
  ["an empty object", "{}"],
];

const badKeyFields: [string, Record<string, unknown>][] = [
  ["a missing key", { principal: "p", role: "write" }],
  ["an empty key", { ...valid, key: "" }],
  ["a one-character key", { ...valid, key: "a" }],
  ["a key of 31 characters", { ...valid, key: "k".repeat(31) }],
  ["a key over 256 characters", { ...valid, key: "k".repeat(257) }],
  ["a key with a space", { ...valid, key: `${NEW} x` }],
  ["a key with a non-ASCII character", { ...valid, key: `${NEW}ñ` }],
  ["a numeric key", { ...valid, key: 12345678901234567890123456789012345 }],
  ["a null key", { ...valid, key: null }],
  ["a missing principal", { key: NEW, role: "write" }],
  ["an empty principal", { ...valid, principal: "" }],
  ["a principal of spaces", { ...valid, principal: "   " }],
  ["a principal over 200 characters", { ...valid, principal: "p".repeat(201) }],
  ["a numeric principal", { ...valid, principal: 5 }],
  ["a missing role", { key: NEW, principal: "p" }],
  ["an unknown role", { ...valid, role: "owner" }],
  ["an unknown field", { ...valid, note: "x" }],
];

describe("POST /venues/{venueId}/keys rejects a bad body and writes nothing", () => {
  it.each([...badBodies, ...badKeyFields.map(([n, b]): [string, string] => [n, json(b)])])("%s", async (_name, body) => {
    const before = await snapshot();
    await expectRejected(await send("POST", keysPath(), body), "invalid_request", 400);
    expect(await snapshot()).toEqual(before);
  });

  it("refuses an admin role, as before", async () => {
    const before = await snapshot();
    await expectRejected(await send("POST", keysPath(), json({ ...valid, role: "admin" })), "invalid_request", 400);
    expect(await snapshot()).toEqual(before);
  });

  it("refuses a key in the query string, with or without a body", async () => {
    const before = await snapshot();
    await expectRejected(await send("POST", `${keysPath()}?key=${NEW}`), "invalid_request", 400);
    await expectRejected(await send("POST", `${keysPath()}?key=${NEW}`, json(valid)), "invalid_request", 400);
    expect(await snapshot()).toEqual(before);
    expect((await agenda(VENUE, NEW)).status).toBe(401);
  });

  it("accepts a key of 32 and of 256 visible ASCII characters", async () => {
    for (const key of ["k".repeat(32), `${"+/=_-~!".repeat(36)}abcd`]) {
      const res = await send("POST", keysPath(), json({ ...valid, key, principal: `p${key.length}` }));
      expect(res.status).toBe(201);
      expect((await agenda(VENUE, key)).status).toBe(200);
    }
  });

  it("keeps a key stored before the length rule working", async () => {
    expect((await agenda(VENUE, ADMIN)).status).toBe(200);
  });
});

describe("POST /venues/{venueId}/keys for a venue the caller cannot write to", () => {
  it("answers venue_not_found for an unknown venue, also with an all-venues admin key, and writes nothing", async () => {
    const before = await snapshot();
    await expectRejected(await send("POST", keysPath("ki-nowhere"), json(valid), ALL), "venue_not_found", 404);
    await expectRejected(await send("POST", keysPath("ki-nowhere"), json(valid)), "venue_not_found", 404);
    expect(await snapshot()).toEqual(before);
    expect((await agenda("ki-nowhere", NEW)).status).toBe(401);
  });

  it("answers venue_not_found for another venue the key does not hold", async () => {
    const before = await snapshot();
    await expectRejected(await send("POST", keysPath(OTHER), json(valid)), "venue_not_found", 404);
    expect(await snapshot()).toEqual(before);
  });
});

describe("POST /venues/{venueId}/keys with a key that is already registered", () => {
  it("answers the same 201 for the same principal and role and adds no grant", async () => {
    const first = await send("POST", keysPath(), json(valid));
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    const after = await snapshot();
    const again = await send("POST", keysPath(), json(valid));
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual(firstBody);
    expect(await snapshot()).toEqual(after);
  });

  it("answers key_conflict for another principal or role, changes nothing and names no owner", async () => {
    const before = await snapshot();
    for (const body of [
      { key: AGENT, principal: "someone-else", role: "write" },
      { key: AGENT, principal: "agent", role: "read" },
      { key: FOREIGN, principal: "taker", role: "read" },
      { key: FOREIGN, principal: "foreign", role: "read" },
    ]) {
      const res = await send("POST", keysPath(), json(body));
      expect(res.status).toBe(409);
      const text = await res.clone().text();
      expect(text).not.toMatch(/agent|foreign|operator|admin|ki-b/);
      await expectRejected(res, "key_conflict", 409);
    }
    expect(await snapshot()).toEqual(before);
    expect((await agenda(VENUE, FOREIGN)).status).toBe(404);
  });

  it("grants this venue to a key of another venue registered with the same principal and role", async () => {
    const res = await send("POST", keysPath(), json({ key: FOREIGN, principal: "foreign", role: "write" }));
    expect(res.status).toBe(201);
    expect((await agenda(VENUE, FOREIGN)).status).toBe(200);
    expect((await agenda(OTHER, FOREIGN)).status).toBe(200);
  });
});

describe("DELETE /venues/{venueId}/keys", () => {
  const badRevokes: [string, string | undefined][] = [
    ...badBodies,
    ["a numeric hash", json({ hash: 5 })],
    ["a null hash", json({ hash: null })],
    ["a hash that is not 64 lower-case hex characters", json({ hash: "abc" })],
    ["an upper-case hash", json({ hash: "A".repeat(64) })],
    ["the key instead of its hash", json({ key: AGENT })],
    ["an unknown field", json({ hash: "0".repeat(64), note: "x" })],
  ];

  it.each(badRevokes)("rejects %s and revokes nothing", async (_name, body) => {
    const before = await snapshot();
    await expectRejected(await send("DELETE", keysPath(), body), "invalid_request", 400);
    expect(await snapshot()).toEqual(before);
  });

  it("refuses a hash in the query string, with or without a body", async () => {
    const hash = await sha256Hex(AGENT);
    const before = await snapshot();
    await expectRejected(await send("DELETE", `${keysPath()}?hash=${hash}`), "invalid_request", 400);
    await expectRejected(await send("DELETE", `${keysPath()}?hash=${hash}`, json({ hash })), "invalid_request", 400);
    expect(await snapshot()).toEqual(before);
    expect((await agenda(VENUE, AGENT)).status).toBe(200);
  });

  it("answers 200 with the same keys for an unknown hash and another venue's key, and revokes nothing", async () => {
    const list = await (await send("GET", keysPath())).json();
    const before = await snapshot();
    for (const hash of ["0".repeat(64), await sha256Hex(FOREIGN)]) {
      const res = await send("DELETE", keysPath(), json({ hash }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(list);
    }
    expect(await snapshot()).toEqual(before);
    expect((await agenda(OTHER, FOREIGN)).status).toBe(200);
  });

  it("answers venue_not_found for an unknown venue, also with an all-venues admin key", async () => {
    await expectRejected(
      await send("DELETE", keysPath("ki-nowhere"), json({ hash: "0".repeat(64) }), ALL),
      "venue_not_found",
      404,
    );
  });
});

describe("POST /auth/keys", () => {
  const call = (body?: string, query = "") => send("POST", `/v1/auth/keys${query}`, body, ALL);

  it.each([
    ...badBodies,
    ...badKeyFields.map(([n, b]): [string, string] => [n, json(b)]),
    ["a venues that is not a list", json({ ...valid, venues: VENUE })],
    ["a null venues", json({ ...valid, venues: null })],
    ["a venues with an empty id", json({ ...valid, venues: [""] })],
    ["a venues with a number", json({ ...valid, venues: [1] })],
  ])("rejects %s and writes nothing", async (_name, body) => {
    const before = await snapshot();
    await expectRejected(await call(body), "invalid_request", 400);
    expect(await snapshot()).toEqual(before);
  });

  it("refuses a key in the query string, with or without a body", async () => {
    const before = await snapshot();
    await expectRejected(await call(undefined, `?key=${NEW}`), "invalid_request", 400);
    await expectRejected(await call(json(valid), `?key=${NEW}`), "invalid_request", 400);
    expect(await snapshot()).toEqual(before);
  });

  it("answers ok again for the same principal and role and adds the listed venues", async () => {
    expect((await call(json({ ...valid, venues: [VENUE] }))).status).toBe(200);
    const again = await call(json({ ...valid, venues: [VENUE, OTHER] }));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true });
    expect((await agenda(OTHER, NEW)).status).toBe(200);
    const repeat = await snapshot();
    expect((await call(json({ ...valid, venues: [VENUE, OTHER] }))).status).toBe(200);
    expect(await snapshot()).toEqual(repeat);
  });

  it("answers key_conflict for another principal or role and changes nothing", async () => {
    const before = await snapshot();
    for (const body of [
      { key: AGENT, principal: "taker", role: "write", venues: ["*"] },
      { key: AGENT, principal: "agent", role: "admin", venues: ["*"] },
    ]) {
      await expectRejected(await call(json(body)), "key_conflict", 409);
    }
    expect(await snapshot()).toEqual(before);
    expect((await agenda(OTHER, AGENT)).status).toBe(404);
  });
});

describe("DELETE /auth/keys", () => {
  const call = (body?: string, query = "") => send("DELETE", `/v1/auth/keys${query}`, body, ALL);

  it.each([
    ...badBodies,
    ["an empty key", json({ key: "" })],
    ["a numeric key", json({ key: 5 })],
    ["a null key", json({ key: null })],
    ["a hash instead of the key", json({ hash: "0".repeat(64) })],
    ["an unknown field", json({ key: AGENT, note: "x" })],
  ])("rejects %s and revokes nothing", async (_name, body) => {
    const before = await snapshot();
    await expectRejected(await call(body), "invalid_request", 400);
    expect(await snapshot()).toEqual(before);
  });

  it("refuses a key in the query string, with or without a body", async () => {
    const before = await snapshot();
    await expectRejected(await call(undefined, `?key=${AGENT}`), "invalid_request", 400);
    await expectRejected(await call(json({ key: AGENT }), `?key=${AGENT}`), "invalid_request", 400);
    expect(await snapshot()).toEqual(before);
    expect((await agenda(VENUE, AGENT)).status).toBe(200);
  });

  it("revokes a key stored before the length rule", async () => {
    const res = await call(json({ key: ADMIN }));
    expect(res.status).toBe(200);
    expect((await agenda(VENUE, ADMIN)).status).toBe(401);
  });
});
