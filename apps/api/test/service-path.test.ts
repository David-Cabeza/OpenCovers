// The service name in `DELETE /services/{name}` is bounded (#417): an empty or very long name is a bad request,
// not a silent 200. A name stored before the bound, longer than it, can still be deleted.
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";

const VENUE = "sp-a";
const OTHER = "sp-b";
const ADMIN = "sp-admin";
const OTHER_ADMIN = "sp-other-admin";

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE account, session, verification, "user", venue_memberships, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
  await db.insert(venues).values([{ id: VENUE }, { id: OTHER }]);
  await addKey(db, ADMIN, "owner", [VENUE], "admin");
  await addKey(db, OTHER_ADMIN, "other", [OTHER], "admin");
});

beforeEach(async () => {
  await db.delete(services);
  await db.insert(services).values([
    { venueId: VENUE, name: "lunch", openStart: "12:00", openEnd: "16:00" },
    { venueId: OTHER, name: "dinner", openStart: "20:00", openEnd: "23:00" },
  ]);
});

const remove = (name: string, venue = VENUE) =>
  app.request(`/v1/venues/${venue}/services/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: { apikey: venue === VENUE ? ADMIN : OTHER_ADMIN },
  });

const stored = async () => (await db.select().from(services)).map((s) => `${s.venueId}/${s.name.slice(0, 20)}`).sort();

describe("DELETE /services/{name} path value", () => {
  it.each([["a name of 201 characters", "n".repeat(201)], ["a name of 5000 characters", "n".repeat(5000)]])(
    "refuses %s with invalid_request and deletes nothing",
    async (_label, name) => {
      const before = await stored();
      const res = await remove(name);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_request");
      expect(await stored()).toEqual(before);
    },
  );

  it("does not delete with an empty name, which matches no route", async () => {
    const before = await stored();
    const res = await app.request(`/v1/venues/${VENUE}/services/`, { method: "DELETE", headers: { apikey: ADMIN } });
    expect(res.status).toBe(404);
    expect(await stored()).toEqual(before);
  });

  it("still answers 200 for an unknown name of up to 200 characters, and deletes a known one", async () => {
    expect((await remove("n".repeat(200))).status).toBe(200);
    expect((await remove("ghost")).status).toBe(200);
    expect(await stored()).toHaveLength(2);
    expect((await remove("lunch")).status).toBe(200);
    expect(await stored()).toEqual([`${OTHER}/dinner`]);
  });

  it("still deletes a service stored with a name over the bound, and only in its own venue", async () => {
    const legacy = "legacy-".padEnd(300, "x");
    await db.insert(services).values({ venueId: VENUE, name: legacy, openStart: "08:00", openEnd: "10:00" });
    expect((await remove(legacy, OTHER)).status).toBe(400);
    expect(await stored()).toHaveLength(3);
    expect((await remove(legacy)).status).toBe(200);
    expect(await stored()).toEqual([`${VENUE}/lunch`, `${OTHER}/dinner`]);
  });
});
