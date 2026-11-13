import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { guestAudit, guests, reservations, services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { runRetention } from "../src/lib/retention";
import { erase } from "../src/lib/venue";

const NOW = new Date("2026-11-13T12:00:00Z");
let requestCounter = 0;
let nextTable = 0;

async function seedVenue(venueId: string) {
  await db.insert(venues).values({ id: venueId, timezone: "Europe/Madrid" });
  await db.insert(services).values([{ venueId, name: "all", openStart: "00:00", openEnd: "24:00" }]);
  await db
    .insert(tables)
    .values(Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1), venueId, name: `T${i + 1}`, seats: 4 })));
  await addKey(db, `read-${venueId}`, "reader", [venueId], "read");
  await addKey(db, `write-${venueId}`, "platform", [venueId], "write");
  await addKey(db, `admin-${venueId}`, "staff-admin", [venueId], "admin");
}

function post(venueId: string, path: string, body: unknown, opts: { key?: string; idem?: string } = {}) {
  return app.request(`/v1/venues/${venueId}${path}`, {
    method: "POST",
    headers: {
      apikey: opts.key ?? `admin-${venueId}`,
      "content-type": "application/json",
      "Idempotency-Key": opts.idem ?? `merge-${++requestCounter}`,
    },
    body: JSON.stringify(body),
  });
}

function get(venueId: string, path: string) {
  return app.request(`/v1/venues/${venueId}${path}`, { headers: { apikey: `read-${venueId}` } });
}

