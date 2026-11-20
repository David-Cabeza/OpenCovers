import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, venueOnlineBooking, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { DEFAULT_BACKGROUND, DEFAULT_DARK_BACKGROUND, DEFAULT_DARK_TEXT, DEFAULT_TEXT } from "../src/lib/online-booking";

const KEY = /^pk_[A-Za-z0-9_-]{22}$/;

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
  await db.insert(venues).values([
    { id: "oa", name: "Casa Alba", timezone: "Europe/Madrid", resendApiKey: "re_secret_key", noticeAddress: "owner@example.com" },
    { id: "ob", name: "Other Place", timezone: "Europe/Madrid" },
    { id: "oc", name: "", timezone: "Europe/Madrid" },
    { id: "od", name: "No Services", timezone: "Europe/Madrid" },
  ]);
  await db.insert(services).values([
    { venueId: "oa", name: "lunch", openStart: "13:00", openEnd: "16:00", days: [1, 2, 3, 4, 5] },
    { venueId: "oa", name: "dinner", openStart: "20:00", openEnd: "23:30", days: [5, 6] },
    { venueId: "ob", name: "brunch", openStart: "09:00", openEnd: "11:00" },
    { venueId: "oc", name: "lunch", openStart: "13:00", openEnd: "16:00" },
  ]);
  await addKey(db, "oa-admin", "admin", ["oa", "oc", "od"], "admin");
  await addKey(db, "oa-write", "writer", ["oa"], "write");
  await addKey(db, "oa-read", "reader", ["oa"], "read");
  await addKey(db, "ob-admin", "admin-b", ["ob"], "admin");
});

