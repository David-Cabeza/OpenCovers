import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { reservations, sentEmails, services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { runRetention } from "../src/lib/retention";

const VENUE = "commentary";
const headers = { apikey: "commentary-key", "content-type": "application/json" };
let keyCounter = 0;

function post(path: string, body: unknown, key = "commentary-key") {
  return app.request(`/v1/venues/${VENUE}${path}`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json", "Idempotency-Key": `c-${++keyCounter}` },
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
  await addKey(db, "commentary-key", "commentary-principal", [VENUE], "write");
  await addKey(db, "commentary-admin-key", "commentary-admin", [VENUE], "admin");
  await addKey(db, "commentary-read-key", "commentary-reader", [VENUE], "read");
});

describe("booking note", () => {
  it("reads an empty string when no note was given", async () => {
    const res = await post("/reservations", booking());
    expect(res.status).toBe(200);
    expect((await res.json()).commentary).toBe("");
  });

  it("stores the note on create and trims it", async () => {
    const res = await post("/reservations", booking({ commentary: "  anniversary, bring a cake  " }));
    expect(res.status).toBe(200);
    expect((await res.json()).commentary).toBe("anniversary, bring a cake");
  });

  it("accepts a note on a walk-in", async () => {
    const res = await post("/reservations/walk-in", {
      partySize: 2,
      date: "2026-11-12",
      time: "20:00",
      tables: ["60"],
      commentary: "regular, likes the corner",
    });
    expect(res.status).toBe(200);
    expect((await res.json()).commentary).toBe("regular, likes the corner");
  });

  it("accepts exactly 500 characters and rejects 501", async () => {
    const ok = await post("/reservations", booking({ commentary: "a".repeat(500) }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).commentary).toHaveLength(500);

    const tooLong = await post("/reservations", booking({ commentary: "a".repeat(501) }));
    expect(tooLong.status).toBe(400);
    expect((await tooLong.json()).code).toBe("invalid_request");
  });

  it("rejects a value that is not a string", async () => {
    for (const commentary of [5, null, true, ["note"], { text: "note" }]) {
      const res = await post("/reservations", booking({ commentary }));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_request");
    }
    const created = await (await post("/reservations", booking({ commentary: "keep" }))).json();
    for (const commentary of [5, null, ["x"]]) {
      const res = await post(`/reservations/${created.id}/modify`, { commentary });
      expect(res.status).toBe(400);
    }
    const walkIn = await post("/reservations/walk-in", { partySize: 2, commentary: 7 });
    expect(walkIn.status).toBe(400);
    expect((await get(`/reservations/${created.id}`)).commentary).toBe("keep");
  });

  it("keeps the database bound even when the application is bypassed", async () => {
    const created = await (await post("/reservations", booking())).json();
    await expect(
      db.update(reservations).set({ commentary: "a".repeat(501) }).where(eq(reservations.id, created.id)),
    ).rejects.toThrow();
  });

  it("sets a note on modify with one version bump and one modified event", async () => {
    const created = await (await post("/reservations", booking())).json();
    const before = (await events()).filter((e) => e.reservationId === created.id);

    const res = await post(`/reservations/${created.id}/modify`, { commentary: "window seat" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commentary).toBe("window seat");
    expect(body.version).toBe(created.version + 1);

    const after = (await events()).filter((e) => e.reservationId === created.id);
    expect(after.length - before.length).toBe(1);
    expect(after[after.length - 1]).toMatchObject({ type: "modified", version: body.version });
  });

  it("bumps the version again when the note changes", async () => {
    const created = await (await post("/reservations", booking({ commentary: "first" }))).json();
    const body = await (await post(`/reservations/${created.id}/modify`, { commentary: "second" })).json();
    expect(body.commentary).toBe("second");
    expect(body.version).toBe(created.version + 1);
  });

  it("does not bump the version when modify sets the same value", async () => {
    const created = await (await post("/reservations", booking({ commentary: "same" }))).json();
    const before = (await events()).filter((e) => e.reservationId === created.id).length;

    const body = await (await post(`/reservations/${created.id}/modify`, { commentary: " same " })).json();
    expect(body.version).toBe(created.version);
    expect((await events()).filter((e) => e.reservationId === created.id).length).toBe(before);
  });

  it("clears the note with an empty string", async () => {
    const created = await (await post("/reservations", booking({ commentary: "remove me" }))).json();
    const res = await post(`/reservations/${created.id}/modify`, { commentary: "" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commentary).toBe("");
    expect(body.version).toBe(created.version + 1);
    expect((await get(`/reservations/${created.id}`)).commentary).toBe("");
  });

  it("refuses a read-only key", async () => {
    const created = await (await post("/reservations", booking())).json();
    const res = await post(`/reservations/${created.id}/modify`, { commentary: "nope" }, "commentary-read-key");
    expect(res.status).toBe(403);
    expect((await get(`/reservations/${created.id}`)).commentary).toBe("");
  });

  it("survives a read through get, list, search and agenda", async () => {
    const created = await (await post("/reservations", booking({ commentary: "birthday" }))).json();
    const lists = [
      (await get("/reservations")).reservations,
      (await get("/reservations/search?dateStart=2026-11-12&dateEnd=2026-11-13")).reservations,
      (await get("/agenda?date=2026-11-12")).reservations,
    ];
    for (const list of lists) {
      const found = list.find((r: { id: string }) => r.id === created.id);
      expect(found.commentary).toBe("birthday");
    }
    expect((await get(`/reservations/${created.id}`)).commentary).toBe("birthday");
  });

  it("keeps the note out of the event feed", async () => {
    const marker = "unique-note-marker-4471";
    await post("/reservations", booking({ commentary: marker }));
    expect(JSON.stringify(await get("/events"))).not.toContain(marker);
  });

  it("resets the note on erasure and keeps the counts", async () => {
    const created = await (
      await post(
        "/reservations",
        booking({ guest: { name: "Eva", contact: "eva-note@example.com" }, commentary: "Eva's birthday" }),
      )
    ).json();

    const res = await post("/erasure", { guestId: "eva-note@example.com" }, "commentary-admin-key");
    expect(await res.json()).toEqual({ erasedReservations: 1, erasedGuests: 1, erasedWaitlistEntries: 0, blocklistEntriesKept: 0 });

    expect((await get(`/reservations/${created.id}`)).commentary).toBe("");
  });

  it("refuses to record a note on an erased reservation", async () => {
    const created = await (
      await post("/reservations", booking({ guest: { contact: "fer-note@example.com" } }))
    ).json();
    await post("/erasure", { guestId: "fer-note@example.com" }, "commentary-admin-key");
    const res = await post(`/reservations/${created.id}/modify`, { commentary: "late note" });
    expect(res.status).toBe(400);
  });
});

describe("booking note by status", () => {
  async function attended(extra: Record<string, unknown> = {}) {
    const created = await (await post("/reservations", booking(extra))).json();
    expect((await post(`/reservations/${created.id}/status`, { status: "seated" })).status).toBe(200);
    const res = await post(`/reservations/${created.id}/status`, { status: "attended" });
    expect(res.status).toBe(200);
    return res.json();
  }

  it("sets a note on an attended reservation", async () => {
    const visit = await attended();
    const res = await post(`/reservations/${visit.id}/modify`, { commentary: "left a gift" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("attended");
    expect(body.commentary).toBe("left a gift");
    expect(body.version).toBe(visit.version + 1);
  });

  it("refuses a note on a cancelled reservation", async () => {
    const created = await (await post("/reservations", booking())).json();
    await post(`/reservations/${created.id}/cancel`, {});
    const res = await post(`/reservations/${created.id}/modify`, { commentary: "too late" });
    expect((await res.json()).code).toBe("invalid_transition");
  });

  it("refuses a note on a no-show reservation", async () => {
    const created = await (await post("/reservations", booking())).json();
    await post(`/reservations/${created.id}/status`, { status: "no_show" });
    const res = await post(`/reservations/${created.id}/modify`, { commentary: "too late" });
    expect((await res.json()).code).toBe("invalid_transition");
  });
});

describe("booking note retention", () => {
  it("anonymises an old reservation that holds only a note", async () => {
    await db.insert(venues).values({ id: "commentary-old", timezone: "Europe/Madrid" });
    await db
      .insert(services)
      .values([{ venueId: "commentary-old", name: "all", openStart: "00:00", openEnd: "24:00" }]);
    await db
      .insert(tables)
      .values([{ id: "1", venueId: "commentary-old", name: "T1", seats: 4 }]);
    await addKey(db, "commentary-old-key", "commentary-old-principal", ["commentary-old"], "write");
    const res = await app.request("/v1/venues/commentary-old/reservations", {
      method: "POST",
      headers: { apikey: "commentary-old-key", "content-type": "application/json", "Idempotency-Key": "old-1" },
      body: JSON.stringify({ date: "2024-01-10", time: "21:00", partySize: 2, tables: ["1"], commentary: "Marta's 40th" }),
    });
    expect(res.status).toBe(200);
    const created = await res.json();

    await runRetention(db, new Date("2026-11-13T12:00:00Z"));

    const row = (await db.select().from(reservations).where(eq(reservations.id, created.id)))[0];
    expect(row).toMatchObject({ commentary: "", erased: true, partySize: 2, date: "2024-01-10" });
  });
});

describe("booking note emails", () => {
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

  it("sends no email for a note only modify and one for a party size change", async () => {
    const created = await (
      await post("/reservations", booking({ guest: { name: "Eva", contact: "eva-note-mail@example.com" } }))
    ).json();
    await settled(created.id, created.version);

    const noted = await (await post(`/reservations/${created.id}/modify`, { commentary: "quiet table" })).json();
    expect(noted.version).toBe(created.version + 1);

    const resized = await (await post(`/reservations/${created.id}/modify`, { partySize: 3 })).json();
    await settled(created.id, resized.version);

    expect(await confirmationVersions(created.id)).toEqual([created.version, resized.version]);
  });
});
