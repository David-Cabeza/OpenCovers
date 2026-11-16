import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";

const FULL = {
  street: "Calle Mayor 1",
  locality: "Madrid",
  postalCode: "28013",
  region: "Madrid",
  country: "ES",
  phone: "+34 910 000 000",
  websiteUrl: "https://example.com/",
  bookingUrl: "https://example.com/reservas",
  cuisine: "Spanish",
  priceRange: "$$",
  latitude: 40.4168,
  longitude: -3.7038,
};

beforeAll(async () => {
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE events, tombstones, idempotency_keys, table_allocations, reservations, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
  for (const id of ["pa", "pb"]) {
    await db.insert(venues).values({
      id,
      name: id === "pa" ? "Casa Alba" : "Other Place",
      timezone: "Europe/Madrid",
      noticeAddress: "secret-owner@example.com",
      fromEmail: "from-secret@example.com",
      resendApiKey: "re_secret_key",
    });
  }
  await db.insert(services).values([
    { venueId: "pa", name: "lunch", openStart: "13:00", openEnd: "16:00" },
    { venueId: "pa", name: "dinner", openStart: "20:00", openEnd: "23:30" },
    { venueId: "pb", name: "brunch", openStart: "09:00", openEnd: "11:00" },
  ]);
  await addKey(db, "pa-admin", "admin", ["pa"], "admin");
  await addKey(db, "pa-write", "writer", ["pa"], "write");
  await addKey(db, "pb-admin", "admin-b", ["pb"], "admin");
});