const url = (venue: string) => `/v1/venues/${venue}/online-booking`;
const get = (venue: string, key: string) => app.request(url(venue), { headers: { apikey: key } });
const put = (venue: string, key: string, body: unknown) =>
  app.request(url(venue), {
    method: "PUT",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const rotate = (venue: string, key: string) =>
  app.request(`${url(venue)}/rotate-key`, { method: "POST", headers: { apikey: key } });
const read = async (venue = "oa", key = "oa-admin") => (await get(venue, key)).json();

const contract = readFileSync(path.resolve(import.meta.dirname, "../../../docs/contract/openapi.yaml"), "utf8");
function schemaBlock(name: string): string {
  const start = contract.indexOf(`\n    ${name}:\n`);
  const rest = contract.slice(start + 1);
  const end = rest.slice(1).search(/\n {4}[A-Za-z]+:\n/);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

describe("online booking settings", () => {
  it("reads the documented defaults for a venue that never set it, to every role", async () => {
    for (const key of ["oa-admin", "oa-write", "oa-read"]) {
      const res = await get("oa", key);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        enabled: false,
        bookingKey: null,
        allowedOrigins: [],
        services: null,
        weekdays: null,
        minPartySize: 1,
        maxPartySize: 8,
        leadTimeMinutes: 0,
        maxAdvanceDays: null,
        selfServiceCutoffMinutes: 120,
        maxOpenBookingsPerContact: 2,
        confirmationMode: "auto",
        askConsent: false,
        locale: "es",
        theme: {},
        privacyNoticeUrl: null,
        publicZones: [],
        showServiceNames: false,
        waitlistEnabled: false,
      });
    }
    expect(await db.select().from(venueOnlineBooking)).toHaveLength(0);
  });

  it("response keys equal the OpenAPI schema, and the save adds only warnings", async () => {
    const block = schemaBlock("OnlineBooking");
    const required = block
      .slice(block.indexOf("required:"), block.indexOf("properties:"))
      .match(/^ {8}- ([A-Za-z]+)$/gm)!
      .map((l) => l.trim().slice(2))
      .sort();
    const body = await read();
    expect(Object.keys(body).sort()).toEqual(required);
    const saved = await (await put("oa", "oa-admin", { locale: "es" })).json();
    expect(Object.keys(saved).sort()).toEqual([...required, "warnings"].sort());
    expect(saved.warnings).toEqual([]);
    const updateProps = schemaBlock("OnlineBookingUpdate");
    for (const k of required.filter((k) => k !== "bookingKey")) expect(updateProps).toContain(`${k}:`);
  });

  it("round-trips every field and keeps the rest on a partial update", async () => {
    const full = {
      enabled: false,
      allowedOrigins: ["https://www.example.com", "https://shop.example.com:8443"],
      services: ["lunch"],
      weekdays: [1, 2, 3],
      minPartySize: 2,
      maxPartySize: 6,
      leadTimeMinutes: 90,
      maxAdvanceDays: 60,
      selfServiceCutoffMinutes: 30,
      maxOpenBookingsPerContact: 3,
      confirmationMode: "auto",
      askConsent: true,
      locale: "en",
      privacyNoticeUrl: "https://www.example.com/privacy",
      publicZones: [] as string[],
      showServiceNames: true,
      // `true` needs the venue's email on (C68), covered in public-waitlist.test.ts.
      waitlistEnabled: false,
      theme: {
        colors: { primary: "#1f6f5c", onPrimary: "#ffffff", background: "#ffffff", surface: "#f7f7f7", text: "#111111", muted: "#666666", border: "#dddddd" },
        radius: 12,
        font: "serif",
        logoUrl: "https://www.example.com/logo.png",
      },
    };
    const res = await put("oa", "oa-admin", full);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...full, bookingKey: null, warnings: [] });
    expect(await read()).toEqual({ ...full, bookingKey: null });
    await put("oa", "oa-admin", { maxPartySize: 10 });
    expect(await read()).toEqual({ ...full, maxPartySize: 10, bookingKey: null });
  });

  it("null resets the nullable fields and the theme", async () => {
    const res = await put("oa", "oa-admin", {
      services: null,
      weekdays: null,
      maxAdvanceDays: null,
      maxOpenBookingsPerContact: null,
      privacyNoticeUrl: null,
      theme: null,
    });
    expect(res.status).toBe(200);
    const body = await read();
    expect(body).toMatchObject({
      services: null,
      weekdays: null,
      maxAdvanceDays: null,
      maxOpenBookingsPerContact: null,
      privacyNoticeUrl: null,
      theme: {},
    });
    await put("oa", "oa-admin", { maxOpenBookingsPerContact: 2, maxPartySize: 8, minPartySize: 1 });
  });

  it("normalizes origins and merges duplicates", async () => {
    const res = await put("oa", "oa-admin", {
      allowedOrigins: ["https://WWW.Example.com", "https://www.example.com", "https://a.example.com:8443"],
    });
    expect((await res.json()).allowedOrigins).toEqual(["https://www.example.com", "https://a.example.com:8443"]);
    await put("oa", "oa-admin", { allowedOrigins: [] });
    expect((await read()).allowedOrigins).toEqual([]);
  });

  it("rejects every invalid setting and changes nothing", async () => {
    const before = await read();
    const bad: unknown[] = [
      {},
      [],
      "x",
      { allowedOrigins: ["http://example.com"] },
      { allowedOrigins: ["https://*.example.com"] },
      { allowedOrigins: ["https://example.com/path"] },
      { allowedOrigins: ["https://example.com/"] },
      { allowedOrigins: ["https://example.com?x=1"] },
      { allowedOrigins: ["https://example.com#f"] },
      { allowedOrigins: ["https://user:pw@example.com"] },
      { allowedOrigins: ["https://example.com:99999"] },
      { allowedOrigins: ["example.com"] },
      { allowedOrigins: "https://example.com" },
      { allowedOrigins: Array.from({ length: 11 }, (_, i) => `https://h${i}.example.com`) },
      { services: ["nope"] },
      { services: [] },
      { weekdays: [] },
      { weekdays: [0] },
      { weekdays: [8] },
      { weekdays: [1, 1] },
      { weekdays: [1.5] },
      { minPartySize: 0 },
      { minPartySize: 101 },
      { maxPartySize: 0 },
      { maxPartySize: 101 },
      { minPartySize: 9 },
      { maxPartySize: 0.5 },
      { leadTimeMinutes: -1 },
      { leadTimeMinutes: 10081 },
      { selfServiceCutoffMinutes: 10081 },
      { selfServiceCutoffMinutes: null },
      { maxAdvanceDays: 1001 },
      { maxAdvanceDays: -1 },
      { maxOpenBookingsPerContact: 0 },
      { maxOpenBookingsPerContact: 21 },
      { locale: "xx" },
      { locale: "FR" },
      { locale: null },
      { enabled: "yes" },
      { enabled: null },
      { askConsent: 1 },
      { confirmationMode: "approval" },
      { confirmationMode: "manual" },
      { confirmationMode: null },
      { theme: "dark" },
      { theme: { css: "body{}" } },
      { theme: { colors: { primary: "red" } } },
      { theme: { colors: { primary: "#fff" } } },
      { theme: { colors: { accent: "#ffffff" } } },
      { theme: { colors: { primary: "#1f6f5c; x" } } },
      { theme: { radius: 25 } },
      { theme: { radius: -1 } },
      { theme: { radius: 1.5 } },
      { theme: { font: "Comic Sans" } },
      { theme: { font: "https://fonts.example.com/f.woff" } },
      { theme: { logoUrl: "http://example.com/l.png" } },
      { theme: { logoUrl: "https://user:pw@example.com/l.png" } },
      { theme: { logoUrl: `https://example.com/${"a".repeat(2048)}` } },
      { theme: { logoUrl: "javascript:alert(1)" } },
      { theme: [] },
      { theme: { colors: ["#ffffff"] } },
      { theme: { colors: { primary: null } } },
      { theme: { colors: { primary: "red; background:url(https://evil.example/x)" } } },
      { theme: { colors: { background: "#ffffff;}body{display:none" } } },
      { theme: { colors: { text: "var(--x)" } } },
      { theme: { colors: { text: "rgb(0,0,0)" } } },
      { theme: { colors: { text: "#00000000" } } },
      { theme: { colors: { text: ` #000000` } } },
      { theme: { radius: "8px" } },
      { theme: { radius: "8" } },
      { theme: { radius: 1e9 } },
      { theme: { font: "serif; } body { background: red" } },
      { theme: { font: "<script>alert(1)</script>" } },
      { theme: { font: ["serif"] } },
      { theme: { logoUrl: "data:image/svg+xml,<svg onload=alert(1)>" } },
      { theme: { logoUrl: "JavaScript:alert(1)" } },
      { theme: { logoUrl: "//evil.example/l.png" } },
      { theme: { logoUrl: "https://" } },
      { theme: { logoUrl: " https://example.com/l.png" } },
      { theme: { logoUrl: "https://example.com/l.png\n<script>" } },
      { theme: { logoUrl: 'https://example.com/l.png" onerror="alert(1)' } },
      { theme: { logoUrl: { href: "https://example.com/l.png" } } },
      { theme: { css: "body{}", colors: { text: "#000000" } } },
      { theme: { template: "{{name}}" } },
      { theme: { html: "<b>x</b>" } },
      { theme: { darkRadius: 25 } },
      { theme: { darkRadius: -1 } },
      { theme: { darkRadius: 1.5 } },
      { theme: { darkRadius: "8px" } },
      { theme: { darkRadius: "8" } },
      { theme: { darkRadius: null } },
      { theme: { darkRadius: 1e9 } },
      { theme: { darkFont: "Comic Sans" } },
      { theme: { darkFont: "https://fonts.example.com/f.woff" } },
      { theme: { darkFont: "serif; } body { background: red" } },
      { theme: { darkFont: ["serif"] } },
      { theme: { darkFont: null } },
      { theme: { darkColors: { primary: "red" } } },
      { theme: { darkColors: { primary: "#fff" } } },
      { theme: { darkColors: { accent: "#ffffff" } } },
      { theme: { darkColors: { text: "rgb(0,0,0)" } } },
      { theme: { darkColors: { text: "var(--x)" } } },
      { theme: { darkColors: { text: null } } },
      { theme: { darkColors: "#000000" } },
      { theme: { darkColors: ["#000000"] } },
      { theme: { darkColors: null } },
      { theme: { darkColors: { background: "#000000;}body{display:none" } } },
      { theme: { darkColors: { text: "#00000000" } } },
      { theme: { colors: { text: "#000000" }, darkColors: { radius: 4 } } },
      { theme: { darkColors: Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, "#000000"])) } },
      { theme: { colors: Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, "#000000"])) } },
      { locale: "en", maxPartySize: 500 },
    ];
    for (const body of bad) {
      const res = await put("oa", "oa-admin", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).code, JSON.stringify(body)).toBe("invalid_request");
    }
    const malformed = await app.request(url("oa"), {
      method: "PUT",
      headers: { apikey: "oa-admin", "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(malformed.status).toBe(400);
    expect(await read()).toEqual(before);
  });

  it("accepts the upper bounds and ignores bookingKey in the body", async () => {
    const res = await put("oa", "oa-admin", {
      minPartySize: 100,
      maxPartySize: 100,
      leadTimeMinutes: 10080,
      selfServiceCutoffMinutes: 0,
      maxAdvanceDays: 1000,
      maxOpenBookingsPerContact: 20,
      theme: { radius: 24 },
      bookingKey: "pk_AAAAAAAAAAAAAAAAAAAAAA",
    });
    expect(res.status).toBe(200);
    expect((await res.json()).bookingKey).toBeNull();
    await put("oa", "oa-admin", {
      minPartySize: 1,
      maxPartySize: 8,
      leadTimeMinutes: 0,
      selfServiceCutoffMinutes: 120,
      maxAdvanceDays: null,
      maxOpenBookingsPerContact: 2,
      theme: null,
    });
  });

  it("warns without refusing when the text contrast is below 4.5:1", async () => {
    const res = await put("oa", "oa-admin", { theme: { colors: { text: "#777777", background: "#888888" } } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toMatchObject({ code: "low_contrast" });
    expect(body.warnings[0].ratio).toBeLessThan(4.5);
    expect((await read()).theme.colors.text).toBe("#777777");
    const ok = await put("oa", "oa-admin", { theme: { colors: { text: "#000000", background: "#ffffff" } } });
    expect((await ok.json()).warnings).toEqual([]);
    await put("oa", "oa-admin", { theme: null });
  });

  it("saves a dark palette, lower-cases it and reads it back", async () => {
    const res = await put("oa", "oa-admin", {
      theme: { colors: { primary: "#AA0000" }, darkColors: { background: "#101010", text: "#F0F0F0", primary: "#FF8877" } },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.theme).toEqual({
      colors: { primary: "#aa0000" },
      darkColors: { background: "#101010", text: "#f0f0f0", primary: "#ff8877" },
    });
    expect(body.warnings).toEqual([]);
    expect((await read()).theme).toEqual(body.theme);
    const empty = await (await put("oa", "oa-admin", { theme: { darkColors: {} } })).json();
    expect(empty.theme).toEqual({ darkColors: {} });
    expect(empty.warnings).toEqual([]);
    expect((await (await put("oa", "oa-admin", { theme: { radius: 4 } })).json()).theme).toEqual({ radius: 4 });
    await put("oa", "oa-admin", { theme: null });
  });

  it("saves a dark radius and a dark font on their own and reads them back", async () => {
    const res = await put("oa", "oa-admin", { theme: { radius: 4, font: "serif", darkRadius: 16, darkFont: "rounded" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.theme).toEqual({ radius: 4, font: "serif", darkRadius: 16, darkFont: "rounded" });
    expect(body.warnings).toEqual([]);
    expect((await read()).theme).toEqual(body.theme);
    const alone = await (await put("oa", "oa-admin", { theme: { darkRadius: 0 } })).json();
    expect(alone.theme).toEqual({ darkRadius: 0 });
    expect((await (await put("oa", "oa-admin", { theme: { darkFont: "serif" } })).json()).theme).toEqual({ darkFont: "serif" });
    await put("oa", "oa-admin", { theme: null });
  });

  it("warns about the dark pair on its own, against the widget's dark built-in colors", async () => {
    const light = await (await put("oa", "oa-admin", { theme: { colors: { background: "#222222" } } })).json();
    expect(light.warnings).toEqual([expect.objectContaining({ code: "low_contrast", palette: "light" })]);
    const bright = await (await put("oa", "oa-admin", { theme: { darkColors: { background: "#eeeeee" } } })).json();
    expect(bright.warnings).toEqual([expect.objectContaining({ code: "low_contrast", palette: "dark" })]);
    expect(bright.warnings[0].message).toMatch(/^The dark text color/);
    const dim = await (await put("oa", "oa-admin", { theme: { darkColors: { text: "#555555" } } })).json();
    expect(dim.warnings).toEqual([expect.objectContaining({ palette: "dark" })]);
    const both = await (
      await put("oa", "oa-admin", {
        theme: { colors: { text: "#777777", background: "#888888" }, darkColors: { text: "#555555" } },
      })
    ).json();
    expect(both.warnings.map((w: { palette: string }) => w.palette)).toEqual(["light", "dark"]);
    const fine = await (
      await put("oa", "oa-admin", { theme: { darkColors: { text: "#ffffff", background: "#000000" } } })
    ).json();
    expect(fine.warnings).toEqual([]);
    await put("oa", "oa-admin", { theme: null });
  });

  it("checks a color the theme leaves out against the widget's built-in one", async () => {
    const dark = await put("oa", "oa-admin", { theme: { colors: { background: "#222222" } } });
    expect(dark.status).toBe(200);
    expect((await dark.json()).warnings).toEqual([expect.objectContaining({ code: "low_contrast" })]);
    const pale = await (await put("oa", "oa-admin", { theme: { colors: { text: "#eeeeee" } } })).json();
    expect(pale.warnings).toEqual([expect.objectContaining({ code: "low_contrast" })]);
    expect(pale.theme).toEqual({ colors: { text: "#eeeeee" } });
    const edge = await (await put("oa", "oa-admin", { theme: { colors: { text: "#767676" } } })).json();
    expect(edge.warnings).toEqual([]);
    const below = await (await put("oa", "oa-admin", { theme: { colors: { text: "#777777" } } })).json();
    expect(below.warnings[0].ratio).toBe(4.48);
    expect((await (await put("oa", "oa-admin", { theme: { radius: 4 } })).json()).warnings).toEqual([]);
    expect((await (await put("oa", "oa-admin", { theme: null })).json()).warnings).toEqual([]);
  });

  it("keeps the built-in contrast colors equal to the widget's stylesheet", () => {
    const css = readFileSync(path.resolve(import.meta.dirname, "../../widget/src/styles.css"), "utf8");
    expect(css).toContain(`--oc-text: ${DEFAULT_TEXT};`);
    expect(css).toContain(`--oc-background: ${DEFAULT_BACKGROUND};`);
    expect(css).toContain(`--oc-text: ${DEFAULT_DARK_TEXT};`);
    expect(css).toContain(`--oc-background: ${DEFAULT_DARK_BACKGROUND};`);
  });
});

describe("enabling and the booking key", () => {
  it("is blocked without a venue name, without services, or without a bookable service", async () => {
    for (const [venue, body] of [
      ["oc", { enabled: true }],
      ["od", { enabled: true }],
      ["oa", { enabled: true, weekdays: [7] }],
      ["oa", { enabled: true, services: ["dinner"], weekdays: [1, 2] }],
    ] as const) {
      const res = await put(venue, "oa-admin", body);
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect((await res.json()).code).toBe("online_booking_incomplete");
    }
    const after = await read("oa");
    expect(after.enabled).toBe(false);
    expect(after.bookingKey).toBeNull();
    expect((await read("oc")).enabled).toBe(false);
    expect((await read("oc")).bookingKey).toBeNull();
  });

  it("does not store the other fields of a refused enable", async () => {
    await put("oa", "oa-admin", { enabled: true, weekdays: [7], leadTimeMinutes: 500 });
    expect((await read()).leadTimeMinutes).toBe(0);
  });

  it("creates the key on the first enable, keeps it across off and on, and never shares it", async () => {
    const on = await put("oa", "oa-admin", { enabled: true, services: ["dinner"], weekdays: [5] });
    expect(on.status).toBe(200);
    const key = (await on.json()).bookingKey;
    expect(key).toMatch(KEY);
    const off = await put("oa", "oa-admin", { enabled: false });
    expect((await off.json()).bookingKey).toBe(key);
    const again = await put("oa", "oa-admin", { enabled: true });
    expect((await again.json()).bookingKey).toBe(key);
    const other = await put("ob", "ob-admin", { enabled: true });
    const otherKey = (await other.json()).bookingKey;
    expect(otherKey).toMatch(KEY);
    expect(otherKey).not.toBe(key);
  });

  it("a settings change on an enabled venue that leaves nothing bookable is refused", async () => {
    const res = await put("oa", "oa-admin", { weekdays: [1, 2] });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("online_booking_incomplete");
    expect((await read()).weekdays).toEqual([5]);
  });

  it("the database refuses a duplicate key, a malformed key and a non-auto mode", async () => {
    const a = await read("oa");
    await expect(
      db.update(venueOnlineBooking).set({ bookingKey: a.bookingKey }).where(eq(venueOnlineBooking.venueId, "ob")),
    ).rejects.toThrow();
    await expect(
      db.update(venueOnlineBooking).set({ bookingKey: "pk_short" }).where(eq(venueOnlineBooking.venueId, "ob")),
    ).rejects.toThrow();
    await expect(
      db.update(venueOnlineBooking).set({ confirmationMode: "approval" }).where(eq(venueOnlineBooking.venueId, "ob")),
    ).rejects.toThrow();
  });
});

describe("key rotation", () => {
  it("returns a new key and the old one no longer is the venue's", async () => {
    const before = (await read()).bookingKey;
    const res = await rotate("oa", "oa-admin");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bookingKey).toMatch(KEY);
    expect(body.bookingKey).not.toBe(before);
    expect(body.enabled).toBe(true);
    expect((await read()).bookingKey).toBe(body.bookingKey);
    const rows = await db.select().from(venueOnlineBooking).where(eq(venueOnlineBooking.bookingKey, before));
    expect(rows).toHaveLength(0);
    const second = await (await rotate("oa", "oa-admin")).json();
    expect(second.bookingKey).not.toBe(body.bookingKey);
    expect(Object.keys(second).sort()).toEqual(Object.keys(await read()).sort());
  });

  it("works while online booking is off and keeps it off", async () => {
    await put("oa", "oa-admin", { enabled: false });
    const body = await (await rotate("oa", "oa-admin")).json();
    expect(body.enabled).toBe(false);
    expect(body.bookingKey).toMatch(KEY);
  });

  it("gives a venue that never had a key its first one, leaving it off", async () => {
    expect((await read("od")).bookingKey).toBeNull();
    const body = await (await rotate("od", "oa-admin")).json();
    expect(body.bookingKey).toMatch(KEY);
    expect(body.enabled).toBe(false);
    expect((await read("od")).bookingKey).toBe(body.bookingKey);
  });

  it("takes no Idempotency-Key: a repeated call rotates again", async () => {
    const h = { apikey: "oa-admin", "Idempotency-Key": "same" };
    const a = await (await app.request(`${url("oa")}/rotate-key`, { method: "POST", headers: h })).json();
    const b = await (await app.request(`${url("oa")}/rotate-key`, { method: "POST", headers: h })).json();
    expect(a.bookingKey).not.toBe(b.bookingKey);
  });

  it("rotation keeps every other setting", async () => {
    await put("oa", "oa-admin", { locale: "en", askConsent: true });
    const before = await read();
    const after = await (await rotate("oa", "oa-admin")).json();
    expect({ ...after, bookingKey: null }).toEqual({ ...before, bookingKey: null });
  });
});

describe("access", () => {
  it("refuses a write or read key on both writes, and nothing changes", async () => {
    const before = await read();
    for (const key of ["oa-write", "oa-read"]) {
      const p = await put("oa", key, { locale: "en", enabled: false });
      expect(p.status).toBe(403);
      expect((await p.json()).code).toBe("forbidden");
      const r = await rotate("oa", key);
      expect(r.status).toBe(403);
      expect((await r.json()).code).toBe("forbidden");
    }
    expect(await read()).toEqual(before);
  });

  it("answers venue_not_found for a venue the caller does not hold, on every route", async () => {
    for (const res of [
      await get("ob", "oa-admin"),
      await put("ob", "oa-admin", { locale: "en" }),
      await rotate("ob", "oa-admin"),
      await get("no-such-venue", "oa-admin"),
    ]) {
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("venue_not_found");
    }
    expect((await read("ob", "ob-admin")).locale).toBe("es");
  });

  it("refuses a missing or unknown key", async () => {
    expect((await app.request(url("oa"))).status).toBe(401);
    expect((await get("oa", "bogus")).status).toBe(401);
    expect((await app.request(url("oa"), { method: "PUT", body: "{}" })).status).toBe(401);
  });

  it("isolates venues: a change in one does not touch another", async () => {
    const b = await read("ob", "ob-admin");
    await put("oa", "oa-admin", { locale: "en", maxPartySize: 12 });
    expect(await read("ob", "ob-admin")).toEqual(b);
  });

  it("leaks no secret of the venue", async () => {
    const all = JSON.stringify([await read(), await (await rotate("oa", "oa-admin")).json()]);
    for (const s of ["re_secret_key", "owner@example.com", "oa-admin"]) expect(all).not.toContain(s);
  });

  it("deleting a venue's settings row cascades with the venue", async () => {
    await db.insert(venues).values({ id: "oz", name: "Temp" });
    await rotate("oz", "oa-admin").catch(() => undefined);
    await addKey(db, "oz-admin", "a", ["oz"], "admin");
    await rotate("oz", "oz-admin");
    await db.delete(venues).where(eq(venues.id, "oz"));
    expect(await db.select().from(venueOnlineBooking).where(eq(venueOnlineBooking.venueId, "oz"))).toHaveLength(0);
  });
});
