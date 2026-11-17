import { count, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/app";
import { db } from "../src/db/client";
import { migrateDb } from "../src/db/migrate";
import { venues } from "../src/db/schema";
import { addKey } from "../src/lib/api-keys";
import { auth } from "../src/lib/auth";

const TRUSTED = "http://localhost:5173";
const SIBLING = "https://book.example.com";

beforeAll(async () => {
  await migrateDb();
});

let cookie = "";
let venueId = "";

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE invitations, account, session, verification, "user", venue_memberships, grants, api_keys, services, tables, venues RESTART IDENTITY CASCADE`,
  );
  const res = await auth.api.signUpEmail({
    body: { name: "Staff", email: `staff-${crypto.randomUUID()}@example.com`, password: "password123" },
    asResponse: true,
  });
  cookie = res.headers.get("set-cookie")!;
  const made = await send("POST", "/v1/venues", { body: JSON.stringify({ name: "Casa" }) });
  expect(made.status).toBe(201);
  venueId = (await made.json()).venue.id;
});

interface Options {
  body?: string;
  type?: string;
  origin?: string;
  headers?: Record<string, string>;
}

function send(method: string, path: string, { body, type = "application/json", origin, headers }: Options = {}) {
  return app.request(path, {
    method,
    headers: {
      cookie,
      ...(body === undefined ? {} : { "content-type": type }),
      ...(origin ? { origin } : {}),
      ...headers,
    },
    body,
  });
}

const venueCount = async () => (await db.select({ n: count() }).from(venues))[0]!.n;

describe("staff writes made with a session cookie", () => {
  const create = { body: JSON.stringify({ name: "Forged" }) };

  it("refuses a write from an origin outside the trusted origins, whatever its content type", async () => {
    for (const type of ["text/plain", "application/json"]) {
      const res = await send("POST", "/v1/venues", { ...create, type, origin: SIBLING });
      expect(res.status, type).toBe(403);
      expect((await res.json()).code).toBe("forbidden");
    }
    const removed = await send("DELETE", `/v1/venues/${venueId}/webhooks/none`, { origin: SIBLING });
    expect(removed.status).toBe(403);
    const opaque = await send("POST", "/v1/venues", { ...create, origin: "null" });
    expect(opaque.status).toBe(403);
    expect(await venueCount()).toBe(1);
  });

  it("refuses a body that is not JSON, with or without an Origin", async () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const res = await send("POST", "/v1/venues", { ...create, type });
      expect(res.status, type).toBe(400);
      expect((await res.json()).code).toBe("invalid_request");
    }
    expect((await send("POST", "/v1/venues", { ...create, type: "text/plain", origin: TRUSTED })).status).toBe(400);
    expect(await venueCount()).toBe(1);
  });

  it("allows a JSON write from a trusted origin or with no Origin, and a write with no body", async () => {
    expect((await send("POST", "/v1/venues", { ...create, origin: TRUSTED })).status).toBe(201);
    expect((await send("POST", "/v1/venues", { ...create, origin: "http://localhost:3000" })).status).toBe(201);
    expect((await send("POST", "/v1/venues", { ...create, type: "application/json; charset=utf-8" })).status).toBe(201);
    expect((await send("POST", "/v1/venues", create)).status).toBe(201);
    const removed = await send("DELETE", `/v1/venues/${venueId}/webhooks/none`, { origin: TRUSTED });
    expect((await removed.json()).code).toBe("webhook_not_found");
    expect(await venueCount()).toBe(5);
  });

  it("leaves reads alone", async () => {
    const res = await send("GET", "/v1/venues", { origin: SIBLING });
    expect(res.status).toBe(200);
  });
});

describe("requests the guard does not apply to", () => {
  it("leaves an API key write alone, whatever its Origin and content type", async () => {
    await addKey(db, "origin-admin", "key-admin", [venueId], "admin");
    const res = await app.request(`/v1/venues/${venueId}/online-booking`, {
      method: "PUT",
      headers: { apikey: "origin-admin", "content-type": "text/plain", origin: SIBLING },
      body: JSON.stringify({ locale: "en" }),
    });
    expect(res.status).toBe(200);
  });

  it("answers a public write the same with or without a cookie and a sibling Origin", async () => {
    const plain = { "content-type": "text/plain", "Idempotency-Key": "not-a-uuid" };
    const answer = async (headers: Record<string, string>) => {
      const res = await app.request("/v1/public/self-service/cancel", { method: "POST", headers, body: "{}" });
      return [res.status, await res.text()];
    };
    expect(await answer({ ...plain, cookie, origin: SIBLING })).toEqual(await answer(plain));
  });
});
