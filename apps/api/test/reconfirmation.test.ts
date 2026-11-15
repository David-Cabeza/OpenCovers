import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { reservations, sentEmails, services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { runRetention } from "../src/lib/retention";

const VENUE = "reconfirmation";
const headers = { apikey: "reconfirmation-key", "content-type": "application/json" };
let keyCounter = 0;

function post(path: string, body: unknown, key = "reconfirmation-key", venue = VENUE) {
  return app.request(`/v1/venues/${venue}${path}`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json", "Idempotency-Key": `r-${++keyCounter}` },
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
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, guest_audit, guests, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
  await db.insert(venues).values({ id: VENUE, timezone: "Europe/Madrid" });
  await db
    .insert(services)
    .values([{ venueId: VENUE, name: "dinner", openStart: "19:00", openEnd: "23:00" }]);
  await db.insert(tables).values(
    Array.from({ length: 60 }, (_, i) => ({
      id: String(i + 1),
      venueId: VENUE,
      name: `T${i + 1}`,
      seats: 4,
    })),
  );
  await addKey(db, "reconfirmation-key", "reconfirmation-principal", [VENUE], "write");
  await addKey(db, "reconfirmation-read-key", "reconfirmation-reader", [VENUE], "read");
});

describe("per-reservation reconfirmation", () => {
  it("reads none and no time when nothing was recorded", async () => {
    const res = await post("/reservations", booking());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reconfirmation).toBe("none");
    expect(body.reconfirmationRecordedAt).toBeNull();
  });

  it("records each value with a time on create, and none records no time", async () => {
    for (const value of ["requested", "confirmed", "declined", "no_answer"]) {
      const body = await (await post("/reservations", booking({ reconfirmation: value }))).json();
      expect(body.reconfirmation).toBe(value);
      expect(Number.isNaN(Date.parse(body.reconfirmationRecordedAt))).toBe(false);
    }
    const none = await (await post("/reservations", booking({ reconfirmation: "none" }))).json();
    expect(none.reconfirmation).toBe("none");
    expect(none.reconfirmationRecordedAt).toBeNull();
  });

  it("rejects a value outside the set", async () => {
    for (const reconfirmation of ["maybe", "CONFIRMED", "", 1, null, true, ["confirmed"]]) {
      const res = await post("/reservations", booking({ reconfirmation }));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_request");
    }
    const created = await (await post("/reservations", booking())).json();
    for (const reconfirmation of ["maybe", 1, null]) {
      const res = await post(`/reservations/${created.id}/modify`, { reconfirmation });
      expect(res.status).toBe(400);
    }
    expect((await get(`/reservations/${created.id}`)).reconfirmation).toBe("none");
  });

  it("refuses a walk-in that carries it", async () => {
    const res = await post("/reservations/walk-in", {
      partySize: 2,
      date: "2026-11-12",
      time: "20:00",
      tables: ["60"],
      reconfirmation: "confirmed",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
    const plain = await post("/reservations/walk-in", {
      partySize: 2,
      date: "2026-11-12",
      time: "20:00",
      tables: ["60"],
    });
    expect((await plain.json()).reconfirmation).toBe("none");
  });

  it("sets a value on modify with one version bump and one modified event", async () => {
    const created = await (await post("/reservations", booking())).json();
    const before = (await events()).filter((e) => e.reservationId === created.id);

    const res = await post(`/reservations/${created.id}/modify`, { reconfirmation: "requested" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reconfirmation).toBe("requested");
    expect(body.reconfirmationRecordedAt).not.toBeNull();
    expect(body.version).toBe(created.version + 1);

    const after = (await events()).filter((e) => e.reservationId === created.id);
    expect(after.length - before.length).toBe(1);
    expect(after[after.length - 1]).toMatchObject({ type: "modified", version: body.version });
  });

  it("follows requested to confirmed with a bump each time", async () => {
    const created = await (await post("/reservations", booking({ reconfirmation: "requested" }))).json();
    const body = await (await post(`/reservations/${created.id}/modify`, { reconfirmation: "confirmed" })).json();
    expect(body.reconfirmation).toBe("confirmed");
    expect(body.version).toBe(created.version + 1);
  });

  it("does not bump the version when modify sets the same value", async () => {
    const created = await (await post("/reservations", booking({ reconfirmation: "confirmed" }))).json();
    const before = (await events()).filter((e) => e.reservationId === created.id).length;

    const body = await (await post(`/reservations/${created.id}/modify`, { reconfirmation: "confirmed" })).json();
    expect(body.version).toBe(created.version);
    expect(body.reconfirmationRecordedAt).toBe(created.reconfirmationRecordedAt);
    expect((await events()).filter((e) => e.reservationId === created.id).length).toBe(before);
  });

  it("clears the value and its time with none", async () => {
    const created = await (await post("/reservations", booking({ reconfirmation: "declined" }))).json();
    const res = await post(`/reservations/${created.id}/modify`, { reconfirmation: "none" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reconfirmation).toBe("none");
    expect(body.reconfirmationRecordedAt).toBeNull();
    expect(body.version).toBe(created.version + 1);
  });

  it("keeps a declined booking booked with its tables", async () => {
    const created = await (await post("/reservations", booking())).json();
    const body = await (await post(`/reservations/${created.id}/modify`, { reconfirmation: "declined" })).json();
    expect(body.status).toBe("booked");
    expect(body.tables).toEqual(created.tables);
  });

  it("refuses a read-only key", async () => {
    const created = await (await post("/reservations", booking())).json();
    const res = await post(`/reservations/${created.id}/modify`, { reconfirmation: "confirmed" }, "reconfirmation-read-key");
    expect(res.status).toBe(403);
    expect((await get(`/reservations/${created.id}`)).reconfirmation).toBe("none");
  });

  it("survives a read through get, list, search and agenda", async () => {
    const created = await (await post("/reservations", booking({ reconfirmation: "no_answer" }))).json();
    const lists = [
      (await get("/reservations")).reservations,
      (await get("/reservations/search?dateStart=2026-11-12&dateEnd=2026-11-13")).reservations,
      (await get("/agenda?date=2026-11-12")).reservations,
    ];
    for (const list of lists) {
      const found = list.find((r: { id: string }) => r.id === created.id);
      expect(found.reconfirmation).toBe("no_answer");
      expect(found.reconfirmationRecordedAt).toBe(created.reconfirmationRecordedAt);
    }
    expect((await get(`/reservations/${created.id}`)).reconfirmation).toBe("no_answer");
  });

  it("resets the value on erasure and keeps the counts", async () => {
    const created = await (
      await post(
        "/reservations",
        booking({ guest: { name: "Eva", contact: "eva-reconf@example.com" }, reconfirmation: "confirmed" }),
      )
    ).json();

    const res = await post("/erasure", { guestId: "eva-reconf@example.com" });
    expect(await res.json()).toEqual({ erasedReservations: 1, erasedGuests: 1, erasedWaitlistEntries: 0 });

    const after = await get(`/reservations/${created.id}`);
    expect(after.reconfirmation).toBe("none");
    expect(after.reconfirmationRecordedAt).toBeNull();
  });

  it("refuses to record a value on an erased reservation", async () => {
    const created = await (
      await post("/reservations", booking({ guest: { contact: "fer-reconf@example.com" } }))
    ).json();
    await post("/erasure", { guestId: "fer-reconf@example.com" });
    const res = await post(`/reservations/${created.id}/modify`, { reconfirmation: "confirmed" });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
  });
});

describe("reconfirmation by status", () => {
  it("is allowed on a booked reservation only", async () => {
    const seated = await (await post("/reservations", booking())).json();
    await post(`/reservations/${seated.id}/status`, { status: "seated" });
    const attended = await (await post("/reservations", booking())).json();
    await post(`/reservations/${attended.id}/status`, { status: "seated" });
    await post(`/reservations/${attended.id}/status`, { status: "attended" });
    const cancelled = await (await post("/reservations", booking())).json();
    await post(`/reservations/${cancelled.id}/cancel`, {});
    const noShow = await (await post("/reservations", booking())).json();
    await post(`/reservations/${noShow.id}/status`, { status: "no_show" });

    for (const id of [seated.id, attended.id, cancelled.id, noShow.id]) {
      const res = await post(`/reservations/${id}/modify`, { reconfirmation: "confirmed" });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("invalid_transition");
      expect((await get(`/reservations/${id}`)).reconfirmation).toBe("none");
    }
  });

  it("keeps a recorded value when the reservation is seated", async () => {
    const created = await (await post("/reservations", booking({ reconfirmation: "confirmed" }))).json();
    await post(`/reservations/${created.id}/status`, { status: "seated" });
    expect((await get(`/reservations/${created.id}`)).reconfirmation).toBe("confirmed");
  });
});

describe("reconfirmation retention", () => {
  it("resets the value when an old visit expires", async () => {
    await db.insert(venues).values({ id: "reconfirmation-old", timezone: "Europe/Madrid" });
    await db
      .insert(services)
      .values([{ venueId: "reconfirmation-old", name: "all", openStart: "00:00", openEnd: "24:00" }]);
    await db.insert(tables).values([{ id: "1", venueId: "reconfirmation-old", name: "T1", seats: 4 }]);
    await addKey(db, "reconfirmation-old-key", "reconfirmation-old-principal", ["reconfirmation-old"], "write");
    const res = await post(
      "/reservations",
      {
        date: "2024-01-10",
        time: "21:00",
        partySize: 2,
        tables: ["1"],
        guest: { name: "Marta", contact: "not a contact" },
        reconfirmation: "confirmed",
      },
      "reconfirmation-old-key",
      "reconfirmation-old",
    );
    expect(res.status).toBe(200);
    const created = await res.json();

    await runRetention(db, new Date("2026-11-13T12:00:00Z"));

    const row = (await db.select().from(reservations).where(eq(reservations.id, created.id)))[0];
    expect(row).toMatchObject({ reconfirmation: "none", reconfirmationRecordedAt: null, erased: true });
  });
});

describe("reconfirmation emails", () => {
  beforeAll(async () => {
    await db.update(venues).set({ notificationsEnabled: true }).where(eq(venues.id, VENUE));
  });
  afterAll(async () => {
    await db.update(venues).set({ notificationsEnabled: false }).where(eq(venues.id, VENUE));
  });

  async function confirmationVersions(id: string): Promise<number[]> {
    const rows = await db.select().from(sentEmails).where(eq(sentEmails.reservationId, id));
    return rows.filter((r) => r.kind === "confirmation").map((r) => r.version).sort();
  }

  async function settled(id: string, version: number) {
    for (let i = 0; i < 50; i++) {
      if ((await confirmationVersions(id)).includes(version)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`no confirmation recorded for version ${version}`);
  }

  it("sends no email for a reconfirmation only modify and one for a party size change", async () => {
    const created = await (
      await post("/reservations", booking({ guest: { name: "Eva", contact: "eva-reconf-mail@example.com" } }))
    ).json();
    await settled(created.id, created.version);

    const asked = await (await post(`/reservations/${created.id}/modify`, { reconfirmation: "requested" })).json();
    expect(asked.version).toBe(created.version + 1);

    const resized = await (await post(`/reservations/${created.id}/modify`, { partySize: 3 })).json();
    await settled(created.id, resized.version);

    expect(await confirmationVersions(created.id)).toEqual([created.version, resized.version]);
  });
});