async function book(venueId: string, date: string, name: string, contact: string) {
  nextTable = (nextTable % 20) + 1;
  const res = await post(
    venueId,
    "/reservations",
    { date, time: "21:00", partySize: 2, tables: [String(nextTable)], guest: { name, contact } },
    { key: `write-${venueId}` },
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { id: string; guest: { guestId: string } };
  return { id: body.id, guestId: body.guest.guestId };
}

function merge(venueId: string, guestId: string, intoGuestId: string, opts: { key?: string; idem?: string } = {}) {
  return post(venueId, `/guests/${guestId}/merge`, { intoGuestId }, opts);
}

function unmerge(venueId: string, guestId: string) {
  return post(venueId, `/guests/${guestId}/unmerge`, {});
}

async function holder(reservationId: string) {
  return (await db.select().from(reservations).where(eq(reservations.id, reservationId)))[0].guestId;
}

async function guestRow(id: string) {
  return (await db.select().from(guests).where(eq(guests.id, id)))[0];
}

async function auditDump(venueId: string) {
  return JSON.stringify(await db.select().from(guestAudit).where(eq(guestAudit.venueId, venueId)));
}

async function pair(venueId: string, dates = { a: "2026-10-01", b: "2026-11-05" }) {
  await seedVenue(venueId);
  const a1 = await book(venueId, dates.a, "Ana", "ana@example.com");
  const b1 = await book(venueId, dates.b, "Ana Lopez", "+34 600 123 456");
  const b2 = await book(venueId, dates.a, "Ana Lopez", "600123456");
  return { a: a1.guestId, b: b1.guestId, a1: a1.id, b1: b1.id, b2: b2.id };
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, guest_audit, guests, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe("guest merge", () => {
  it("lets only an admin merge", async () => {
    const venueId = "gm-roles";
    const g = await pair(venueId);
    const asRead = await merge(venueId, g.b, g.a, { key: `read-${venueId}` });
    expect(asRead.status).toBe(403);
    expect((await asRead.json()).code).toBe("forbidden");
    const asWrite = await merge(venueId, g.b, g.a, { key: `write-${venueId}` });
    expect(asWrite.status).toBe(403);
    expect((await asWrite.json()).code).toBe("forbidden");
    expect((await post(venueId, `/guests/${g.b}/unmerge`, {}, { key: `write-${venueId}` })).status).toBe(403);
    expect(await holder(g.b1)).toBe(g.b);
    expect((await merge(venueId, g.b, g.a)).status).toBe(200);
  });

  it("moves the reservations and the latest visit to the target", async () => {
    const venueId = "gm-move";
    const g = await pair(venueId);
    const before = await guestRow(g.b);
    const res = await merge(venueId, g.b, g.a);
    expect(res.status).toBe(200);
    const target = await res.json();
    expect(target.id).toBe(g.a);
    expect(target.visitCount).toBe(3);
    expect(target.reservations.map((r: { id: string }) => r.id).sort()).toEqual([g.a1, g.b1, g.b2].sort());
    expect(target.lastVisitAt).toBe(before.lastVisitAt.toISOString());
    expect(target.mergedGuests).toEqual([{ id: g.b, name: "Ana Lopez", email: null, phone: "+34600123456" }]);
    expect(await holder(g.b1)).toBe(g.a);
    expect((await guestRow(g.b)).mergedInto).toBe(g.a);

    const listed = await (await get(venueId, "/guests")).json();
    expect(listed.guests.map((x: { id: string }) => x.id)).toEqual([g.a]);
    expect((await get(venueId, `/guests/${g.b}`)).status).toBe(404);
  });

  it("applies once for a repeated key", async () => {
    const venueId = "gm-idem";
    const g = await pair(venueId);
    const first = await merge(venueId, g.b, g.a, { idem: "same-key" });
    const again = await merge(venueId, g.b, g.a, { idem: "same-key" });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(await first.json());
    const merges = await db.select().from(guestAudit).where(eq(guestAudit.venueId, venueId));
    expect(merges.filter((e) => e.action === "merged")).toHaveLength(1);
    const reused = await merge(venueId, g.a, g.b, { idem: "same-key" });
    expect(reused.status).toBe(400);
    expect((await reused.json()).code).toBe("invalid_request");
  });

  it("rejects self, foreign, cleared, already merged, and cyclic merges", async () => {
    const venueId = "gm-invalid";
    const g = await pair(venueId);
    const other = await pair("gm-invalid-other");
    const c = await book(venueId, "2026-10-03", "Cleo", "cleo@example.com");
    const gone = await book(venueId, "2026-10-04", "Gone", "gone@example.com");
    await db.update(guests).set({ email: null, phone: null, name: "" }).where(eq(guests.id, gone.guestId));

    const self = await merge(venueId, g.a, g.a);
    expect([self.status, (await self.json()).code]).toEqual([400, "invalid_request"]);
    const foreign = await merge(venueId, g.b, other.a);
    expect([foreign.status, (await foreign.json()).code]).toEqual([404, "guest_not_found"]);
    const fromForeign = await merge(venueId, other.b, g.a);
    expect([fromForeign.status, (await fromForeign.json()).code]).toEqual([404, "guest_not_found"]);
    const cleared = await merge(venueId, gone.guestId, g.a);
    expect([cleared.status, (await cleared.json()).code]).toEqual([404, "guest_not_found"]);

    expect((await merge(venueId, g.b, g.a)).status).toBe(200);
    const twice = await merge(venueId, g.b, c.guestId);
    expect([twice.status, (await twice.json()).code]).toEqual([409, "guest_merged"]);
    const intoMerged = await merge(venueId, c.guestId, g.b);
    expect([intoMerged.status, (await intoMerged.json()).code]).toEqual([409, "guest_merged"]);
    const cycle = await merge(venueId, g.a, g.b);
    expect([cycle.status, (await cycle.json()).code]).toEqual([409, "guest_merged"]);
    expect((await guestRow(g.a)).mergedInto).toBeNull();
  });

  it("lets exactly one of two opposite merges win", async () => {
    const venueId = "gm-race";
    const g = await pair(venueId);
    const results = await Promise.all([merge(venueId, g.b, g.a), merge(venueId, g.a, g.b)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const rows = await db.select().from(guests).where(eq(guests.venueId, venueId));
    expect(rows.filter((r) => r.mergedInto !== null)).toHaveLength(1);
  });
});

describe("guest unmerge", () => {
  it("returns exactly the moved reservations and keeps later bookings on the target", async () => {
    const venueId = "gu-restore";
    const g = await pair(venueId);
    const aBefore = await guestRow(g.a);
    expect((await merge(venueId, g.b, g.a)).status).toBe(200);
    const later = await book(venueId, "2026-12-20", "Ana Lopez", "+34600123456");
    expect(later.guestId).toBe(g.a);

    const res = await unmerge(venueId, g.b);
    expect(res.status).toBe(200);
    const restored = await res.json();
    expect(restored).toMatchObject({ id: g.b, name: "Ana Lopez", phone: "+34600123456" });
    expect(restored.reservations.map((r: { id: string }) => r.id).sort()).toEqual([g.b1, g.b2].sort());
    expect(await holder(later.id)).toBe(g.a);
    expect(await holder(g.a1)).toBe(g.a);

    const target = await (await get(venueId, `/guests/${g.a}`)).json();
    expect(target.mergedGuests).toEqual([]);
    expect(target.reservations.map((r: { id: string }) => r.id).sort()).toEqual([g.a1, later.id].sort());
    expect(new Date(target.lastVisitAt) > aBefore.lastVisitAt).toBe(true);
    expect(target.lastVisitAt).toBe(new Date("2026-12-20T20:00:00Z").toISOString());
    expect((await guestRow(g.b)).mergedInto).toBeNull();
  });

  it("recomputes the target's latest visit from what it still holds", async () => {
    const venueId = "gu-last-visit";
    const g = await pair(venueId);
    const aBefore = await guestRow(g.a);
    await merge(venueId, g.b, g.a);
    expect((await guestRow(g.a)).lastVisitAt > aBefore.lastVisitAt).toBe(true);
    await unmerge(venueId, g.b);
    expect((await guestRow(g.a)).lastVisitAt).toEqual(aBefore.lastVisitAt);
  });

  it("rejects a second unmerge, a never-merged guest, and a merge with no audit entry", async () => {
    const venueId = "gu-reject";
    const g = await pair(venueId);
    const c = await book(venueId, "2026-10-03", "Cleo", "cleo@example.com");
    await merge(venueId, g.b, g.a);
    expect((await unmerge(venueId, g.b)).status).toBe(200);
    const second = await unmerge(venueId, g.b);
    expect([second.status, (await second.json()).code]).toEqual([409, "guest_not_merged"]);
    const never = await unmerge(venueId, g.a);
    expect([never.status, (await never.json()).code]).toEqual([409, "guest_not_merged"]);
    const unknown = await unmerge(venueId, "no-such-guest");
    expect([unknown.status, (await unknown.json()).code]).toEqual([404, "guest_not_found"]);

    await db.update(guests).set({ mergedInto: g.a }).where(eq(guests.id, c.guestId));
    const noEntry = await unmerge(venueId, c.guestId);
    expect([noEntry.status, (await noEntry.json()).code]).toEqual([409, "unmerge_unavailable"]);
  });

  it("undoes only the latest merge, and only while the target is active", async () => {
    const venueId = "gu-latest";
    const g = await pair(venueId);
    const z = await book(venueId, "2026-10-05", "Zoe", "zoe@example.com");
    await merge(venueId, g.b, g.a);
    await unmerge(venueId, g.b);
    await merge(venueId, g.b, z.guestId);
    await merge(venueId, z.guestId, g.a);

    const blocked = await unmerge(venueId, g.b);
    expect([blocked.status, (await blocked.json()).code]).toEqual([409, "guest_merged"]);
    expect((await unmerge(venueId, z.guestId)).status).toBe(200);
    expect(await holder(g.b1)).toBe(z.guestId);
    expect((await unmerge(venueId, g.b)).status).toBe(200);
    expect(await holder(g.b1)).toBe(g.b);
    expect(await holder(g.a1)).toBe(g.a);
  });
});

describe("merge audit privacy", () => {
  const personal = ["ana@example.com", "+34600123456", "Ana Lopez", "Ana"];

  it("stores the absorbed guest's prior state until it is needed", async () => {
    const venueId = "gp-stored";
    const g = await pair(venueId);
    await merge(venueId, g.b, g.a);
    expect(await auditDump(venueId)).toContain("+34600123456");
    await unmerge(venueId, g.b);
    expect(await auditDump(venueId)).not.toContain("+34600123456");
    const entries = await db.select().from(guestAudit).where(eq(guestAudit.venueId, venueId)).orderBy(guestAudit.id);
    const actions = entries.map((e) => e.action);
    expect(actions).toEqual(["created", "created", "merged", "unmerged"]);
  });

  it("erasing the target by guest id clears the audit and blocks unmerge", async () => {
    const venueId = "gp-erase-target";
    const g = await pair(venueId);
    await merge(venueId, g.b, g.a);
    const result = await erase(db, venueId, g.a, undefined, "staff-admin");
    expect(result).toMatchObject({ erasedReservations: 3, erasedGuests: 2 });
    const dump = await auditDump(venueId);
    for (const value of personal) expect(dump).not.toContain(value);
    expect(dump).toContain('"action":"merged"');
    expect((await unmerge(venueId, g.b)).status).toBe(404);
  });

  it("erasing the absorbed guest by id erases its moved visits and clears the audit", async () => {
    const venueId = "gp-erase-absorbed";
    const g = await pair(venueId);
    await merge(venueId, g.b, g.a);
    const result = await erase(db, venueId, g.b, undefined, "staff-admin");
    expect(result).toMatchObject({ erasedReservations: 2, erasedGuests: 1 });
    expect(await auditDump(venueId)).not.toContain("+34600123456");
    expect(await auditDump(venueId)).not.toContain("Ana Lopez");
    const moved = await db.select().from(reservations).where(eq(reservations.id, g.b1));
    expect(moved[0]).toMatchObject({ erased: true, guestId: null, guestContact: "", guestName: "" });
    expect(await holder(g.a1)).toBe(g.a);
    expect((await unmerge(venueId, g.b)).status).toBe(404);
  });

  it("erasure by principal clears the audit and blocks unmerge", async () => {
    const venueId = "gp-erase-principal";
    const g = await pair(venueId);
    await merge(venueId, g.b, g.a);
    const result = await erase(db, venueId, undefined, "platform", "staff-admin");
    expect(result).toMatchObject({ erasedReservations: 3, erasedGuests: 2 });
    const dump = await auditDump(venueId);
    for (const value of personal) expect(dump).not.toContain(value);
    expect((await unmerge(venueId, g.b)).status).toBe(404);
  });

  it("retention clears the audit and blocks unmerge", async () => {
    const venueId = "gp-retention";
    const g = await pair(venueId, { a: "2025-01-10", b: "2025-02-10" });
    await merge(venueId, g.b, g.a);
    await runRetention(db, NOW);
    const dump = await auditDump(venueId);
    for (const value of personal) expect(dump).not.toContain(value);
    expect(dump).toContain('"action":"expired"');
    const res = await unmerge(venueId, g.b);
    expect([res.status, (await res.json()).code]).toEqual([409, "unmerge_unavailable"]);
    expect((await guestRow(g.b)).mergedInto).toBe(g.a);
  });
});
