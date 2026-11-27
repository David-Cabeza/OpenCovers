// C4: a staff modify emails the guest only when it changes the party size.
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => [] as unknown[]);

vi.mock("../src/lib/mailer", async (original) => ({
  ...(await original<typeof import("../src/lib/mailer")>()),
  sendEmail: async (...message: unknown[]) => {
    mail.push(message);
  },
}));

import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { saturdayAhead } from "./dates";

const VENUE = "mail-modify";
const KEY = `${VENUE}-writer`;

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
  await db.insert(venues).values({ id: VENUE, timezone: "Europe/Madrid", notificationsEnabled: true });
  await db.insert(services).values({ venueId: VENUE, name: "dinner", openStart: "19:00", openEnd: "23:00" });
  await db
    .insert(tables)
    .values(["a", "b", "c"].map((id) => ({ id: `${VENUE}-${id}`, venueId: VENUE, name: id, seats: 4 })));
  await addKey(db, KEY, `writer-${VENUE}`, [VENUE], "write");
});

let sequence = 0;
async function post(path: string, body: unknown, idem = `${VENUE}-${++sequence}`) {
  const response = await app.request(`/v1/venues/${VENUE}${path}`, {
    method: "POST",
    headers: { apikey: KEY, "content-type": "application/json", "Idempotency-Key": idem },
    body: JSON.stringify(body),
  });
  expect(response.status).toBeLessThan(300);
  return (await response.json()) as { id: string; version: number };
}

/** The route sends after it answers, so a count is read only once nothing more can arrive. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 200));

describe("the email of a staff modify (C4)", () => {
  it("is sent for a change of party size, and not for tables alone or a value resent unchanged", async () => {
    const table = `${VENUE}-a`;
    const { id } = await post("/reservations", {
      date: saturdayAhead(),
      time: "21:00",
      partySize: 2,
      tables: [table],
      guest: { name: "Guest", contact: "guest@example.com" },
    });
    await vi.waitFor(() => expect(mail.length).toBeGreaterThan(0));
    await settled();
    const modify = async (body: unknown, idem?: string) => {
      mail.length = 0;
      const result = await post(`/reservations/${id}/modify`, body, idem);
      await settled();
      return { version: result.version, emails: mail.length };
    };

    // The current version now comes from a write that sends nothing, so no earlier email hides a second one.
    expect(await modify({ rating: 4 })).toEqual({ version: 2, emails: 0 });
    expect(await modify({ tables: [table] })).toEqual({ version: 2, emails: 0 });
    expect(await modify({ partySize: 2 })).toEqual({ version: 2, emails: 0 });
    expect(await modify({ partySize: 2, tables: [table], rating: 5 })).toEqual({ version: 3, emails: 0 });

    expect(await modify({ partySize: 3 }, "grow")).toEqual({ version: 4, emails: 1 });
    expect(await modify({ partySize: 3 }, "grow")).toEqual({ version: 4, emails: 0 });
    expect(await modify({ tables: [`${VENUE}-b`] })).toEqual({ version: 5, emails: 0 });
    expect(await modify({ partySize: 4, tables: [`${VENUE}-c`] })).toEqual({ version: 6, emails: 1 });
  });
});
