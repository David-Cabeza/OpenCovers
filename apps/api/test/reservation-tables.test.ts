import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";

const VENUE = "res-tables";
const headers = { apikey: "res-tables-key", "content-type": "application/json" };
let keyCounter = 0;

function post(path: string, body: unknown) {
  return app.request(`/v1/venues/${VENUE}${path}`, {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": `k-${++keyCounter}` },
    body: JSON.stringify(body),
  });
}

async function get(path: string) {
  const res = await app.request(`/v1/venues/${VENUE}${path}`, { headers });
  return res.json();
}

async function create(extra: Record<string, unknown>) {
  const res = await post("/reservations", { date: "2026-11-12", time: "21:00", partySize: 2, ...extra });
  expect(res.status).toBe(200);
  return res.json();
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
  await db.insert(venues).values({ id: VENUE, timezone: "Europe/Madrid" });
  await db
    .insert(services)
    .values([{ venueId: VENUE, name: "dinner", openStart: "19:00", openEnd: "23:00" }]);
  await db.insert(tables).values(
    Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), venueId: VENUE, name: `T${i + 1}`, seats: 4 })),
  );
  await addKey(db, "res-tables-key", "res-tables-principal", [VENUE], "write");
});

describe("tables on every reservation read", () => {
  it("returns explicit tables sorted ascending", async () => {
    const body = await create({ tables: ["3", "10", "2"], partySize: 8 });
    expect(body.tables).toEqual(["10", "2", "3"]);
  });

  it("returns the assigned table when the create omits tables", async () => {
    const body = await create({ date: "2026-11-13" });
    expect(body.tables).toHaveLength(1);
    expect(typeof body.tables[0]).toBe("string");
  });

  it("returns every table of a multi-table booking", async () => {
    const body = await create({ date: "2026-11-14", tables: ["5", "4"], partySize: 6 });
    expect(body.tables).toEqual(["4", "5"]);
    expect((await get(`/reservations/${body.id}`)).tables).toEqual(["4", "5"]);
  });

  it("returns the table of a walk-in", async () => {
    const res = await post("/reservations/walk-in", {
      partySize: 2,
      date: "2026-11-15",
      time: "20:00",
      tables: ["6"],
    });
    expect(res.status).toBe(200);
    expect((await res.json()).tables).toEqual(["6"]);
  });

  it("returns the new set after a modify of tables", async () => {
    const created = await create({ date: "2026-11-16", tables: ["7"] });
    const res = await post(`/reservations/${created.id}/modify`, { tables: ["9", "8"], partySize: 6 });
    expect(res.status).toBe(200);
    expect((await res.json()).tables).toEqual(["8", "9"]);
    expect((await get(`/reservations/${created.id}`)).tables).toEqual(["8", "9"]);
  });

  it("keeps the tables after attended and after no_show", async () => {
    const attended = await create({ date: "2026-11-17", tables: ["1"] });
    await post(`/reservations/${attended.id}/status`, { status: "seated" });
    const done = await post(`/reservations/${attended.id}/status`, { status: "attended" });
    expect((await done.json()).tables).toEqual(["1"]);
    expect((await get(`/reservations/${attended.id}`)).tables).toEqual(["1"]);

    const missed = await create({ date: "2026-11-17", tables: ["2"] });
    const res = await post(`/reservations/${missed.id}/status`, { status: "no_show" });
    expect((await res.json()).tables).toEqual(["2"]);
    expect((await get(`/reservations/${missed.id}`)).tables).toEqual(["2"]);
  });

  it("returns an empty list after cancel", async () => {
    const created = await create({ date: "2026-11-18", tables: ["3"] });
    const res = await post(`/reservations/${created.id}/cancel`, {});
    expect(res.status).toBe(200);
    expect((await res.json()).tables).toEqual([]);
    expect((await get(`/reservations/${created.id}`)).tables).toEqual([]);
  });

  it("returns tables per reservation on list, agenda and search", async () => {
    const a = await create({ date: "2026-11-20", time: "20:00", tables: ["2", "1"], partySize: 6 });
    const b = await create({ date: "2026-11-20", time: "21:00", tables: ["3"] });
    const c = await create({ date: "2026-11-20", time: "22:00", tables: ["4"] });
    await post(`/reservations/${c.id}/cancel`, {});
    const expected = new Map([
      [a.id, ["1", "2"]],
      [b.id, ["3"]],
      [c.id, []],
    ]);
    const pick = (rows: { id: string; tables: string[] }[]) =>
      new Map(rows.filter((r) => expected.has(r.id)).map((r) => [r.id, r.tables]));

    expect(pick((await get("/agenda?date=2026-11-20")).reservations)).toEqual(expected);
    expect(pick((await get("/reservations")).reservations)).toEqual(expected);
    expect(
      pick((await get("/reservations/search?dateStart=2026-11-20&dateEnd=2026-11-21")).reservations),
    ).toEqual(expected);
  });
});
