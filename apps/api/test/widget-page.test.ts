import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { auth } from "../src/lib/auth";
import { widgetServingFromEnv, servesWidgetOn } from "../src/lib/widget-page";

const POLICY =
  "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' https: data:; " +
  "style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'; object-src 'none'";

function fakeWidgetBuild(): string {
  const dist = mkdtempSync(path.join(tmpdir(), "oc-widget-"));
  mkdirSync(path.join(dist, ".vite"));
  mkdirSync(path.join(dist, "assets"));
  writeFileSync(
    path.join(dist, ".vite", "manifest.json"),
    JSON.stringify({ "src/main.tsx": { file: "assets/main-AbC123.js", css: ["assets/main-XyZ789.css"], isEntry: true } }),
  );
  writeFileSync(path.join(dist, "assets", "main-AbC123.js"), "console.log('widget')");
  writeFileSync(path.join(dist, "assets", "main-XyZ789.css"), "body{}");
  writeFileSync(path.join(dist, "secret.txt"), "outside the assets folder");
  return dist;
}

beforeAll(async () => {
  process.env.WIDGET_DIST = fakeWidgetBuild();
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE events, idempotency_keys, table_allocations, reservations, guests, grants, api_keys, services, tables, venue_online_booking, venues RESTART IDENTITY CASCADE`,
  );
});

interface Venue {
  id: string;
  admin: string;
  key: string;
}

let venueCount = 0;
async function makeVenue(settings: Record<string, unknown> = {}, name?: string): Promise<Venue> {
  venueCount += 1;
  const id = `wpage-${venueCount}`;
  const admin = `${id}-admin`;
  await db.insert(venues).values({ id, name: name ?? `Casa ${venueCount}`, timezone: "Europe/Madrid" });
  await db.insert(services).values({ venueId: id, name: "dinner", openStart: "20:00", openEnd: "23:00" });
  await db.insert(tables).values({ id: `${id}-t0`, venueId: id, name: "T0", seats: 4 });
  await addKey(db, admin, `admin-${id}`, [id], "admin");
  const res = await putSettings({ id, admin, key: "" }, { enabled: true, ...settings });
  return { id, admin, key: (await res.json()).bookingKey };
}

function putSettings(v: Venue, settings: Record<string, unknown>) {
  return app.request(`/v1/venues/${v.id}/online-booking`, {
    method: "PUT",
    headers: { apikey: v.admin, "content-type": "application/json" },
    body: JSON.stringify(settings),
  });
}

const page = (bookingKey: string, init: RequestInit = {}) => app.request(`/w/${bookingKey}`, init);
const headersOf = (res: Response) => Object.fromEntries(res.headers.entries());

describe("GET /w/{bookingKey} (C41)", () => {
  it("returns the HTML shell with the venue's framing policy and no X-Frame-Options", async () => {
    const v = await makeVenue();
    const res = await page(v.key);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toBe(`${POLICY}; frame-ancestors 'none'`);
    expect(res.headers.get("x-frame-options")).toBeNull();
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const html = await res.text();
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('<script type="module" src="/w/assets/main-AbC123.js"></script>');
    expect(html).toContain('<link rel="stylesheet" href="/w/assets/main-XyZ789.css">');
    expect(html).not.toMatch(/ld\+json|<script>|<script (?!type="module" src=)/);
    expect(html).not.toContain(v.id);
  });

  it("lists exactly the venue's allowed origins after 'self', from the next request on, per venue", async () => {
    const a = await makeVenue({ allowedOrigins: ["https://casa-a.example", "https://shop.example:8443"] });
    const b = await makeVenue({ allowedOrigins: ["https://casa-b.example"] });
    expect((await page(a.key)).headers.get("content-security-policy")).toBe(
      `${POLICY}; frame-ancestors 'self' https://casa-a.example https://shop.example:8443`,
    );
    expect((await page(b.key)).headers.get("content-security-policy")).toBe(
      `${POLICY}; frame-ancestors 'self' https://casa-b.example`,
    );
    expect((await putSettings(a, { allowedOrigins: ["https://new.example"] })).status).toBe(200);
    expect((await page(a.key)).headers.get("content-security-policy")).toBe(
      `${POLICY}; frame-ancestors 'self' https://new.example`,
    );
    expect((await putSettings(a, { allowedOrigins: [] })).status).toBe(200);
    expect((await page(a.key)).headers.get("content-security-policy")).toBe(`${POLICY}; frame-ancestors 'none'`);
  });

  it("answers an unknown, malformed, rotated and disabled key with the same 404 page and headers", async () => {
    const rotated = await makeVenue({ allowedOrigins: ["https://rotated.example"] });
    const rotate = await app.request(`/v1/venues/${rotated.id}/online-booking/rotate-key`, {
      method: "POST",
      headers: { apikey: rotated.admin },
    });
    expect(rotate.status).toBe(200);
    const disabled = await makeVenue({ allowedOrigins: ["https://disabled.example"] });
    expect((await putSettings(disabled, { enabled: false })).status).toBe(200);

    const answers = await Promise.all(
      ["pk_AAAAAAAAAAAAAAAAAAAAAA", "not-a-key", rotated.key, disabled.key, `${disabled.key}?lang=en`].map((key) => page(key)),
    );
    const [first, ...rest] = await Promise.all(
      answers.map(async (res) => ({ status: res.status, headers: headersOf(res), body: await res.text() })),
    );
    expect(first.status).toBe(404);
    expect(first.headers["content-security-policy"]).toBe(`${POLICY}; frame-ancestors 'none'`);
    expect(first.headers["x-frame-options"]).toBeUndefined();
    expect(first.headers["x-robots-tag"]).toBe("noindex");
    expect(first.body).toContain('<meta name="robots" content="noindex">');
    for (const other of rest) expect(other).toEqual(first);

    expect((await page(rotated.key.replace(/.$/, "x"))).status).toBe(404);
    const fresh = (await (await app.request(`/v1/venues/${rotated.id}/online-booking`, { headers: { apikey: rotated.admin } })).json())
      .bookingKey;
    expect((await page(fresh)).status).toBe(200);
  });

  it("sets <html lang> from a supported lang query, and from the venue's locale otherwise", async () => {
    const es = await makeVenue();
    const en = await makeVenue({ locale: "en" });
    const lang = async (key: string, query = "") => /<html lang="([^"]*)">/.exec(await (await page(`${key}${query}`)).text())?.[1];
    expect(await lang(es.key)).toBe("es");
    expect(await lang(es.key, "?lang=en")).toBe("en");
    expect(await lang(es.key, "?lang=fr")).toBe("es");
    expect(await lang(es.key, '?lang="><script>')).toBe("es");
    expect(await lang(en.key)).toBe("en");
    expect(await lang(en.key, "?lang=es")).toBe("es");
  });

  it("escapes the venue name it puts in the title", async () => {
    const v = await makeVenue({}, `Bar "<script>alert(1)</script>" & Co`);
    const html = await (await page(v.key)).text();
    expect(html).toContain("<title>Bar &#34;&#60;script&#62;alert(1)&#60;/script&#62;&#34; &#38; Co</title>");
  });

  it("gives the same answer with a staff session cookie or an apikey as without", async () => {
    const v = await makeVenue({ allowedOrigins: ["https://cookie.example"] });
    const signUp = await auth.api.signUpEmail({
      body: { name: "Staff", email: `wpage-${Date.now()}@example.com`, password: "password123" },
      asResponse: true,
    });
    const cookie = signUp.headers.get("set-cookie")!.split(";")[0];
    const plain = await page(v.key);
    for (const headers of [{ cookie }, { apikey: v.admin }]) {
      const res = await page(v.key, { headers });
      expect(res.status).toBe(200);
      expect(headersOf(res)).toEqual(headersOf(plain));
      expect(await res.text()).toBe(await (await page(v.key)).text());
    }
  });

  it("answers 503, framed by no one, when the widget is not built", async () => {
    const v = await makeVenue();
    const dist = process.env.WIDGET_DIST;
    process.env.WIDGET_DIST = mkdtempSync(path.join(tmpdir(), "oc-widget-empty-"));
    try {
      const res = await page(v.key);
      expect(res.status).toBe(503);
      expect(res.headers.get("content-security-policy")).toBe(`${POLICY}; frame-ancestors 'none'`);
    } finally {
      process.env.WIDGET_DIST = dist;
    }
  });
});

