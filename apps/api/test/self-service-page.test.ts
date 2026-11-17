import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.PUBLIC_CHALLENGE_SECRET = "test-secret-for-the-self-service-page";
  process.env.PUBLIC_POW_DIFFICULTY = "0";
});

import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { reservations, services, tables, venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { auth } from "../src/lib/auth";
import { challengeConfigFromEnv, issueChallenge, solve } from "../src/lib/public-challenge";
// The widget's own client, so this drives the engine exactly as the /r page does.
import { publicApi, selfServiceApi, type SelfServiceToken } from "../../widget/src/api";
import { createKeyedAction } from "../../widget/src/submit";

const POLICY =
  "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' https: data:; " +
  "style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'; object-src 'none'";

beforeAll(async () => {
  const dist = mkdtempSync(path.join(tmpdir(), "oc-widget-r-"));
  mkdirSync(path.join(dist, ".vite"));
  mkdirSync(path.join(dist, "assets"));
  writeFileSync(
    path.join(dist, ".vite", "manifest.json"),
    JSON.stringify({ "src/main.tsx": { file: "assets/main-R1.js", css: ["assets/main-R1.css"], isEntry: true } }),
  );
  writeFileSync(path.join(dist, "assets", "main-R1.js"), "");
  process.env.WIDGET_DIST = dist;
  await migrateDb();
  await db.execute(
    sql`TRUNCATE TABLE events, tombstones, idempotency_keys, table_allocations, reservations, guests, grants, api_keys, services, tables, venue_online_booking, venues RESTART IDENTITY CASCADE`,
  );
});

const page = (query = "", init: RequestInit = {}) => app.request(`/r${query}`, init);
const headersOf = (res: Response) => Object.fromEntries(res.headers.entries());

describe("GET /r, the self-service page (ADR-0017 stage 6)", () => {
  it("returns the widget shell, never framed, with no referrer, no index and no cache", async () => {
    const res = await page();
    expect(res.status).toBe(200);
    expect(headersOf(res)).toEqual({
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": `${POLICY}; frame-ancestors 'none'`,
      "x-frame-options": "DENY",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    const html = await res.text();
    expect(html).toContain('<html lang="es">');
    expect(html).toContain("<title>Tu reserva</title>");
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('<script type="module" src="/w/assets/main-R1.js"></script>');
    expect(html).toContain('<link rel="stylesheet" href="/w/assets/main-R1.css">');
  });

  it("is the same page whatever the query, a cookie or a key carries, apart from a supported lang", async () => {
    const plain = await page();
    const body = await plain.text();
    const signUp = await auth.api.signUpEmail({
      body: { name: "Staff", email: `rpage-${Date.now()}@example.com`, password: "password123" },
      asResponse: true,
    });
    const cookie = signUp.headers.get("set-cookie")!.split(";")[0];
    for (const [query, init] of [
      ["?token=abc.def", {}],
      ["?lang=fr", {}],
      ['?lang="><script>', {}],
      ["", { headers: { cookie } }],
      ["", { headers: { "X-Self-Service-Token": "0f8fad5b-d9cb-469f-a165-70867728950e.x" } }],
    ] as const) {
      const res = await page(query, init);
      expect(res.status).toBe(200);
      expect(headersOf(res)).toEqual(headersOf(plain));
      expect(await res.text()).toBe(body);
    }
    const en = await (await page("?lang=en")).text();
    expect(en).toContain('<html lang="en">');
    expect(en).toContain("<title>Your booking</title>");
  });

  it("answers 503, framed by no one, when the widget is not built", async () => {
    const dist = process.env.WIDGET_DIST;
    process.env.WIDGET_DIST = mkdtempSync(path.join(tmpdir(), "oc-widget-empty-"));
    try {
      const res = await page();
      expect(res.status).toBe(503);
      expect(res.headers.get("content-security-policy")).toBe(`${POLICY}; frame-ancestors 'none'`);
    } finally {
      process.env.WIDGET_DIST = dist;
    }
  });
});

describe("create, view, change and cancel through the widget's client", () => {
  async function venue() {
    await db.insert(venues).values({ id: "rflow", name: "Casa Flujo", timezone: "Europe/Madrid" });
    await db.insert(services).values({ venueId: "rflow", name: "dinner", openStart: "20:00", openEnd: "23:00" });
    await db.insert(tables).values([
      { id: "rflow-t0", venueId: "rflow", name: "T0", seats: 2 },
      { id: "rflow-t1", venueId: "rflow", name: "T1", seats: 6 },
    ]);
    await addKey(db, "rflow-admin", "admin-rflow", ["rflow"], "admin");
    await addKey(db, "rflow-writer", "writer-rflow", ["rflow"], "write");
    const res = await app.request("/v1/venues/rflow/online-booking", {
      method: "PUT",
      headers: { apikey: "rflow-admin", "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    return (await res.json()).bookingKey as string;
  }

  it("books, reads, changes with a replay-safe key, sees a staff change, and cancels once", async () => {
    const urls: string[] = [];
    let dropNextAnswer = false;
    const fetcher = async (input: string, init: RequestInit) => {
      urls.push(input);
      const res = await app.request(input, init);
      if (dropNextAnswer) {
        dropNextAnswer = false;
        throw new TypeError("Failed to fetch");
      }
      return res;
    };
    const bookingKey = await venue();
    const challenge = issueChallenge(challengeConfigFromEnv(), bookingKey, Date.now() - 10_000);
    const created = await publicApi(bookingKey, fetcher).create(
      crypto.randomUUID(),
      { date: "2030-06-01", time: "20:00", partySize: 2, name: "Ana", contact: "ana@example.com", commentary: "", honeypot: "" },
      challenge,
      solve(challenge),
    );
    if (!created.ok) throw new Error(JSON.stringify(created.failure));
    const token = created.value.selfServiceToken as SelfServiceToken;
    const guest = selfServiceApi(token, fetcher);

    const first = await guest.read();
    expect(first).toMatchObject({ ok: true, value: { venue: { name: "Casa Flujo" }, partySize: 2, version: 1 } });

    const keys: string[] = [];
    const newKey = () => keys[keys.push(crypto.randomUUID()) - 1];
    const modify = createKeyedAction({
      newKey,
      send: (key, p: { version: number; partySize: number }) => guest.modify(key, p.version, { partySize: p.partySize }),
    });
    dropNextAnswer = true;
    expect((await modify({ version: 1, partySize: 4 })).ok).toBe(false);
    const retried = await modify({ version: 1, partySize: 4 });
    expect(retried).toMatchObject({ ok: true, value: { partySize: 4, version: 2 } });
    expect(keys).toHaveLength(1);

    const [{ id: reservationId }] = await db.select({ id: reservations.id }).from(reservations).where(eq(reservations.venueId, "rflow"));
    const staffModify = await app.request(`/v1/venues/rflow/reservations/${reservationId}/modify`, {
      method: "POST",
      headers: { apikey: "rflow-writer", "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ commentary: "Staff note" }),
    });
    expect(staffModify.status).toBe(200);
    const stale = await modify({ version: 2, partySize: 5 });
    expect(stale).toMatchObject({ ok: false, failure: { kind: "error", code: "reservation_changed" } });
    const fresh = await guest.read();
    expect(fresh).toMatchObject({ ok: true, value: { version: 3, commentary: "Staff note", partySize: 4 } });

    const cancel = createKeyedAction({ newKey, send: (key) => guest.cancel(key) });
    dropNextAnswer = true;
    expect((await cancel(undefined)).ok).toBe(false);
    const cancelled = await cancel(undefined);
    expect(cancelled).toMatchObject({ ok: true, value: { status: "cancelled", version: 4 } });
    expect(await guest.read()).toMatchObject({ ok: false, failure: { code: "self_service_link_invalid" } });

    const secret = token.split(".")[1];
    for (const url of urls) expect(url).not.toContain(secret);
  });
});
