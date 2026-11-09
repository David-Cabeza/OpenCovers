import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { seedTestKey } from "./helpers";

const testEnv = env as unknown as Env;

beforeAll(seedTestKey);

describe("worker", () => {
  it("answers /health", async () => {
    const res = await SELF.fetch("https://example.com/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "opencovers" });
  });

  it("rejects a request without an api key", async () => {
    const res = await SELF.fetch("https://example.com/v1/venues/x/reservations");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "unauthorized", message: "unauthorized" });
  });

  it("rejects a request with a wrong api key", async () => {
    const res = await SELF.fetch("https://example.com/v1/venues/x/reservations", {
      headers: { apikey: "wrong-key" },
    });
    expect(res.status).toBe(401);
  });

  it("returns venue_not_found when the key lacks a grant for the venue", async () => {
    const id = testEnv.AUTH.idFromName("global");
    await testEnv.AUTH.get(id).addKey("scoped-key", "scoped-principal", ["venue-a"]);
    const res = await SELF.fetch("https://example.com/v1/venues/venue-b/reservations", {
      headers: { apikey: "scoped-key" },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      code: "venue_not_found",
      message: "venue_not_found",
    });
  });

  it("rejects a read-only key on a write", async () => {
    const id = testEnv.AUTH.idFromName("global");
    await testEnv.AUTH.get(id).addKey("read-key", "read-principal", ["*"], "read");
    const res = await SELF.fetch("https://example.com/v1/venues/x/reservations", {
      method: "POST",
      headers: {
        apikey: "read-key",
        "Content-Type": "application/json",
        "Idempotency-Key": "k1",
      },
      body: JSON.stringify({
        date: "2026-11-12",
        time: "21:00",
        partySize: 2,
        tables: ["1"],
      }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "forbidden", message: "forbidden" });
  });

  it("lets an admin provision, list, and revoke keys", async () => {
    const list = await SELF.fetch("https://example.com/v1/auth/keys", {
      headers: { apikey: "test-key" },
    });
    expect(list.status).toBe(200);

    const add = await SELF.fetch("https://example.com/v1/auth/keys", {
      method: "POST",
      headers: { apikey: "test-key", "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "new-key",
        principal: "new-principal",
        role: "write",
        venues: ["*"],
      }),
    });
    expect(add.status).toBe(200);

    const revoke = await SELF.fetch("https://example.com/v1/auth/keys", {
      method: "DELETE",
      headers: { apikey: "test-key", "Content-Type": "application/json" },
      body: JSON.stringify({ key: "new-key" }),
    });
    expect(revoke.status).toBe(200);
  });
});
