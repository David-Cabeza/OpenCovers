import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";

const VENUE = "rating";
const headers = { apikey: "rating-key", "content-type": "application/json" };
let keyCounter = 0;

function post(path: string, body: unknown, key = "rating-key") {
  return app.request(`/v1/venues/${VENUE}${path}`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json", "Idempotency-Key": `k-${++keyCounter}` },
    body: JSON.stringify(body),
  });
}

async function get(path: string) {
  const res = await app.request(`/v1/venues/${VENUE}${path}`, { headers });
  return res.json();
}

let nextTable = 0;
function booking(extra: Record<string, unknown> = {}) {
  nextTable += 1;
  return {
    date: "2026-11-12",
    time: "21:00",
    partySize: 2,
    tables: [String(nextTable)],
    ...extra,
  };
}

async function events(): Promise<{ type: string; reservationId: string; version: number }[]> {
  return (await get("/events")).events;
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
    Array.from({ length: 40 }, (_, i) => ({
      id: String(i + 1),
      venueId: VENUE,
      name: `T${i + 1}`,
      seats: 4,
    })),
  );
  await addKey(db, "rating-key", "rating-principal", [VENUE], "write");
  await addKey(db, "rating-read-key", "rating-reader", [VENUE], "read");
});

describe("per-reservation guest rating", () => {
  it("reads null when no rating was given", async () => {
    const res = await post("/reservations", booking());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rating).toBeNull();
    expect(body.ratingRecordedAt).toBeNull();
  });

  it("records a rating with a timestamp on create", async () => {
    const res = await post("/reservations", booking({ rating: 5 }));
    const body = await res.json();
    expect(body.rating).toBe(5);
    expect(Number.isNaN(Date.parse(body.ratingRecordedAt))).toBe(false);
  });

  it("accepts a rating on a walk-in", async () => {
    const res = await post("/reservations/walk-in", {
      partySize: 2,
      date: "2026-11-12",
      time: "20:00",
      tables: ["40"],
      rating: 3,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).rating).toBe(3);
  });

  it("sets a rating on modify with one version bump and one modified event", async () => {
    const created = await (await post("/reservations", booking())).json();
    const before = (await events()).filter((e) => e.reservationId === created.id);

    const res = await post(`/reservations/${created.id}/modify`, { rating: 4 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rating).toBe(4);
    expect(body.ratingRecordedAt).not.toBeNull();
    expect(body.version).toBe(created.version + 1);

    const after = (await events()).filter((e) => e.reservationId === created.id);
    expect(after.length - before.length).toBe(1);
    expect(after[after.length - 1]).toMatchObject({ type: "modified", version: body.version });
  });

  it("bumps the version again when the rating changes", async () => {
    const created = await (await post("/reservations", booking({ rating: 2 }))).json();
    const body = await (await post(`/reservations/${created.id}/modify`, { rating: 5 })).json();
    expect(body.rating).toBe(5);
    expect(body.version).toBe(created.version + 1);
  });

  it("does not bump the version when modify sets the same value", async () => {
    const created = await (await post("/reservations", booking({ rating: 4 }))).json();
    const before = (await events()).filter((e) => e.reservationId === created.id).length;

    const body = await (await post(`/reservations/${created.id}/modify`, { rating: 4 })).json();
    expect(body.version).toBe(created.version);
    expect(body.ratingRecordedAt).toBe(created.ratingRecordedAt);
    expect((await events()).filter((e) => e.reservationId === created.id).length).toBe(before);
  });

  it("clears the rating and its time when set to null", async () => {
    const created = await (await post("/reservations", booking({ rating: 1 }))).json();
    const res = await post(`/reservations/${created.id}/modify`, { rating: null });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rating).toBeNull();
    expect(body.ratingRecordedAt).toBeNull();
    expect(body.version).toBe(created.version + 1);
    expect((await get(`/reservations/${created.id}`)).rating).toBeNull();
  });

  it("rejects values outside the integers 1 to 5", async () => {
    for (const rating of [0, 6, 3.5, "5", -1, true]) {
      const res = await post("/reservations", booking({ rating }));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_request");
    }
    const created = await (await post("/reservations", booking())).json();
    for (const rating of [0, 6, 3.5, "5"]) {
      const res = await post(`/reservations/${created.id}/modify`, { rating });
      expect(res.status).toBe(400);
    }
    const walkIn = await post("/reservations/walk-in", { partySize: 2, rating: 6 });
    expect(walkIn.status).toBe(400);
    expect((await get(`/reservations/${created.id}`)).rating).toBeNull();
  });

  it("refuses a read-only key", async () => {
    const created = await (await post("/reservations", booking())).json();
    const res = await post(`/reservations/${created.id}/modify`, { rating: 5 }, "rating-read-key");
    expect(res.status).toBe(403);
    expect((await get(`/reservations/${created.id}`)).rating).toBeNull();
  });

  it("survives a read through get, list, search and agenda", async () => {
    const created = await (await post("/reservations", booking({ rating: 2 }))).json();
    const lists = [
      (await get("/reservations")).reservations,
      (await get("/reservations/search?dateStart=2026-11-12&dateEnd=2026-11-13")).reservations,
      (await get("/agenda?date=2026-11-12")).reservations,
    ];
    for (const list of lists) {
      const found = list.find((r: { id: string }) => r.id === created.id);
      expect(found.rating).toBe(2);
    }
    expect((await get(`/reservations/${created.id}`)).rating).toBe(2);
  });

  it("resets the rating on erasure and keeps the counts", async () => {
    const created = await (
      await post("/reservations", booking({ guest: { name: "Eva", contact: "eva@example.com" }, rating: 5 }))
    ).json();

    const res = await post("/erasure", { guestId: "eva@example.com" });
    expect(await res.json()).toEqual({ erasedReservations: 1, erasedGuests: 1 });

    const after = await get(`/reservations/${created.id}`);
    expect(after.rating).toBeNull();
    expect(after.ratingRecordedAt).toBeNull();
  });

  it("refuses to record a rating on an erased reservation", async () => {
    const created = await (
      await post("/reservations", booking({ guest: { contact: "fer@example.com" } }))
    ).json();
    await post("/erasure", { guestId: "fer@example.com" });
    const res = await post(`/reservations/${created.id}/modify`, { rating: 5 });
    expect(res.status).toBe(400);
  });
});