describe("GET /w/assets/{file}", () => {
  it("serves a built asset with its type and a long cache", async () => {
    const res = await app.request("/w/assets/main-AbC123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe("console.log('widget')");
    expect((await app.request("/w/assets/main-XyZ789.css")).headers.get("content-type")).toBe("text/css; charset=utf-8");
  });

  it("serves nothing outside the assets folder, and nothing unknown", async () => {
    for (const name of ["..%2Fsecret.txt", "..%2F.vite%2Fmanifest.json", "missing.js", "secret.txt", ".hidden.js"]) {
      const res = await app.request(`/w/assets/${name}`);
      expect(res.status, name).toBe(404);
      expect(await res.text()).not.toContain("outside");
    }
    expect((await app.request("/w/assets/../secret.txt")).status).toBe(404);
  });
});

describe("where the widget is served (ADR-0017, Q1)", () => {
  it("serves it on any host in development, and on no host in production without WIDGET_ADDRESS", () => {
    expect(widgetServingFromEnv({})).toEqual({ kind: "any" });
    expect(widgetServingFromEnv({ NODE_ENV: "production" })).toEqual({ kind: "off" });
    expect(widgetServingFromEnv({ NODE_ENV: "production", WIDGET_ADDRESS: " " })).toEqual({ kind: "off" });
    expect(servesWidgetOn({ kind: "off" }, "http://book.example.com/w/pk_x")).toBe(false);
    expect(servesWidgetOn({ kind: "any" }, "http://localhost:5173/w/pk_x")).toBe(true);
  });

  it("serves it only on the WIDGET_ADDRESS host", () => {
    const env = { NODE_ENV: "production", BETTER_AUTH_URL: "https://app.example.com" };
    for (const address of ["book.example.com", "https://book.example.com", "https://Book.Example.com:443"]) {
      const serving = widgetServingFromEnv({ ...env, WIDGET_ADDRESS: address });
      expect(serving).toEqual({ kind: "host", host: "book.example.com" });
      expect(servesWidgetOn(serving, "https://book.example.com/w/pk_x")).toBe(true);
      expect(servesWidgetOn(serving, "https://app.example.com/w/pk_x")).toBe(false);
    }
    const local = widgetServingFromEnv({ WIDGET_ADDRESS: "http://127.0.0.1:8080", BETTER_AUTH_URL: "http://localhost" });
    expect(servesWidgetOn(local, "http://127.0.0.1:8080/w/pk_x")).toBe(true);
    expect(servesWidgetOn(local, "http://127.0.0.1/w/pk_x")).toBe(false);
  });

  it("refuses to start with the widget on the staff app's host name, whatever the port", () => {
    const staff = { BETTER_AUTH_URL: "https://app.example.com", TRUSTED_ORIGINS: "https://staff.example.com" };
    for (const address of ["app.example.com", "https://app.example.com:8443", "http://APP.example.com", "staff.example.com"]) {
      expect(() => widgetServingFromEnv({ ...staff, NODE_ENV: "production", WIDGET_ADDRESS: address })).toThrow(
        /host name of its own/,
      );
    }
  });

  it("refuses an address that is not a host", () => {
    for (const address of ["https://book.example.com/w", "https://user@book.example.com", "https://book.example.com?x=1", "http://"]) {
      expect(() => widgetServingFromEnv({ WIDGET_ADDRESS: address })).toThrow(/WIDGET_ADDRESS/);
    }
  });
});
