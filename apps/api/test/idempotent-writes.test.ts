import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { events, idempotencyKeys, reservations, services, tables, venues, waitlist } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";

const DATE = "2026-11-12";
let venueCounter = 0;

async function seedVenue() {
  const venueId = `idem-${++venueCounter}`;
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid" });
  await db.insert(services).values([{ venueId, name: "all", openStart: "00:00", openEnd: "24:00" }]);
  await db.insert(tables).values([
    { id: "1", venueId, name: "T1", seats: 4 },
    { id: "2", venueId, name: "T2", seats: 4 },
    { id: "3", venueId, name: "T3", seats: 4 },
  ]);
  await addKey(db, `write-${venueId}`, "writer", [venueId], "write");
  return venueId;
}

function post(venueId: string, path: string, key: string | undefined, body?: unknown) {
  return app.request(`/v1/venues/${venueId}${path}`, {
    method: "POST",
    headers: {
      apikey: `write-${venueId}`,
      "content-type": "application/json",
      ...(key === undefined ? {} : { "Idempotency-Key": key }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function snapshot(res: Response) {
  return { status: res.status, body: await res.json() };
}

const countOf = async (table: typeof reservations | typeof waitlist | typeof events, venueId: string) =>
  (await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.venueId, venueId)))[0].n;

const keysOf = async (venueId: string) =>
  db.select().from(idempotencyKeys).where(eq(idempotencyKeys.venueId, venueId));

async function addEntry(venueId: string, key: string | undefined, body: Record<string, unknown> = {}) {
  return post(venueId, "/waitlist", key, { partySize: 2, guest: { name: "Ana" }, ...body });
}

async function entryIds(venueId: string) {
  return (await db.select({ id: waitlist.id }).from(waitlist).where(eq(waitlist.venueId, venueId))).map((r) => r.id);
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, guest_audit, guests, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

async function book(venueId: string, key: string, body: Record<string, unknown> = {}) {
  const res = await post(venueId, "/reservations", key, { date: DATE, time: "21:00", partySize: 2, ...body });
  expect(res.status).toBe(200);
  return (await res.json()).id as string;
}

async function waitingEntry(venueId: string) {
  const before = new Set(await entryIds(venueId));
  expect((await addEntry(venueId, undefined)).status).toBe(201);
  return (await entryIds(venueId)).find((id) => !before.has(id)) as string;
}

const entryStatus = async (id: string) =>
  (await db.select({ status: waitlist.status }).from(waitlist).where(eq(waitlist.id, id)))[0]?.status;

describe("the same key twice returns the first answer and writes once", () => {
  const cases: {
    name: string;
    prepare: (venueId: string) => Promise<{ path: string; body?: unknown; effects: () => Promise<unknown> }>;
  }[] = [
    {
      name: "reservation create",
      prepare: async (venueId) => ({
        path: "/reservations",
        body: { date: DATE, time: "21:00", partySize: 2 },
        effects: async () => [await countOf(reservations, venueId), await countOf(events, venueId)],
      }),
    },
    {
      name: "walk-in",
      prepare: async (venueId) => ({
        path: "/reservations/walk-in",
        body: { partySize: 2 },
        effects: async () => [await countOf(reservations, venueId), await countOf(events, venueId)],
      }),
    },
    {
      name: "modify",
      prepare: async (venueId) => {
        const id = await book(venueId, "setup");
        return { path: `/reservations/${id}/modify`, body: { partySize: 3 }, effects: () => countOf(events, venueId) };
      },
    },
    {
      name: "reservation cancel",
      prepare: async (venueId) => {
        const id = await book(venueId, "setup");
        return { path: `/reservations/${id}/cancel`, effects: () => countOf(events, venueId) };
      },
    },
    {
      name: "status",
      prepare: async (venueId) => {
        const id = await book(venueId, "setup", { tables: ["1"] });
        return { path: `/reservations/${id}/status`, body: { status: "seated" }, effects: () => countOf(events, venueId) };
      },
    },
    {
      name: "waitlist add",
      prepare: async (venueId) => ({
        path: "/waitlist",
        body: { partySize: 2, guest: { name: "Ana" } },
        effects: () => countOf(waitlist, venueId),
      }),
    },
    {
      name: "waitlist seat",
      prepare: async (venueId) => {
        const id = await waitingEntry(venueId);
        return {
          path: `/waitlist/${id}/seat`,
          effects: async () => [await countOf(reservations, venueId), await entryStatus(id)],
        };
      },
    },
    {
      name: "waitlist cancel",
      prepare: async (venueId) => {
        const id = await waitingEntry(venueId);
        return { path: `/waitlist/${id}/cancel`, effects: () => entryStatus(id) };
      },
    },
  ];

  for (const { name, prepare } of cases) {
    it(name, async () => {
      const venueId = await seedVenue();
      const { path, body, effects } = await prepare(venueId);
      const first = await snapshot(await post(venueId, path, "retry-1", body));
      expect(first.status).toBeLessThan(300);
      const afterFirst = await effects();
      const second = await snapshot(await post(venueId, path, "retry-1", body));
      expect(second).toEqual(first);
      expect(await effects()).toEqual(afterFirst);
    });
  }
});

describe("concurrent duplicates with one key", () => {
  it("create: one reservation, every caller gets it", async () => {
    const venueId = await seedVenue();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => post(venueId, "/reservations", "race-create", { date: DATE, time: "21:00", partySize: 2 })),
    );
    const bodies = await Promise.all(results.map(snapshot));
    expect(bodies.map((b) => b.status)).toEqual([200, 200, 200, 200, 200]);
    expect(new Set(bodies.map((b) => b.body.id)).size).toBe(1);
    expect(await countOf(reservations, venueId)).toBe(1);
  });

  it("waitlist add: one entry", async () => {
    const venueId = await seedVenue();
    const results = await Promise.all(Array.from({ length: 5 }, () => addEntry(venueId, "race-add")));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(await countOf(waitlist, venueId)).toBe(1);
  });

  it("waitlist seat: one reservation, every caller gets it", async () => {
    const venueId = await seedVenue();
    const id = await waitingEntry(venueId);
    const bodies = await Promise.all(
      Array.from({ length: 4 }, async () => snapshot(await post(venueId, `/waitlist/${id}/seat`, "race-seat"))),
    );
    expect(bodies.map((b) => b.status)).toEqual([200, 200, 200, 200]);
    expect(new Set(bodies.map((b) => b.body.id)).size).toBe(1);
    expect(await countOf(reservations, venueId)).toBe(1);
  });

  it("waitlist seat with different keys: one reservation, the loser gets invalid_transition", async () => {
    const venueId = await seedVenue();
    const id = await waitingEntry(venueId);
    const results = await Promise.all(
      ["seat-a", "seat-b", "seat-c"].map(async (key) => snapshot(await post(venueId, `/waitlist/${id}/seat`, key))),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const losers = results.filter((r) => r.status !== 200);
    expect(losers.map((r) => r.body.code)).toEqual(["invalid_transition", "invalid_transition"]);
    expect(await countOf(reservations, venueId)).toBe(1);
    expect(await entryStatus(id)).toBe("seated");
  });

  it("waitlist cancel and reservation cancel: every caller succeeds, one change", async () => {
    const venueId = await seedVenue();
    const entry = await waitingEntry(venueId);
    const reservation = await book(venueId, "setup");
    const eventsBefore = await countOf(events, venueId);
    const results = await Promise.all([
      ...Array.from({ length: 3 }, () => post(venueId, `/waitlist/${entry}/cancel`, "race-wl-cancel")),
      ...Array.from({ length: 3 }, () => post(venueId, `/reservations/${reservation}/cancel`, "race-cancel")),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(await entryStatus(entry)).toBe("cancelled");
    expect(await countOf(events, venueId)).toBe(eventsBefore + 1);
  });
});

describe("a key reused for a different request", () => {
  it("fails with invalid_request when it names another waitlist entry or another kind of write", async () => {
    const venueId = await seedVenue();
    const [a, b] = [await waitingEntry(venueId), await waitingEntry(venueId)];
    expect((await post(venueId, `/waitlist/${a}/cancel`, "reused")).status).toBe(200);
    const other = await post(venueId, `/waitlist/${b}/cancel`, "reused");
    expect(other.status).toBe(400);
    expect((await other.json()).code).toBe("invalid_request");
    expect(await entryStatus(b)).toBe("waiting");

    expect((await addEntry(venueId, "add-key")).status).toBe(201);
    expect((await post(venueId, "/reservations", "add-key", { date: DATE, time: "21:00", partySize: 2 })).status).toBe(400);
    expect((await post(venueId, `/waitlist/${b}/cancel`, "add-key")).status).toBe(400);
    expect((await addEntry(venueId, "reused")).status).toBe(400);
    expect(await countOf(reservations, venueId)).toBe(0);
    expect(await entryStatus(b)).toBe("waiting");
  });

  it("fails with invalid_request when a seat key is reused on another entry", async () => {
    const venueId = await seedVenue();
    const [a, b] = [await waitingEntry(venueId), await waitingEntry(venueId)];
    expect((await post(venueId, `/waitlist/${a}/seat`, "seat-key")).status).toBe(200);
    const other = await post(venueId, `/waitlist/${b}/seat`, "seat-key");
    expect(other.status).toBe(400);
    expect(await entryStatus(b)).toBe("waiting");
    expect(await countOf(reservations, venueId)).toBe(1);
  });

  it("waitlist add, like create, replays the first entry when the body differs", async () => {
    const venueId = await seedVenue();
    const first = await snapshot(await addEntry(venueId, "add-twice", { partySize: 2 }));
    const second = await snapshot(await addEntry(venueId, "add-twice", { partySize: 6 }));
    expect(second).toEqual(first);
    expect(first.body.entries.map((e: { partySize: number }) => e.partySize)).toEqual([2]);
  });
});

describe("keys belong to one venue", () => {
  it("the same key in two venues writes in each", async () => {
    const [here, there] = [await seedVenue(), await seedVenue()];
    for (const venueId of [here, there]) {
      expect((await addEntry(venueId, "shared-key")).status).toBe(201);
      expect(await countOf(waitlist, venueId)).toBe(1);
    }
    const [a, b] = [await waitingEntry(here), await waitingEntry(there)];
    expect((await post(here, `/waitlist/${a}/cancel`, "shared-cancel")).status).toBe(200);
    expect((await post(there, `/waitlist/${b}/cancel`, "shared-cancel")).status).toBe(200);
    expect([await entryStatus(a), await entryStatus(b)]).toEqual(["cancelled", "cancelled"]);
  });

  it("a key used in another venue never replays that venue's entry", async () => {
    const [here, there] = [await seedVenue(), await seedVenue()];
    await addEntry(here, "probe", { guest: { name: "Secret" } });
    const res = await snapshot(await addEntry(there, "probe", { guest: { name: "Bea" } }));
    expect(res.body.entries.map((e: { guestName: string }) => e.guestName)).toEqual(["Bea"]);
  });
});

describe("a write that fails stores no key", () => {
  it("waitlist cancel of an unknown entry, then the same key cancels a real one", async () => {
    const venueId = await seedVenue();
    expect((await post(venueId, "/waitlist/missing/cancel", "late")).status).toBe(404);
    expect(await keysOf(venueId)).toEqual([]);
    const id = await waitingEntry(venueId);
    expect((await post(venueId, `/waitlist/${id}/cancel`, "late")).status).toBe(200);
    expect(await entryStatus(id)).toBe("cancelled");
  });

  it("waitlist seat with no free table, then the same key seats once a table frees", async () => {
    const venueId = await seedVenue();
    const walkIns: string[] = [];
    for (const table of ["1", "2", "3"]) {
      const res = await post(venueId, "/reservations/walk-in", `fill-${table}`, { partySize: 4, tables: [table] });
      expect(res.status).toBe(200);
      walkIns.push((await res.json()).id);
    }
    const id = await waitingEntry(venueId);
    expect((await post(venueId, `/waitlist/${id}/seat`, "seat-later")).status).toBe(409);
    expect((await keysOf(venueId)).filter((k) => k.key === "seat-later")).toEqual([]);
    expect(await entryStatus(id)).toBe("waiting");

    expect((await post(venueId, `/reservations/${walkIns[0]}/status`, "free-1", { status: "attended" })).status).toBe(200);
    expect((await post(venueId, `/waitlist/${id}/seat`, "seat-later")).status).toBe(200);
    expect(await entryStatus(id)).toBe("seated");
  });

  it("a create refused with slot_taken leaves its key free", async () => {
    const venueId = await seedVenue();
    await book(venueId, "holder", { tables: ["1"] });
    const refused = await post(venueId, "/reservations", "taken", { date: DATE, time: "21:00", partySize: 2, tables: ["1"] });
    expect(refused.status).toBe(409);
    const keys = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.venueId, venueId), eq(idempotencyKeys.key, "taken")));
    expect(keys).toEqual([]);
  });
});

describe("waitlist writes without a key", () => {
  it("still work, and two adds make two entries", async () => {
    const venueId = await seedVenue();
    expect((await addEntry(venueId, undefined)).status).toBe(201);
    expect((await addEntry(venueId, undefined)).status).toBe(201);
    expect(await countOf(waitlist, venueId)).toBe(2);
    const [id] = await entryIds(venueId);
    expect((await post(venueId, `/waitlist/${id}/cancel`, undefined)).status).toBe(200);
    expect(await keysOf(venueId)).toEqual([]);
  });
});
