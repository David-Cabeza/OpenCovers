import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, venueOnlineBooking, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { auth } from "../src/lib/auth";
import { addMembership } from "../src/lib/memberships";
import { publicAddress } from "../src/lib/public-booking";

// C64: the public address and the privacy notice URL.

const NOTICE = "owner-notice@example.com";
const URL_A = "https://casa-a.example.com/privacidad?lang=es";
const PROFILE = {
  publicStreet: "Calle Mayor 1",
  publicPostalCode: "28013",
  publicLocality: "Madrid",
  publicRegion: "Comunidad de Madrid",
  publicCountry: "ES",
  publicLatitude: 40.4168,
  publicLongitude: -3.7038,
};

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE events, tombstones, idempotency_keys, table_allocations, reservations, guests, grants, api_keys, services, tables, venue_online_booking, venues RESTART IDENTITY CASCADE`,
  );
});

interface Venue {
  id: string;
  admin: string;
  writer: string;
  reader: string;
  key: string;
}

let count = 0;
async function makeVenue(venue: Partial<typeof venues.$inferInsert> = {}, settings: Record<string, unknown> = {}): Promise<Venue> {
  count += 1;
  const id = `pan-${count}`;
  await db.insert(venues).values({ id, name: `Casa ${count}`, timezone: "Europe/Madrid", noticeAddress: NOTICE, ...venue });
  await db.insert(services).values({ venueId: id, name: "dinner", openStart: "20:00", openEnd: "23:00" });
  const v = { id, admin: `${id}-admin`, writer: `${id}-writer`, reader: `${id}-reader` };
  await addKey(db, v.admin, `admin-${id}`, [id], "admin");
  await addKey(db, v.writer, `writer-${id}`, [id], "write");
  await addKey(db, v.reader, `reader-${id}`, [id], "read");
  const res = await put(id, v.admin, { enabled: true, ...settings });
  if (res.status !== 200) throw new Error(`enable failed: ${await res.text()}`);
  return { ...v, key: (await res.json()).bookingKey };
}

const path = (venue: string) => `/v1/venues/${venue}/online-booking`;
const get = (venue: string, key: string) => app.request(path(venue), { headers: { apikey: key } });
const put = (venue: string, key: string, body: unknown) =>
  app.request(path(venue), {
    method: "PUT",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const stored = async (v: Venue) => (await (await get(v.id, v.admin)).json()).privacyNoticeUrl;
const config = async (key: string) => (await app.request(`/v1/public/${key}`)).json();

describe("C64 public address", () => {
  it("is null while the public profile is off, whatever the profile holds", async () => {
    const v = await makeVenue({ ...PROFILE, publicProfileEnabled: false });
    const answer = await config(v.key);
    expect(answer.venue.address).toBeNull();
    expect(JSON.stringify(answer)).not.toContain("Calle Mayor");
  });

  it("is one line of street, postal code and locality while the profile is on", async () => {
    const v = await makeVenue({ ...PROFILE, publicProfileEnabled: true });
    const answer = await config(v.key);
    expect(answer.venue.address).toBe("Calle Mayor 1, 28013 Madrid");
    const text = JSON.stringify(answer);
    for (const leak of ["Comunidad de Madrid", "40.4168", "-3.7038", NOTICE, v.id]) expect(text).not.toContain(leak);
  });

  it("leaves out an unset part and is null without a street", async () => {
    const cases: [Partial<typeof venues.$inferInsert>, string | null][] = [
      [{ publicStreet: "Calle Mayor 1" }, "Calle Mayor 1"],
      [{ publicStreet: "Calle Mayor 1", publicPostalCode: "28013" }, "Calle Mayor 1, 28013"],
      [{ publicStreet: "Calle Mayor 1", publicLocality: "Madrid" }, "Calle Mayor 1, Madrid"],
      [{ publicStreet: "  Calle Mayor 1 ", publicPostalCode: " ", publicLocality: "Madrid " }, "Calle Mayor 1, Madrid"],
      [{ publicPostalCode: "28013", publicLocality: "Madrid" }, null],
      [{ publicStreet: "   ", publicLocality: "Madrid" }, null],
      [{}, null],
    ];
    for (const [profile, expected] of cases) {
      const v = await makeVenue({ ...profile, publicProfileEnabled: true });
      expect((await config(v.key)).venue.address, JSON.stringify(profile)).toBe(expected);
    }
    expect(publicAddress({ publicProfileEnabled: true, publicStreet: "A", publicPostalCode: null, publicLocality: null } as never)).toBe("A");
  });

  it("follows the profile on the next request", async () => {
    const v = await makeVenue({ ...PROFILE, publicProfileEnabled: true });
    expect((await config(v.key)).venue.address).toBe("Calle Mayor 1, 28013 Madrid");
    await db.update(venues).set({ publicProfileEnabled: false }).where(eq(venues.id, v.id));
    expect((await config(v.key)).venue.address).toBeNull();
    await db.update(venues).set({ publicProfileEnabled: true, publicStreet: "Plaza Nueva 2" }).where(eq(venues.id, v.id));
    expect((await config(v.key)).venue.address).toBe("Plaza Nueva 2, 28013 Madrid");
  });

  it("never shows noticeAddress, with the profile on or off", async () => {
    for (const enabled of [true, false]) {
      const v = await makeVenue({ ...PROFILE, publicProfileEnabled: enabled, noticeAddress: "Secret Street 9, Nowhere" });
      expect(JSON.stringify(await config(v.key))).not.toContain("Secret Street");
    }
  });

  it("keeps each venue's address apart", async () => {
    const a = await makeVenue({ ...PROFILE, publicProfileEnabled: true });
    const b = await makeVenue({ publicStreet: "Calle B 2", publicLocality: "Sevilla", publicProfileEnabled: true });
    const c = await makeVenue({ publicStreet: "Calle C 3", publicProfileEnabled: false });
    expect((await config(a.key)).venue.address).toBe("Calle Mayor 1, 28013 Madrid");
    expect((await config(b.key)).venue.address).toBe("Calle B 2, Sevilla");
    expect((await config(c.key)).venue.address).toBeNull();
    expect(JSON.stringify(await config(a.key))).not.toContain("Sevilla");
  });
});

describe("C64 privacy notice URL setting", () => {
  it("reads null for a venue that never set it, and the public config returns null", async () => {
    const v = await makeVenue();
    expect(await stored(v)).toBeNull();
    expect((await config(v.key)).privacyNoticeUrl).toBeNull();
    const bare = await db.insert(venues).values({ id: "pan-bare", name: "Bare" }).returning();
    await addKey(db, "pan-bare-admin", "a", [bare[0]!.id], "admin");
    expect((await (await get("pan-bare", "pan-bare-admin")).json()).privacyNoticeUrl).toBeNull();
  });

  it("stores an https URL as sent, and GET and the public config read it back", async () => {
    const v = await makeVenue();
    const res = await put(v.id, v.admin, { privacyNoticeUrl: URL_A });
    expect(res.status).toBe(200);
    expect((await res.json()).privacyNoticeUrl).toBe(URL_A);
    expect(await stored(v)).toBe(URL_A);
    const answer = await config(v.key);
    expect(answer.privacyNoticeUrl).toBe(URL_A);
    expect(answer.minPartySize).toBe(1);
    const max = "https://example.com/" + "a".repeat(2048 - "https://example.com/".length);
    expect(max).toHaveLength(2048);
    expect((await put(v.id, v.admin, { privacyNoticeUrl: max })).status).toBe(200);
    expect(await stored(v)).toBe(max);
  });

  it("accepts the scheme in any case and stores it as sent", async () => {
    const v = await makeVenue();
    expect((await put(v.id, v.admin, { privacyNoticeUrl: "HTTPS://Example.com/Privacy" })).status).toBe(200);
    expect(await stored(v)).toBe("HTTPS://Example.com/Privacy");
  });

  it("null clears it, and a PUT without the field keeps it", async () => {
    const v = await makeVenue({}, { privacyNoticeUrl: URL_A });
    expect(await stored(v)).toBe(URL_A);
    expect((await put(v.id, v.admin, { locale: "en" })).status).toBe(200);
    expect(await stored(v)).toBe(URL_A);
    const cleared = await put(v.id, v.admin, { privacyNoticeUrl: null });
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).privacyNoticeUrl).toBeNull();
    expect(await stored(v)).toBeNull();
    expect((await config(v.key)).privacyNoticeUrl).toBeNull();
  });

  it("rejects every bad value with invalid_request and changes nothing", async () => {
    const v = await makeVenue({}, { privacyNoticeUrl: URL_A });
    const before = await (await get(v.id, v.admin)).json();
    const bad: unknown[] = [
      "http://example.com/privacy",
      "HTTP://example.com/privacy",
      "javascript:alert(1)",
      "data:text/html,hi",
      "ftp://example.com/p",
      "example.com/privacy",
      "//example.com/privacy",
      "/privacy",
      "",
      "https://",
      "https:///privacy",
      "https:/example.com/privacy",
      "https:example.com/privacy",
      "https://user:pass@example.com/",
      "https://user@example.com/",
      "https://:@example.com/",
      "https://example.com/a b",
      " https://example.com/",
      "https://example.com/ ",
      "https://example.com/\n",
      "https://example.com/\t",
      "https://example.com/\u0000",
      "https://example.com/\u007f",
      "https://example.com/ x",
      `https://example.com/${"a".repeat(2049 - "https://example.com/".length)}`,
      123,
      true,
      false,
      {},
      [],
      ["https://example.com/"],
    ];
    for (const value of bad) {
      const res = await put(v.id, v.admin, { privacyNoticeUrl: value, locale: "en" });
      expect(res.status, JSON.stringify(value)).toBe(400);
      expect((await res.json()).code, JSON.stringify(value)).toBe("invalid_request");
    }
    expect(await (await get(v.id, v.admin)).json()).toEqual(before);
  });

  it("is refused to read and write keys, which leaves the value unchanged", async () => {
    const v = await makeVenue({}, { privacyNoticeUrl: URL_A });
    for (const key of [v.writer, v.reader]) {
      const res = await put(v.id, key, { privacyNoticeUrl: "https://evil.example.com/" });
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("forbidden");
      const clear = await put(v.id, key, { privacyNoticeUrl: null });
      expect((await clear.json()).code).toBe("forbidden");
    }
    expect(await stored(v)).toBe(URL_A);
  });

  it("is refused to a read or write session, and an admin session saves it", async () => {
    const v = await makeVenue({}, { privacyNoticeUrl: URL_A });
    const sessions: [string, "read" | "write" | "admin"][] = [["read", "read"], ["write", "write"], ["admin", "admin"]];
    for (const [name, role] of sessions) {
      const res = await auth.api.signUpEmail({
        body: { name, email: `pan-${name}-${v.id}@example.com`, password: "password123" },
        asResponse: true,
      });
      const cookie = res.headers.get("set-cookie") as string;
      await addMembership(db, (await res.json()).user.id, v.id, role);
      const write = await app.request(path(v.id), {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ privacyNoticeUrl: `https://${name}.example.com/privacy` }),
      });
      if (role === "admin") expect(write.status).toBe(200);
      else {
        expect(write.status).toBe(403);
        expect((await write.json()).code).toBe("forbidden");
        expect(await stored(v)).toBe(URL_A);
      }
    }
    expect(await stored(v)).toBe("https://admin.example.com/privacy");
  });

  it("answers venue_not_found for a caller outside the venue", async () => {
    const a = await makeVenue();
    const b = await makeVenue({}, { privacyNoticeUrl: URL_A });
    const res = await put(b.id, a.admin, { privacyNoticeUrl: "https://evil.example.com/" });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("venue_not_found");
    expect((await (await get(b.id, a.admin)).json()).code).toBe("venue_not_found");
    expect(await stored(b)).toBe(URL_A);
  });

  it("keeps each venue's URL apart, in the settings and in the public config", async () => {
    const a = await makeVenue({}, { privacyNoticeUrl: URL_A });
    const b = await makeVenue({}, { privacyNoticeUrl: "https://casa-b.example.com/privacy" });
    const c = await makeVenue();
    expect((await config(a.key)).privacyNoticeUrl).toBe(URL_A);
    expect((await config(b.key)).privacyNoticeUrl).toBe("https://casa-b.example.com/privacy");
    expect((await config(c.key)).privacyNoticeUrl).toBeNull();
    expect(JSON.stringify(await config(a.key))).not.toContain("casa-b");
    await put(a.id, a.admin, { privacyNoticeUrl: null });
    expect(await stored(b)).toBe("https://casa-b.example.com/privacy");
  });

  it("is guarded by the database too", async () => {
    const v = await makeVenue();
    const write = (value: string) =>
      db.update(venueOnlineBooking).set({ privacyNoticeUrl: value }).where(eq(venueOnlineBooking.venueId, v.id));
    for (const bad of ["http://example.com/", "https://", "https://example.com/a b", "https://example.com/\n", `https://e.com/${"a".repeat(2048)}`]) {
      await expect(write(bad), bad.slice(0, 40)).rejects.toThrow();
    }
    await write("HTTPS://example.com/ok");
    expect(await stored(v)).toBe("HTTPS://example.com/ok");
  });

  it("adds only address and privacyNoticeUrl to the public answers, which still hold no secret", async () => {
    const v = await makeVenue({ ...PROFILE, publicProfileEnabled: true, publicPhone: "+34 600 123 456", resendApiKey: "re_secret_key" }, { privacyNoticeUrl: URL_A });
    const answer = await config(v.key);
    expect(Object.keys(answer).sort()).toEqual(
      ["askConsent", "captcha", "challenge", "confirmationMode", "leadTimeMinutes", "linkResend", "maxAdvanceDays", "maxPartySize", "minPartySize", "privacyNoticeUrl", "venue", "weekdays"],
    );
    expect(Object.keys(answer.venue).sort()).toEqual(["address", "locale", "name", "phone", "theme"]);
    const text = JSON.stringify(answer);
    for (const leak of [v.id, NOTICE, "re_secret_key", v.admin, "dinner", "bookedVia", "ownerPrincipal", "basis"]) expect(text).not.toContain(leak);
    const other = await makeVenue();
    expect(text).not.toContain(other.key);
  });
});
