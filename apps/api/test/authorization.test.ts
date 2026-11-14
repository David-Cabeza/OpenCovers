import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { floorItems, services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { auth } from "../src/lib/auth";
import { addMembership } from "../src/lib/memberships";

const DATE = "2027-03-10";
let requestCounter = 0;

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE account, session, verification, "user", venue_memberships, floor_items, webhook_endpoints, sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, guest_audit, guests, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

async function seedVenue(venueId: string) {
  await db.insert(venues).values({
    id: venueId,
    timezone: "Europe/Madrid",
    enabled: true,
    noticeAddress: "owner@example.com",
  });
  await db.insert(services).values([
    { venueId, name: "all", openStart: "00:00", openEnd: "24:00" },
    { venueId, name: "lunch", openStart: "12:00", openEnd: "16:00" },
  ]);
  await db.insert(tables).values(
    Array.from({ length: 6 }, (_, i) => ({ id: String(i + 1), venueId, name: `T${i + 1}`, seats: 4 })),
  );
  await db.insert(floorItems).values({ id: `bar-${venueId}`, venueId, type: "bar" });
  await addKey(db, `read-${venueId}`, "reader", [venueId], "read");
  await addKey(db, `write-${venueId}`, "platform", [venueId], "write");
  await addKey(db, `admin-${venueId}`, "owner", [venueId], "admin");
}

function call(venueId: string, method: string, path: string, key: string | { cookie: string }, body?: unknown) {
  const credentials = typeof key === "string" ? { apikey: key } : { Cookie: key.cookie };
  return app.request(`/v1/venues/${venueId}${path}`, {
    method,
    headers: { ...credentials, "content-type": "application/json", "Idempotency-Key": `authz-${++requestCounter}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function venueState(venueId: string) {
  const read = async (path: string) => {
    const res = await call(venueId, "GET", path, `admin-${venueId}`);
    expect(res.status).toBe(200);
    return res.json();
  };
  return {
    config: await read("/config"),
    services: await read("/services"),
    tables: await read("/tables"),
    floorItems: await read("/floor-items"),
    keys: await read("/keys"),
  };
}

async function signUpWithRole(venueId: string, role: "read" | "write" | "admin") {
  const res = await auth.api.signUpEmail({
    body: { name: "Staff", email: `staff-${++requestCounter}@example.com`, password: "password123" },
    asResponse: true,
  });
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("signup did not set a session cookie");
  const { user } = (await res.clone().json()) as { user: { id: string } };
  await addMembership(db, user.id, venueId, role);
  return { cookie };
}

type Route = { name: string; method: string; path: (venueId: string) => string; body?: unknown; status: number };

const ADMIN_ROUTES: Route[] = [
  {
    name: "PUT /config",
    method: "PUT",
    path: () => "/config",
    body: {
      noticeAddress: "attacker@example.com",
      notificationsEnabled: true,
      resendApiKey: "re_attacker",
      fromEmail: "attacker@example.com",
      phoneCountry: "FR",
      turnTimes: [{ upTo: 2, minutes: 15 }],
    },
    status: 200,
  },
  {
    name: "POST /services",
    method: "POST",
    path: () => "/services",
    body: { name: "lunch", openStart: "13:00", openEnd: "14:00", maxPartySize: 1 },
    status: 200,
  },
  { name: "DELETE /services/:name", method: "DELETE", path: () => "/services/all", status: 200 },
  { name: "POST /tables", method: "POST", path: () => "/tables", body: { id: "9", name: "T9", seats: 2 }, status: 200 },
  { name: "PATCH /tables/:id", method: "PATCH", path: () => "/tables/1", body: { x: 40, y: 80, rotation: 90 }, status: 200 },
  { name: "DELETE /tables/:id", method: "DELETE", path: () => "/tables/2", status: 200 },
  { name: "POST /floor-items", method: "POST", path: () => "/floor-items", body: { type: "plant" }, status: 201 },
  {
    name: "PATCH /floor-items/:id",
    method: "PATCH",
    path: (v) => `/floor-items/bar-${v}`,
    body: { x: 40, y: 80, width: 200 },
    status: 200,
  },
  { name: "DELETE /floor-items/:id", method: "DELETE", path: (v) => `/floor-items/bar-${v}`, status: 200 },
  {
    name: "POST /keys",
    method: "POST",
    path: () => "/keys",
    body: { key: "minted-by-anyone", principal: "rogue", role: "write" },
    status: 201,
  },
];

describe("C22 role boundaries", () => {
  ADMIN_ROUTES.forEach((route, i) => {
    it(`${route.name} needs admin and leaves the venue unchanged for read and write keys`, async () => {
      const venueId = `authz-${i}`;
      await seedVenue(venueId);
      const before = await venueState(venueId);

      for (const key of [`write-${venueId}`, `read-${venueId}`]) {
        const res = await call(venueId, route.method, route.path(venueId), key, route.body);
        expect(res.status).toBe(403);
        expect(((await res.json()) as { code: string }).code).toBe("forbidden");
      }
      expect(await venueState(venueId)).toEqual(before);

      const res = await call(venueId, route.method, route.path(venueId), `admin-${venueId}`, route.body);
      expect(res.status).toBe(route.status);
      expect(await venueState(venueId)).not.toEqual(before);
    });
  });

  it("applies the same rule to staff sessions by venue role", async () => {
    const venueId = "authz-session";
    await seedVenue(venueId);
    const before = await venueState(venueId);
    const floorStaff = await signUpWithRole(venueId, "write");
    const owner = await signUpWithRole(venueId, "admin");

    const rejected = await call(venueId, "PUT", "/config", floorStaff, { noticeAddress: "attacker@example.com" });
    expect(rejected.status).toBe(403);
    expect(((await rejected.json()) as { code: string }).code).toBe("forbidden");
    const table = await call(venueId, "PATCH", "/tables/1", floorStaff, { x: 10 });
    expect(table.status).toBe(403);
    expect(await venueState(venueId)).toEqual(before);

    const walkIn = await call(venueId, "POST", "/reservations/walk-in", floorStaff, { partySize: 2 });
    expect(walkIn.status).toBe(200);

    const accepted = await call(venueId, "PUT", "/config", owner, { noticeAddress: "new-owner@example.com" });
    expect(accepted.status).toBe(200);
    expect(((await accepted.json()) as { noticeAddress: string }).noticeAddress).toBe("new-owner@example.com");
  });

  it("keeps reservation, waitlist, and erasure operations open to a write key", async () => {
    const venueId = "authz-write";
    await seedVenue(venueId);
    const key = `write-${venueId}`;

    const created = await call(venueId, "POST", "/reservations", key, {
      date: DATE,
      time: "21:00",
      partySize: 2,
      guest: { name: "Ana", contact: "ana@example.com" },
    });
    expect(created.status).toBe(200);
    const reservation = (await created.json()) as { id: string; guest: { guestId: string } };

    const modified = await call(venueId, "POST", `/reservations/${reservation.id}/modify`, key, {
      partySize: 3,
      guest: { consent: "granted" },
      rating: 5,
    });
    expect(modified.status).toBe(200);
    expect(await modified.json()).toMatchObject({ partySize: 3, guest: { consent: "granted" }, rating: 5 });

    const seated = await call(venueId, "POST", `/reservations/${reservation.id}/status`, key, { status: "seated" });
    expect(seated.status).toBe(200);
    expect(((await seated.json()) as { status: string }).status).toBe("seated");

    const other = await call(venueId, "POST", "/reservations", key, { date: DATE, time: "22:00", partySize: 2 });
    const { id: otherId } = (await other.json()) as { id: string };
    const cancelled = await call(venueId, "POST", `/reservations/${otherId}/cancel`, key);
    expect(cancelled.status).toBe(200);
    expect(((await cancelled.json()) as { status: string }).status).toBe("cancelled");

    const walkIn = await call(venueId, "POST", "/reservations/walk-in", key, { partySize: 2 });
    expect(walkIn.status).toBe(200);

    const added = await call(venueId, "POST", "/waitlist", key, { partySize: 2, guest: { name: "Luis" } });
    expect(added.status).toBe(201);
    const { entries } = (await added.json()) as { entries: { id: string }[] };
    const seatedEntry = await call(venueId, "POST", `/waitlist/${entries[0].id}/seat`, key);
    expect(seatedEntry.status).toBe(200);

    const second = await call(venueId, "POST", "/waitlist", key, { partySize: 2, guest: { name: "Eva" } });
    const { entries: waiting } = (await second.json()) as { entries: { id: string }[] };
    const dropped = await call(venueId, "POST", `/waitlist/${waiting[0].id}/cancel`, key);
    expect(dropped.status).toBe(200);

    const erased = await call(venueId, "POST", "/erasure", key, { guestId: reservation.guest.guestId });
    expect(erased.status).toBe(200);
    expect(await erased.json()).toMatchObject({ erasedGuests: 1 });
  });
});