function put(venue: string, key: string, body: unknown) {
  return app.request(`/v1/venues/${venue}/public-profile`, {
    method: "PUT",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const publicGet = (venue: string, headers: Record<string, string> = {}) =>
  app.request(`/v1/venues/${venue}/public.jsonld`, { headers });

describe("public profile and JSON-LD", () => {
  it("is off by default and does not leak existence", async () => {
    const off = await publicGet("pa");
    const unknown = await publicGet("no-such-venue");
    expect(off.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await off.text()).toBe(await unknown.text());
    expect(off.headers.get("cache-control")).toBe(unknown.headers.get("cache-control"));
  });

  it("round-trips the fields", async () => {
    const res = await put("pa", "pa-admin", FULL);
    expect(res.status).toBe(200);
    const got = await app.request("/v1/venues/pa/public-profile", { headers: { apikey: "pa-write" } });
    expect(got.status).toBe(200);
    const body = await got.json();
    expect(body).toMatchObject({ ...FULL, websiteUrl: "https://example.com/", publicProfileEnabled: false });
  });

  it("partial update keeps the other fields and null clears", async () => {
    await put("pa", "pa-admin", { cuisine: null, priceRange: "$$$" });
    const body = await (
      await app.request("/v1/venues/pa/public-profile", { headers: { apikey: "pa-admin" } })
    ).json();
    expect(body.cuisine).toBeNull();
    expect(body.priceRange).toBe("$$$");
    expect(body.street).toBe(FULL.street);
    await put("pa", "pa-admin", { cuisine: FULL.cuisine, priceRange: FULL.priceRange });
  });

  it("rejects invalid input", async () => {
    const bad: unknown[] = [
      { websiteUrl: "http://example.com" },
      { bookingUrl: "ftp://example.com" },
      { websiteUrl: "https://user:pw@example.com" },
      { websiteUrl: "not a url" },
      { country: "ZZ" },
      { country: "es" },
      { country: "ESP" },
      { street: "x".repeat(201) },
      { locality: "x".repeat(101) },
      { cuisine: "x".repeat(101) },
      { phone: "call me" },
      { priceRange: "cheap" },
      { latitude: 91, longitude: 0 },
      { longitude: 181, latitude: 0 },
      { publicProfileEnabled: "yes" },
    ];
    for (const body of bad) {
      const res = await put("pa", "pa-admin", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).code).toBe("invalid_request");
    }
    const lonly = await put("pa", "pa-admin", { latitude: null, longitude: 5 });
    expect(lonly.status).toBe(409);
    expect((await lonly.json()).code).toBe("public_profile_incomplete");
    await put("pa", "pa-admin", { latitude: FULL.latitude, longitude: FULL.longitude });
  });

  it("refuses to enable an incomplete profile", async () => {
    const res = await put("pb", "pb-admin", { publicProfileEnabled: true });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("public_profile_incomplete");
    expect((await publicGet("pb")).status).toBe(404);
  });

  it("only an admin writes", async () => {
    expect((await put("pa", "pa-write", { cuisine: "x" })).status).toBe(403);
    expect(
      (await app.request("/v1/venues/pa/public-profile", { method: "PUT", body: "{}" })).status,
    ).toBe(401);
    expect((await put("pa", "pb-admin", { cuisine: "x" })).status).toBe(404);
  });

  it("serves JSON-LD without credentials once enabled", async () => {
    const on = await put("pa", "pa-admin", { publicProfileEnabled: true });
    expect(on.status).toBe(200);
    const res = await publicGet("pa");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/ld+json");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const doc = JSON.parse(await res.text());
    expect(doc["@context"]).toBe("https://schema.org");
    expect(doc["@type"]).toBe("Restaurant");
    expect(doc.name).toBe("Casa Alba");
    expect(doc.address).toEqual({
      "@type": "PostalAddress",
      streetAddress: "Calle Mayor 1",
      addressLocality: "Madrid",
      postalCode: "28013",
      addressRegion: "Madrid",
      addressCountry: "ES",
    });
    expect(doc.telephone).toBe(FULL.phone);
    expect(doc.url).toBe("https://example.com/");
    expect(doc.servesCuisine).toBe("Spanish");
    expect(doc.priceRange).toBe("$$");
    expect(doc.geo).toEqual({ "@type": "GeoCoordinates", latitude: 40.4168, longitude: -3.7038 });
    expect(doc.openingHoursSpecification).toHaveLength(2);
    expect(doc.openingHoursSpecification[0]).toMatchObject({
      "@type": "OpeningHoursSpecification",
      opens: "13:00",
      closes: "16:00",
    });
    expect(doc.openingHoursSpecification[0].dayOfWeek).toHaveLength(7);
    expect(doc.openingHoursSpecification[1]).toMatchObject({ opens: "20:00", closes: "23:30" });
    expect(doc.potentialAction["@type"]).toBe("ReserveAction");
    expect(doc.potentialAction.target.urlTemplate).toBe("https://example.com/reservas");
  });

  it("omits ReserveAction without a booking URL", async () => {
    await put("pa", "pa-admin", { bookingUrl: null });
    const doc = await (await publicGet("pa")).json();
    expect(doc.potentialAction).toBeUndefined();
    await put("pa", "pa-admin", { bookingUrl: FULL.bookingUrl });
  });

  it("leaks nothing private and keeps venues apart", async () => {
    const text = await (await publicGet("pa")).text();
    for (const secret of [
      "secret-owner",
      "from-secret",
      "re_secret_key",
      "pa-admin",
      "noticeAddress",
      "apikey",
      "Other Place",
      "brunch",
      "09:00",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("answers a conditional request with 304", async () => {
    const first = await publicGet("pa");
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    const again = await publicGet("pa", { "If-None-Match": etag as string });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect(again.headers.get("etag")).toBe(etag);
    await put("pa", "pa-admin", { cuisine: "Tapas" });
    const changed = await publicGet("pa", { "If-None-Match": etag as string });
    expect(changed.status).toBe(200);
  });

  it("answers the CORS preflight and turns off again", async () => {
    const pre = await app.request("/v1/venues/pa/public.jsonld", { method: "OPTIONS" });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("*");
    await put("pa", "pa-admin", { publicProfileEnabled: false });
    expect((await publicGet("pa")).status).toBe(404);
  });
});
