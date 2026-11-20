import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string }[] }));

vi.mock("../src/lib/mailer", async (original) => ({
  ...(await original<typeof import("../src/lib/mailer")>()),
  sendEmail: async (_key: string, _from: string, to: string, subject: string) => {
    mail.sent.push({ to, subject });
  },
}));

import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { sentEmails, services, tables, venues } from "../src/db/schema";
import { resolveEmailLocale } from "../src/lib/email-messages";
import { buildEmail } from "../src/lib/mailer";
import { notifyReservation } from "../src/lib/notifications";
import { createReservation } from "../src/lib/reservations";

async function seedVenue(venueId: string, notificationsEnabled = false) {
  await db
    .insert(venues)
    .values({ id: venueId, timezone: "Europe/Madrid", notificationsEnabled })
    .onConflictDoNothing();
  await db
    .insert(services)
    .values([{ venueId, name: "dinner", openStart: "19:00", openEnd: "23:00" }])
    .onConflictDoNothing();
  await db
    .insert(tables)
    .values([{ id: "1", venueId, name: "T1", seats: 2 }])
    .onConflictDoNothing();
}

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
});

describe("notifications", () => {
  it("sends nothing when notifications are disabled", async () => {
    await seedVenue("ntf-off");
    const res = await createReservation(
      db,
      "ntf-off",
      { date: "2026-11-12", time: "21:00", durationMinutes: 120, partySize: 2, tableIds: ["1"], guestContact: "guest@example.com" },
      "k1",
    );
    if (!res.ok) throw new Error("create failed");
    await notifyReservation(db, "ntf-off", res.id, res.version, "confirmation");
    expect(await db.select().from(sentEmails)).toHaveLength(0);
  });

  it("sends once per reservation and version", async () => {
    await seedVenue("ntf-on", true);
    const res = await createReservation(
      db,
      "ntf-on",
      { date: "2026-11-12", time: "21:00", durationMinutes: 120, partySize: 2, tableIds: ["1"], guestContact: "guest@example.com" },
      "k1",
    );
    if (!res.ok) throw new Error("create failed");
    await notifyReservation(db, "ntf-on", res.id, res.version, "confirmation");
    await notifyReservation(db, "ntf-on", res.id, res.version, "confirmation");

    const rows = await db
      .select()
      .from(sentEmails)
      .where(eq(sentEmails.reservationId, res.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("confirmation");
    expect(rows[0].version).toBe(1);
  });

  it("sends a new confirmation for a new version", async () => {
    await seedVenue("ntf-version", true);
    const res = await createReservation(
      db,
      "ntf-version",
      { date: "2026-11-12", time: "21:00", durationMinutes: 120, partySize: 2, tableIds: ["1"], guestContact: "guest@example.com" },
      "k1",
    );
    if (!res.ok) throw new Error("create failed");
    await notifyReservation(db, "ntf-version", res.id, 1, "confirmation");
    await notifyReservation(db, "ntf-version", res.id, 2, "confirmation");

    const rows = await db
      .select()
      .from(sentEmails)
      .where(eq(sentEmails.reservationId, res.id));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.version).sort()).toEqual([1, 2]);
  });
});

describe("the guest's stored locale in emails (ADR-0024, C67)", () => {
  it("resolves the stored locale first, then the venue's, then es, and never throws", () => {
    // A catalog ships for es only today, so every other code falls through. The order is what is pinned.
    expect(resolveEmailLocale("es", "en")).toBe("es");
    expect(resolveEmailLocale("en", "es")).toBe("es");
    expect(resolveEmailLocale(null, "fr")).toBe("es");
    expect(resolveEmailLocale(undefined, undefined)).toBe("es");
    expect(resolveEmailLocale("xx", "yy")).toBe("es");
  });

  it("still sends the es email for a booking stored with a locale that has no catalog", async () => {
    await seedVenue("ntf-locale", true);
    const res = await createReservation(
      db,
      "ntf-locale",
      { date: "2026-11-12", time: "21:00", durationMinutes: 120, partySize: 2, tableIds: ["1"], guestContact: "guest@example.com", guestLocale: "fr" },
      "k1",
    );
    if (!res.ok) throw new Error("create failed");
    mail.sent.length = 0;
    const context = { venueName: "", date: "2026-11-12", time: "21:00", partySize: 2, guestName: "", service: "dinner" };
    const esSubject = buildEmail("confirmation", context, "es").subject;
    await notifyReservation(db, "ntf-locale", res.id, res.version, "confirmation");
    const rows = await db.select().from(sentEmails).where(eq(sentEmails.reservationId, res.id));
    expect(rows).toHaveLength(1);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].subject).toBe(esSubject);
  });
});
