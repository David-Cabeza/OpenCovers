import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";

const VENUE = "consent";
const headers = { apikey: "consent-key", "content-type": "application/json" };
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

let nextTable = 0;
function booking(guest?: Record<string, unknown>) {
  nextTable += 1;
  return {
    date: "2026-11-12",
    time: "21:00",
    partySize: 2,
    tables: [String(nextTable)],
    guest,
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
  await addKey(db, "consent-key", "consent-principal", [VENUE], "admin");
});

describe("per-reservation contact consent", () => {
  it("defaults to unknown with no recorded time", async () => {
    const res = await post("/reservations", booking({ name: "Ana", contact: "ana@example.com" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.guest.consent).toBe("unknown");
    expect(body.guest.consentRecordedAt).toBeUndefined();
  });

  it("records granted with a timestamp on create", async () => {
    const res = await post("/reservations", booking({ name: "Bea", consent: "granted" }));
    const body = await res.json();
    expect(body.guest.consent).toBe("granted");
    expect(Number.isNaN(Date.parse(body.guest.consentRecordedAt))).toBe(false);
  });

  it("rejects a value outside the closed set", async () => {
    for (const consent of ["yes", true, null, ""]) {
      const res = await post("/reservations", booking({ consent }));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_request");
    }
  });

  it("changes consent on modify with one version bump and one modified event", async () => {
    const created = await (await post("/reservations", booking({ name: "Cai" }))).json();
    const before = (await events()).filter((e) => e.reservationId === created.id);

    const res = await post(`/reservations/${created.id}/modify`, { guest: { consent: "denied" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.guest.consent).toBe("denied");
    expect(body.guest.consentRecordedAt).toBeDefined();
    expect(body.version).toBe(created.version + 1);

    const after = (await events()).filter((e) => e.reservationId === created.id);
    expect(after.length - before.length).toBe(1);
    expect(after[after.length - 1]).toMatchObject({ type: "modified", version: body.version });
  });

  it("does not bump the version when modify sets the same value", async () => {
    const created = await (await post("/reservations", booking({ consent: "granted" }))).json();
    const before = (await events()).filter((e) => e.reservationId === created.id).length;

    const res = await post(`/reservations/${created.id}/modify`, { guest: { consent: "granted" } });
    const body = await res.json();
    expect(body.version).toBe(created.version);
    expect(body.guest.consentRecordedAt).toBe(created.guest.consentRecordedAt);
    expect((await events()).filter((e) => e.reservationId === created.id).length).toBe(before);
  });

  it("rejects an invalid value on modify", async () => {
    const created = await (await post("/reservations", booking())).json();
    const res = await post(`/reservations/${created.id}/modify`, { guest: { consent: "maybe" } });
    expect(res.status).toBe(400);
  });

  it("survives a read through get, list, search and agenda", async () => {
    const created = await (await post("/reservations", booking({ consent: "denied" }))).json();
    const lists = [
      (await get("/reservations")).reservations,
      (await get("/reservations/search?dateStart=2026-11-12&dateEnd=2026-11-13")).reservations,
      (await get("/agenda?date=2026-11-12")).reservations,
    ];
    for (const list of lists) {
      const found = list.find((r: { id: string }) => r.id === created.id);
      expect(found.guest.consent).toBe("denied");
    }
    expect((await get(`/reservations/${created.id}`)).guest.consent).toBe("denied");
  });

  it("accepts consent on a walk-in", async () => {
    const res = await post("/reservations/walk-in", {
      partySize: 2,
      date: "2026-11-12",
      time: "20:00",
      tables: ["40"],
      guest: { consent: "granted" },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).guest.consent).toBe("granted");

    const bad = await post("/reservations/walk-in", {
      partySize: 2,
      date: "2026-11-12",
      time: "20:00",
      guest: { consent: "nope" },
    });
    expect(bad.status).toBe(400);
  });

  it("resets consent to unknown on erasure and keeps the counts", async () => {
    const created = await (
      await post("/reservations", booking({ name: "Eva", contact: "eva@example.com", consent: "granted" }))
    ).json();

    const res = await post("/erasure", { guestId: "eva@example.com" });
    expect(await res.json()).toEqual({ erasedReservations: 1, erasedGuests: 1 });

    const after = await get(`/reservations/${created.id}`);
    expect(after.guest.consent).toBe("unknown");
    expect(after.guest.consentRecordedAt).toBeUndefined();

    const again = await post("/erasure", { guestId: "eva@example.com" });
    expect(await again.json()).toEqual({ erasedReservations: 0, erasedGuests: 0 });
  });

  it("refuses to record consent on an erased reservation", async () => {
    const created = await (
      await post("/reservations", booking({ contact: "fer@example.com", consent: "granted" }))
    ).json();
    await post("/erasure", { guestId: "fer@example.com" });
    const res = await post(`/reservations/${created.id}/modify`, { guest: { consent: "granted" } });
    expect(res.status).toBe(400);
  });
});
