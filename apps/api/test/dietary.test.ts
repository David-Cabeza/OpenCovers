// C82: allergies and diets on a reservation (ADR-0027).
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => {
  process.env.PUBLIC_CHALLENGE_SECRET = "test-secret-for-the-dietary-public-routes";
  process.env.PUBLIC_POW_DIFFICULTY = "0";
  return [] as unknown[];
});

vi.mock("../src/lib/mailer", async (original) => ({
  ...(await original<typeof import("../src/lib/mailer")>()),
  sendEmail: async (...message: unknown[]) => {
    mail.push(message);
  },
}));

import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { reservations, sentEmails, services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { auth } from "../src/lib/auth";
import { challengeConfigFromEnv, issueChallenge, solve } from "../src/lib/public-challenge";
import { runRetention } from "../src/lib/retention";
import { runWebhookDeliveries, webhookDepsFromEnv } from "../src/lib/webhooks";
import { saturdayAhead } from "./dates";

const DATE = saturdayAhead();
const challenge = challengeConfigFromEnv();
/** In every note these tests write, so a leak anywhere is one string search. */
const MARK = "zzallergymark";
const VALUE = { allergens: ["molluscs"], diets: ["kosher"], note: `${MARK} onion`, consented: true };
/** What no answer that must not carry the value may contain. */
const SECRETS = [MARK, "molluscs", "kosher", '"dietary":', '"allergens"'];

const logged: unknown[][] = [];
let received: string[] = [];
let hook: Server;
let hookPort: number;
const spies: { mockRestore(): void }[] = [];

beforeAll(async () => {
  process.env.DIETARY = "on";
  process.env.WEBHOOK_ALLOW_INSECURE = "true";
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    spies.push(vi.spyOn(console, level).mockImplementation((...args) => void logged.push(args)));
  }
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE account, session, verification, "user", venue_memberships, webhook_endpoints, sent_emails, waitlist, events, tombstones, idempotency_keys, table_allocations, reservations, guest_audit, guests, grants, api_keys, services, tables, venue_online_booking, venues RESTART IDENTITY CASCADE`,
  );
  hook = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      received.push(JSON.stringify(req.headers) + Buffer.concat(chunks).toString("utf8"));
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => hook.listen(0, "127.0.0.1", resolve));
  hookPort = (hook.address() as AddressInfo).port;
});

beforeEach(() => {
  process.env.DIETARY = "on";
  logged.length = 0;
});

afterAll(async () => {
  delete process.env.DIETARY;
  delete process.env.WEBHOOK_ALLOW_INSECURE;
  for (const spy of spies) spy.mockRestore();
  await new Promise((resolve) => hook.close(resolve));
});

let venueCount = 0;
async function makeVenue(columns: Partial<typeof venues.$inferInsert> = {}) {
  const id = `diet-${++venueCount}`;
  await db.insert(venues).values({ id, name: `Casa ${venueCount}`, timezone: "Europe/Madrid", ...columns });
  await db.insert(services).values({ venueId: id, name: "dinner", openStart: "19:00", openEnd: "23:00" });
  await db
    .insert(tables)
    .values(Array.from({ length: 30 }, (_, i) => ({ id: `${id}-t${i}`, venueId: id, name: `T${i}`, seats: 4 })));
  const keys = { admin: `${id}-admin`, writer: `${id}-writer`, reader: `${id}-reader` };
  await addKey(db, keys.admin, `admin-${id}`, [id], "admin");
  await addKey(db, keys.writer, `writer-${id}`, [id], "write");
  await addKey(db, keys.reader, `reader-${id}`, [id], "read");

  let sequence = 0;
  const call = (method: string, path: string, body?: unknown, options: { key?: string; idem?: string } = {}) =>
    app.request(`/v1/venues/${id}${path}`, {
      method,
      headers: {
        apikey: options.key ?? keys.writer,
        "content-type": "application/json",
        ...(method === "POST" ? { "Idempotency-Key": options.idem ?? `${id}-${++sequence}` } : {}),
      },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
  const post = (path: string, body: unknown, options?: { key?: string; idem?: string }) => call("POST", path, body, options);
  const read = async (path: string) => (await call("GET", path)).json();

  let table = 0;
  const booking = (extra: Record<string, unknown> = {}) => ({
    date: DATE,
    time: "21:00",
    partySize: 2,
    tables: [`${id}-t${table++}`],
    ...extra,
  });
  const create = async (extra: Record<string, unknown> = {}) => {
    const res = await post("/reservations", booking(extra));
    expect(res.status).toBe(200);
    return res.json();
  };
  const modify = (reservationId: string, body: unknown, options?: { key?: string; idem?: string }) =>
    post(`/reservations/${reservationId}/modify`, body, options);
  const events = async (reservationId: string): Promise<{ type: string; version: number }[]> =>
    (await read("/events?limit=1000")).events.filter((e: { reservationId: string }) => e.reservationId === reservationId);
  const stored = async (reservationId: string) =>
    (await db.select().from(reservations).where(eq(reservations.id, reservationId)))[0].dietary;

  return { id, keys, call, post, read, booking, create, modify, events, stored };
}

function expectNoValue(what: unknown) {
  const text = typeof what === "string" ? what : JSON.stringify(what);
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

async function expectInvalid(res: Response) {
  expect(res.status).toBe(400);
  expect((await res.json()).code).toBe("invalid_request");
}

/** Every row of every table, as text. */
async function wholeDatabase(): Promise<string> {
  const names = await db.execute<{ name: string }>(
    sql`select format('%I.%I', table_schema, table_name) as name from information_schema.tables where table_schema in ('public', 'drizzle') and table_type = 'BASE TABLE'`,
  );
  let all = "";
  for (const { name } of names.rows) {
    const rows = await db.execute<{ row: string }>(sql.raw(`select t::text as row from ${name} as t`));
    all += rows.rows.map((r) => r.row).join("\n");
  }
  return all;
}

const logText = () => logged.map((args) => args.map((a) => (typeof a === "string" ? a : JSON.stringify(a) + String((a as Error)?.stack ?? ""))).join(" ")).join("\n");

describe("the value on a reservation", () => {
  it("is stored on create in list order, without repeats, with a trimmed note and who wrote it", async () => {
    const v = await makeVenue();
    const before = Date.now();
    const created = await v.create({
      dietary: {
        allergens: ["milk", "gluten", "milk"],
        diets: ["vegan", "vegetarian", "vegan"],
        note: "  intolerance to onion  ",
        consented: true,
      },
    });
    expect(created.dietary).toEqual({
      allergens: ["gluten", "milk"],
      diets: ["vegetarian", "vegan"],
      note: "intolerance to onion",
      consented: true,
      recordedAt: expect.any(String),
      recordedBy: expect.stringMatching(/^key_[0-9a-f]{12}$/),
    });
    expect(Date.parse(created.dietary.recordedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect((await v.read(`/reservations/${created.id}`)).dietary).toEqual(created.dietary);
    const agenda = (await v.read(`/agenda?date=${DATE}`)).reservations;
    expect(agenda.find((r: { id: string }) => r.id === created.id).dietary).toEqual(created.dietary);
  });

  it("fills the parts left out and takes one part alone", async () => {
    const v = await makeVenue();
    const note = await v.create({ dietary: { note: "x".repeat(200), consented: true } });
    expect(note.dietary).toMatchObject({ allergens: [], diets: [], note: "x".repeat(200) });
    const diet = await v.create({ dietary: { diets: ["halal"], note: "   ", consented: true } });
    expect(diet.dietary).toMatchObject({ allergens: [], diets: ["halal"], note: "" });
  });

  it("has no key when nothing was declared, and null on create or walk-in is no value", async () => {
    const v = await makeVenue();
    for (const created of [await v.create(), await v.create({ dietary: null })]) {
      expect(created).not.toHaveProperty("dietary");
      expect(await v.read(`/reservations/${created.id}`)).not.toHaveProperty("dietary");
    }
    const walkIn = await (await v.post("/reservations/walk-in", { partySize: 2, time: "21:00", date: DATE, dietary: null })).json();
    expect(walkIn.status).toBe("seated");
    expect(walkIn).not.toHaveProperty("dietary");
  });

  it("is stored on a walk-in and carried by the status and cancel answers", async () => {
    const v = await makeVenue();
    const walkIn = await (await v.post("/reservations/walk-in", { partySize: 2, time: "21:00", date: DATE, dietary: VALUE })).json();
    expect(walkIn.dietary.note).toBe(VALUE.note);
    const attended = await (await v.post(`/reservations/${walkIn.id}/status`, { status: "attended" })).json();
    expect(attended.dietary.note).toBe(VALUE.note);

    const booked = await v.create({ dietary: VALUE });
    const cancelled = await (await v.post(`/reservations/${booked.id}/cancel`, {})).json();
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.dietary.note).toBe(VALUE.note);
  });

  it("names a staff member by display name and drops the name once they are no member", async () => {
    const signedUp = await auth.api.signUpEmail({
      body: { name: "Lola Sala", email: "lola-dietary@example.com", password: "password123" },
      asResponse: true,
    });
    const cookie = signedUp.headers.get("set-cookie") as string;
    const venue = await app.request("/v1/venues", {
      method: "POST",
      headers: { Cookie: cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Session Venue" }),
    });
    const id = (await venue.json()).venue.id as string;
    await db.insert(services).values({ venueId: id, name: "dinner", openStart: "19:00", openEnd: "23:00" });
    await db.insert(tables).values({ id: `${id}-t`, venueId: id, name: "T", seats: 4 });
    const res = await app.request(`/v1/venues/${id}/reservations`, {
      method: "POST",
      headers: { Cookie: cookie, "content-type": "application/json", "Idempotency-Key": "staff-1" },
      body: JSON.stringify({ date: DATE, time: "21:00", partySize: 2, dietary: VALUE }),
    });
    const created = await res.json();
    expect(created.dietary.recordedBy).toBe("Lola Sala");

    await db.execute(sql`delete from venue_memberships where venue_id = ${id}`);
    await addKey(db, "session-venue-reader", "reader", [id], "read");
    const after = await app.request(`/v1/venues/${id}/reservations/${created.id}`, { headers: { apikey: "session-venue-reader" } });
    expect((await after.json()).dietary.recordedBy).toBeNull();
  });

  it("refuses every invalid shape and writes nothing", async () => {
    const v = await makeVenue();
    const kept = await v.create({ dietary: VALUE });
    const invalid: unknown[] = [
      "peanuts",
      ["peanuts"],
      5,
      true,
      {},
      { consented: true },
      { allergens: [], diets: [], note: "  ", consented: true },
      { allergens: ["peanuts"] },
      { allergens: ["peanuts"], consented: false },
      { allergens: ["peanuts"], consented: "true" },
      { allergens: ["peanuts"], consented: 1 },
      { allergens: ["peanut"], consented: true },
      { allergens: "peanuts", consented: true },
      { allergens: [1], consented: true },
      { allergens: [null], consented: true },
      { allergens: null, consented: true },
      { diets: ["gluten_free"], consented: true },
      { diets: "vegan", consented: true },
      { note: 5, consented: true },
      { note: null, consented: true },
      { note: "x".repeat(201), consented: true },
      { note: "a\u0000b", consented: true },
      { note: "a\ud800b", consented: true },
      { allergens: ["peanuts"], consented: true, recordedBy: "someone" },
      { allergens: ["peanuts"], consented: true, severity: "high" },
    ];
    const counts = () =>
      db.execute(sql`select (select count(*) from reservations) as r, (select count(*) from idempotency_keys) as k, (select count(*) from events) as e`);
    const before = (await counts()).rows;
    for (const dietary of invalid) {
      await expectInvalid(await v.post("/reservations", v.booking({ dietary })));
      await expectInvalid(await v.post("/reservations/walk-in", { partySize: 2, time: "21:00", date: DATE, dietary }));
      await expectInvalid(await v.modify(kept.id, { dietary }));
    }
    expect((await counts()).rows).toEqual(before);
    expect((await v.read(`/reservations/${kept.id}`)).dietary).toEqual(kept.dietary);
  });

  it("is not written by a read key", async () => {
    const v = await makeVenue();
    const kept = await v.create({ dietary: VALUE });
    const key = { key: v.keys.reader };
    expect((await v.post("/reservations", v.booking({ dietary: VALUE }), key)).status).toBe(403);
    expect((await v.post("/reservations/walk-in", { partySize: 2, dietary: VALUE }, key)).status).toBe(403);
    expect((await v.modify(kept.id, { dietary: null }, key)).status).toBe(403);
    expect(await v.stored(kept.id)).not.toBeNull();
  });

  it("is read by a read key of the venue and by no other venue", async () => {
    const mine = await makeVenue();
    const other = await makeVenue();
    const created = await mine.create({ dietary: VALUE });
    const asReader = await mine.call("GET", `/reservations/${created.id}`, undefined, { key: mine.keys.reader });
    expect((await asReader.json()).dietary.note).toBe(VALUE.note);

    const foreignKey = await mine.call("GET", `/reservations/${created.id}`, undefined, { key: other.keys.admin });
    expect(foreignKey.status).toBe(404);
    expect(await foreignKey.json()).toMatchObject({ code: "venue_not_found" });
    expect((await mine.call("GET", `/agenda?date=${DATE}`, undefined, { key: other.keys.admin })).status).toBe(404);

    for (const res of [
      await other.call("GET", `/reservations/${created.id}`),
      await other.modify(created.id, { dietary: null }),
      await other.modify(created.id, { dietary: { allergens: ["eggs"], consented: true } }),
    ]) {
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe("reservation_not_found");
      expectNoValue(body);
    }
    expectNoValue(await other.read(`/agenda?date=${DATE}`));
    expect((await mine.read(`/reservations/${created.id}`)).dietary).toEqual(created.dietary);
    expect((await mine.read(`/reservations/${created.id}`)).version).toBe(created.version);
  });
});

describe("modify", () => {
  it("keeps an omitted value, replaces it whole, clears it with null, and bumps once with a value-free event", async () => {
    const v = await makeVenue();
    const created = await v.create({ dietary: VALUE });

    const resized = await (await v.modify(created.id, { partySize: 3 })).json();
    expect(resized.version).toBe(2);
    expect(resized.dietary).toEqual(created.dietary);

    const replaced = await (await v.modify(created.id, { dietary: { allergens: ["eggs"], consented: true } })).json();
    expect(replaced.version).toBe(3);
    expect(replaced.dietary).toMatchObject({ allergens: ["eggs"], diets: [], note: "" });

    const cleared = await (await v.modify(created.id, { dietary: null })).json();
    expect(cleared.version).toBe(4);
    expect(cleared).not.toHaveProperty("dietary");
    expect(await v.stored(created.id)).toBeNull();

    const events = await v.events(created.id);
    expect(events.map((e) => [e.type, e.version])).toEqual([["created", 1], ["modified", 2], ["modified", 3], ["modified", 4]]);
    expectNoValue(events);
  });

  it("changes nothing for the same value or for null with no value", async () => {
    const v = await makeVenue();
    const created = await v.create({ dietary: { allergens: ["milk", "eggs"], note: "a", consented: true } });
    await new Promise((r) => setTimeout(r, 5));
    const same = await (
      await v.modify(created.id, { dietary: { allergens: ["eggs", "milk", "eggs"], diets: [], note: " a ", consented: true } })
    ).json();
    expect(same.version).toBe(1);
    expect(same.dietary).toEqual(created.dietary);

    const empty = await v.create();
    expect((await (await v.modify(empty.id, { dietary: null })).json()).version).toBe(1);
    expect(await v.events(empty.id)).toHaveLength(1);
    expect(await v.events(created.id)).toHaveLength(1);
  });

  it("takes a value on booked, seated and attended, and refuses it on cancelled and no_show", async () => {
    const v = await makeVenue();
    const visit = await v.create();
    await v.post(`/reservations/${visit.id}/status`, { status: "seated" });
    expect((await v.modify(visit.id, { dietary: VALUE })).status).toBe(200);
    await v.post(`/reservations/${visit.id}/status`, { status: "attended" });
    const attended = await v.modify(visit.id, { dietary: { ...VALUE, note: "later" } });
    expect((await attended.json()).dietary.note).toBe("later");

    for (const end of ["cancel", "no_show"] as const) {
      const created = await v.create({ dietary: VALUE });
      if (end === "cancel") await v.post(`/reservations/${created.id}/cancel`, {});
      else await v.post(`/reservations/${created.id}/status`, { status: "no_show" });

      for (const body of [
        { dietary: VALUE },
        { dietary: { allergens: ["eggs"], consented: true } },
        { dietary: null, commentary: "x" },
        { dietary: null, unknownField: 1 },
      ]) {
        const res = await v.modify(created.id, body);
        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe("invalid_transition");
      }
      expect(await v.stored(created.id)).not.toBeNull();

      const withdrawn = await v.modify(created.id, { dietary: null }, { idem: `withdraw-${end}` });
      expect(withdrawn.status).toBe(200);
      const body = await withdrawn.json();
      expect(body.version).toBe(3);
      expect(body).not.toHaveProperty("dietary");
      expect(await v.stored(created.id)).toBeNull();

      const again = await (await v.modify(created.id, { dietary: null }, { idem: `withdraw-${end}` })).json();
      expect(again.version).toBe(3);
      expect((await (await v.modify(created.id, { dietary: null })).json()).version).toBe(3);
      expect((await v.events(created.id)).filter((e) => e.type === "modified")).toHaveLength(1);
    }
  });

  it("gives concurrent changes distinct, consecutive versions", async () => {
    const v = await makeVenue();
    const created = await v.create();
    const codes = ["gluten", "crustaceans", "eggs", "fish", "peanuts", "soybeans", "milk", "nuts"];
    const answers = await Promise.all(codes.map((code) => v.modify(created.id, { dietary: { allergens: [code], consented: true } })));
    const versions = await Promise.all(answers.map(async (res) => (await res.json()).version));
    expect(answers.every((res) => res.status === 200)).toBe(true);
    const events = (await v.events(created.id)).map((e) => e.version);
    expect(events).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // An answer reads the reservation after its own commit, so two can show the same later version. The events above
    // are what prove one version per write.
    expect(versions.every((version) => version >= 2 && version <= 9)).toBe(true);
    expect(Math.max(...versions)).toBe(9);
  });

  it("applies nothing of a replayed body and answers with the value as it reads now", async () => {
    const v = await makeVenue();
    const body = v.booking({ dietary: VALUE });
    const first = await (await v.post("/reservations", body, { idem: "replay-create" })).json();
    const changed = { allergens: ["eggs"], consented: true };
    await v.modify(first.id, { dietary: changed }, { idem: "replay-modify" });
    await v.modify(first.id, { dietary: null });

    const createAgain = await (await v.post("/reservations", { ...body, dietary: changed }, { idem: "replay-create" })).json();
    expect(createAgain.id).toBe(first.id);
    expect(createAgain.version).toBe(3);
    expect(createAgain).not.toHaveProperty("dietary");

    const modifyAgain = await (await v.modify(first.id, { dietary: changed }, { idem: "replay-modify" })).json();
    expect(modifyAgain).not.toHaveProperty("dietary");
    expect(await v.stored(first.id)).toBeNull();
    expect(await v.events(first.id)).toHaveLength(3);
  });

  it("applies nothing on the late retry of a modify that changed nothing", async () => {
    const v = await makeVenue();
    const created = await v.create({ dietary: VALUE });
    expect((await (await v.modify(created.id, { dietary: VALUE }, { idem: "unchanged-value" })).json()).version).toBe(1);
    await v.modify(created.id, { dietary: null });
    const restore = await v.modify(created.id, { dietary: VALUE }, { idem: "unchanged-value" });
    expect(restore.status).toBe(200);
    expect(await restore.json()).not.toHaveProperty("dietary");
    expect(await v.stored(created.id)).toBeNull();

    expect((await (await v.modify(created.id, { dietary: null }, { idem: "unchanged-null" })).json()).version).toBe(2);
    await v.modify(created.id, { dietary: VALUE }, { idem: "recorded" });
    const wipe = await (await v.modify(created.id, { dietary: null }, { idem: "unchanged-null" })).json();
    expect(wipe.version).toBe(3);
    expect(wipe.dietary.note).toBe(VALUE.note);

    const trace = await v.read(`/reservations/${created.id}/trace`);
    expect(trace.entries.map((e: { version: number; idempotencyKey: string }) => [e.version, e.idempotencyKey])).toEqual([
      [1, expect.any(String)],
      [2, expect.any(String)],
      [3, "recorded"],
    ]);
    expect(JSON.stringify(trace)).not.toContain("unchanged-");
    await expectInvalid(await v.post(`/reservations/${created.id}/status`, { status: "seated" }, { idem: "unchanged-null" }));
  });

  it("keeps no value in the idempotency storage", async () => {
    const v = await makeVenue();
    const created = await v.create({ dietary: VALUE });
    await v.modify(created.id, { dietary: { ...VALUE, note: `${MARK} again` } });
    const keys = await db.execute<{ row: string }>(sql`select k::text as row from idempotency_keys as k where venue_id = ${v.id}`);
    expect(keys.rows).toHaveLength(2);
    expectNoValue(keys.rows);
  });
});

describe("where the value never goes", () => {
  it("is not in list, search, events, trace, guest reads, webhooks, emails or logs", async () => {
    const v = await makeVenue({ notificationsEnabled: true, noticeAddress: "notice@example.com" });
    const registered = await v.call("POST", "/webhooks", { url: `http://127.0.0.1:${hookPort}/hook` });
    expect(registered.status).toBe(201);
    mail.length = 0;
    received = [];

    const guest = { name: "Ana", contact: "ana-dietary@example.com" };
    const created = await v.create({ guest, dietary: VALUE });
    await v.modify(created.id, { dietary: { ...VALUE, note: `${MARK} changed` } });
    const resized = await (await v.modify(created.id, { partySize: 3 })).json();
    expect(resized.dietary.note).toContain(MARK);
    await v.post(`/reservations/${created.id}/status`, { status: "seated" });
    await v.post(`/reservations/${created.id}/status`, { status: "attended" });
    const other = await v.create({ guest, dietary: VALUE });
    await v.post(`/reservations/${other.id}/cancel`, {});
    await vi.waitFor(async () => {
      const rows = await db.select().from(sentEmails).where(eq(sentEmails.venueId, v.id));
      expect(rows.map((r) => r.kind).sort()).toEqual(
        ["cancellation", "confirmation", "confirmation", "confirmation", "notice", "notice"],
      );
    });
    const deps = webhookDepsFromEnv();
    await runWebhookDeliveries(db, { ...deps, now: () => new Date(Date.now() + 60_000) });

    const owner = await v.call("GET", "/reservations", undefined, { key: v.keys.writer });
    const list = await owner.json();
    expect(list.reservations).toHaveLength(2);
    expectNoValue(list);
    const search = await v.read(`/reservations/search?dateStart=2020-01-01&dateEnd=2100-01-01`);
    expect(search.reservations).toHaveLength(2);
    expectNoValue(search);
    expectNoValue(await v.read("/events?limit=1000"));
    expectNoValue(await v.read(`/reservations/${created.id}/trace`));
    const guests = await v.read("/guests");
    expect(guests.guests).toHaveLength(1);
    expectNoValue(guests);
    expectNoValue(await v.read(`/guests/${guests.guests[0].guestId}`));
    expect(received.length).toBeGreaterThan(0);
    expectNoValue(received);
    expect(mail.length).toBeGreaterThan(0);
    // Attachments are Base64, so decode them before the search.
    const attachments = mail.flatMap((m) => ((m as unknown[])[6] ?? []) as { content: string }[]);
    expectNoValue(mail);
    expectNoValue(attachments.map((a) => Buffer.from(a.content, "base64").toString("utf8")));
    const erased = await (await v.post("/erasure", { guestId: guest.contact }, { key: v.keys.admin })).json();
    expect(erased).toEqual({ erasedReservations: 2, erasedGuests: 1, erasedWaitlistEntries: 0, blocklistEntriesKept: 0 });
    const feed = await v.read("/events?limit=1000");
    expect(feed.events.filter((e: { type: string }) => e.type === "erased")).toHaveLength(2);
    expectNoValue(feed);
    expectNoValue(logText());
  });

  it("is not in a waitlist seat answer, even replayed after a value was written", async () => {
    const v = await makeVenue();
    // A seat books the current time, whatever hour the test runs at.
    await db.update(services).set({ openStart: "00:00", openEnd: "24:00" }).where(eq(services.venueId, v.id));
    const added = await (await v.post("/waitlist", { partySize: 2, dietary: VALUE })).json();
    expectNoValue(added);
    const entry = added.entries[0].id;
    const seated = await (await v.post(`/waitlist/${entry}/seat`, { dietary: VALUE }, { idem: "seat-1" })).json();
    expectNoValue(seated);
    expect(await v.stored(seated.id)).toBeNull();
    await v.modify(seated.id, { dietary: VALUE });
    const replay = await (await v.post(`/waitlist/${entry}/seat`, {}, { idem: "seat-1" })).json();
    expect(replay.id).toBe(seated.id);
    expectNoValue(replay);
    expectNoValue(await v.read("/waitlist"));
  });

  it("is not taken or shown by the public channel, whatever the switch says", async () => {
    const v = await makeVenue({ name: "Public" });
    const settings = await v.call("PUT", "/online-booking", { enabled: true }, { key: v.keys.admin });
    const bookingKey = (await settings.json()).bookingKey as string;
    const publicCreate = async (extra: Record<string, unknown>) => {
      const issued = issueChallenge(challenge, bookingKey, Date.now() - 10_000);
      const idem = crypto.randomUUID();
      return app.request(`/v1/public/${bookingKey}/reservations`, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": idem },
        body: JSON.stringify({
          date: DATE,
          time: "20:00",
          partySize: 2,
          guest: { name: "Marta", contact: `marta-${idem}@example.com` },
          challenge: issued,
          solution: solve(issued, idem),
          ...extra,
        }),
      });
    };
    for (const flag of ["on", "off"]) {
      process.env.DIETARY = flag;
      for (const dietary of [VALUE, null]) await expectInvalid(await publicCreate({ dietary }));
    }
    process.env.DIETARY = "on";
    const booked = await publicCreate({});
    expect(booked.status).toBe(200);
    const { selfServiceToken, reservation } = await booked.json();
    const [row] = await db.select().from(reservations).where(eq(reservations.venueId, v.id));
    expect((await v.modify(row.id, { dietary: VALUE })).status).toBe(200);

    const self = (path: string, body: unknown) =>
      app.request(`/v1/public/self-service${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Self-Service-Token": selfServiceToken, "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
    for (const flag of ["on", "off"]) {
      process.env.DIETARY = flag;
      for (const dietary of [VALUE, null]) await expectInvalid(await self("/modify", { version: 2, partySize: 3, dietary }));
    }
    process.env.DIETARY = "on";
    const view = await app.request("/v1/public/self-service", { headers: { "X-Self-Service-Token": selfServiceToken } });
    expect(view.status).toBe(200);
    expectNoValue(await view.json());
    const modified = await self("/modify", { version: 2, partySize: 3 });
    expect(modified.status).toBe(200);
    expectNoValue(await modified.json());
    expect(await v.stored(row.id)).not.toBeNull();
    const cancelled = await self("/cancel", {});
    expect(cancelled.status).toBe(200);
    expectNoValue(await cancelled.json());
    expectNoValue(reservation);
    expectNoValue(await (await app.request(`/v1/public/${bookingKey}`)).json());
    expectNoValue(logText());
  });

  it("is not logged when the database refuses the write that carries it", async () => {
    const v = await makeVenue();
    const kept = await v.create();
    await db.execute(sql`create or replace function dietary_test_fail() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$`);
    await db.execute(sql`create trigger dietary_test_fail before insert or update on reservations for each row execute function dietary_test_fail()`);
    try {
      const guest = { name: `${MARK} name`, contact: "fail@example.com" };
      for (const res of [
        await v.post("/reservations", v.booking({ guest, dietary: VALUE })),
        await v.post("/reservations/walk-in", { partySize: 2, time: "21:00", date: DATE, dietary: VALUE }),
        await v.modify(kept.id, { dietary: VALUE }),
      ]) {
        expect(res.status).toBe(500);
        expectNoValue(await res.text());
      }
    } finally {
      await db.execute(sql`drop trigger dietary_test_fail on reservations`);
      await db.execute(sql`drop function dietary_test_fail`);
    }
    // The failure is still reported, with what locates it.
    expect(logged).toHaveLength(3);
    expect(logText()).toContain("forced failure");
    expectNoValue(logText());
  });

  it("is not logged when the body that holds it is not valid JSON", async () => {
    const v = await makeVenue();
    const kept = await v.create();
    // A parse error quotes only a few characters of the body, so the note is short enough to be quoted whole.
    const broken = '{"a":qj7}';
    for (const res of [
      await v.post("/reservations", broken),
      await v.post("/reservations/walk-in", broken),
      await v.modify(kept.id, broken),
    ]) {
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain("qj7");
    }
    expect(logged).toHaveLength(3);
    expect(logText()).toContain("SyntaxError");
    expect(logText()).not.toContain("qj7");
  });
});

describe("the instance switch", () => {
  it("is reported in the venue config and not written by it", async () => {
    const v = await makeVenue();
    for (const [flag, enabled] of [["on", true], ["off", false], ["", false]] as const) {
      process.env.DIETARY = flag;
      expect((await v.read("/config")).dietaryEnabled).toBe(enabled);
      const put = await v.call("PUT", "/config", { dietaryEnabled: !enabled }, { key: v.keys.admin });
      expect(put.status).toBe(200);
      expect((await put.json()).dietaryEnabled).toBe(enabled);
    }
    delete process.env.DIETARY;
    expect((await v.read("/config")).dietaryEnabled).toBe(false);
  });

  it("off refuses a value before the key is looked up and takes null", async () => {
    const v = await makeVenue();
    const earlier = v.booking({ dietary: VALUE });
    expect((await v.post("/reservations", earlier, { idem: "used-while-on" })).status).toBe(200);

    delete process.env.DIETARY;
    const body = v.booking();
    for (const dietary of [VALUE, {}, "peanuts", false]) {
      await expectInvalid(await v.post("/reservations", { ...body, dietary }, { idem: "off-1" }));
      await expectInvalid(await v.post("/reservations/walk-in", { partySize: 2, dietary }));
    }
    // A replay of a key whose body holds a value fails too: the body is refused before the key.
    await expectInvalid(await v.post("/reservations", earlier, { idem: "used-while-on" }));
    const keys = await db.execute(sql`select 1 from idempotency_keys where venue_id = ${v.id} and key = 'off-1'`);
    expect(keys.rows).toHaveLength(0);

    const created = await (await v.post("/reservations", { ...body, dietary: null }, { idem: "off-1" })).json();
    expect(created.status).toBe("booked");
    await expectInvalid(await v.modify(created.id, { dietary: VALUE }));
    expect((await v.modify(created.id, { dietary: null })).status).toBe(200);
    expect(await v.stored(created.id)).toBeNull();
  });

  it("off hides a stored value from every answer, keeps it, and on shows it again", async () => {
    const v = await makeVenue();
    const created = await v.create({ dietary: VALUE });

    process.env.DIETARY = "off";
    const answers = [
      await v.read(`/reservations/${created.id}`),
      await v.read(`/agenda?date=${DATE}`),
      await v.read("/reservations"),
      await v.read("/reservations/search?dateStart=2020-01-01&dateEnd=2100-01-01"),
      await (await v.modify(created.id, { partySize: 3 })).json(),
      await (await v.post(`/reservations/${created.id}/status`, { status: "seated" })).json(),
    ];
    for (const answer of answers) expectNoValue(answer);
    expect((await v.stored(created.id))?.note).toBe(VALUE.note);

    process.env.DIETARY = "on";
    expect((await v.read(`/reservations/${created.id}`)).dietary).toEqual(created.dietary);

    process.env.DIETARY = "off";
    const cancelled = await (await v.post(`/reservations/${created.id}/cancel`, {})).json();
    expectNoValue(cancelled);
    const withdrawn = await (await v.modify(created.id, { dietary: null })).json();
    expect(withdrawn.version).toBe(cancelled.version + 1);
    expect(await v.stored(created.id)).toBeNull();
    process.env.DIETARY = "on";
    expect(await v.read(`/reservations/${created.id}`)).not.toHaveProperty("dietary");
  });
});

describe("erasure and retention", () => {
  for (const flag of ["on", "off"]) {
    it(`erasure by guest and by principal removes it with the switch ${flag}`, async () => {
      const v = await makeVenue();
      const linked = await v.create({ guest: { contact: `erase-${flag}@example.com` }, dietary: VALUE });
      const unlinked = await v.create({ dietary: VALUE });
      process.env.DIETARY = flag;

      const byGuest = await (await v.post("/erasure", { guestId: `erase-${flag}@example.com` }, { key: v.keys.admin })).json();
      expect(byGuest).toEqual({ erasedReservations: 1, erasedGuests: 1, erasedWaitlistEntries: 0, blocklistEntriesKept: 0 });
      expect(await v.stored(linked.id)).toBeNull();
      expect(await v.stored(unlinked.id)).not.toBeNull();

      const byPrincipal = await (await v.post("/erasure", { principal: `writer-${v.id}` }, { key: v.keys.admin })).json();
      expect(byPrincipal).toMatchObject({ erasedReservations: 1 });
      expect(await v.stored(unlinked.id)).toBeNull();

      process.env.DIETARY = "on";
      expect(await v.read(`/reservations/${unlinked.id}`)).not.toHaveProperty("dietary");
      await expectInvalid(await v.modify(unlinked.id, { dietary: VALUE }));
      expect(await v.stored(unlinked.id)).toBeNull();
      expect((await (await v.modify(unlinked.id, { dietary: null })).json()).version).toBe(1);
    });
  }

  it("never leaves a value behind when an erasure races a modify", async () => {
    const v = await makeVenue();
    for (let i = 0; i < 12; i++) {
      const contact = `race-${i}@example.com`;
      const created = await v.create({ guest: { contact }, dietary: VALUE });
      const [erased, modified] = await Promise.all([
        v.post("/erasure", { guestId: contact }, { key: v.keys.admin }),
        v.modify(created.id, { dietary: { ...VALUE, note: `${MARK} ${i}` } }),
      ]);
      expect(erased.status).toBe(200);
      expect([200, 400]).toContain(modified.status);
      expect(await v.stored(created.id)).toBeNull();
    }
  });

  for (const flag of ["on", "off"]) {
    it(`retention removes it with the switch ${flag}, a reservation that holds nothing else included`, async () => {
      const v = await makeVenue({ retentionDays: 30 });
      const old = { date: "2024-01-13" };
      const only = await v.create({ ...old, dietary: VALUE });
      const linked = await v.create({ ...old, time: "20:00", guest: { contact: `ret-${flag}@example.com` }, dietary: VALUE });
      const recent = await v.create({ dietary: VALUE });
      process.env.DIETARY = flag;

      await runRetention(db, new Date());

      expect(await v.stored(only.id)).toBeNull();
      expect(await v.stored(linked.id)).toBeNull();
      expect(await v.stored(recent.id)).not.toBeNull();
      const [row] = await db.select().from(reservations).where(eq(reservations.id, only.id));
      expect(row).toMatchObject({ erased: true, partySize: 2, date: "2024-01-13" });
      expect((await v.events(only.id)).map((e) => e.type)).toEqual(["created", "erased"]);
      expectNoValue(await v.events(only.id));
      expectNoValue(logText());
    });
  }

  it("leaves the value nowhere in the database once erased", async () => {
    await db.execute(sql`TRUNCATE TABLE idempotency_keys, table_allocations, reservations, guest_audit, guests, events CASCADE`);
    const v = await makeVenue();
    const contact = "nowhere@example.com";
    const created = await v.create({ guest: { contact }, dietary: VALUE });
    await v.modify(created.id, { dietary: { ...VALUE, note: `${MARK} second` } });
    await v.post(`/reservations/${created.id}/cancel`, {});
    expect(await wholeDatabase()).toContain(MARK);
    await v.post("/erasure", { guestId: contact }, { key: v.keys.admin });
    expect(await wholeDatabase()).not.toContain(MARK);
  });
});
