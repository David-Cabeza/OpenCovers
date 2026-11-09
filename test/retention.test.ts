import { env, runInDurableObject, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { seedTestKey } from "./helpers";

const testEnv = env as unknown as Env;

beforeAll(seedTestKey);

describe("feed retention", () => {
  it("rejects a cursor older than the retention window", async () => {
    const v = testEnv.VENUE.get(testEnv.VENUE.idFromName("retention"));
    const oldTime = Math.floor(Date.now() / 1000) - 500 * 86400;
    const now = Math.floor(Date.now() / 1000);
    await runInDurableObject(v, (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO reservations (id, date, time, start_epoch, end_epoch, party_size, status, version, created_at) VALUES ('r-old', '2025-01-01', '12:00', 0, 0, 2, 'booked', 1, 0)",
      );
      state.storage.sql.exec(
        "INSERT INTO events (type, reservation_id, version, occurred_at) VALUES ('created', 'r-old', 1, ?)",
        oldTime,
      );
      state.storage.sql.exec(
        "INSERT INTO reservations (id, date, time, start_epoch, end_epoch, party_size, status, version, created_at) VALUES ('r-new', '2026-11-12', '12:00', 0, 0, 2, 'booked', 1, 0)",
      );
      state.storage.sql.exec(
        "INSERT INTO events (type, reservation_id, version, occurred_at) VALUES ('created', 'r-new', 1, ?)",
        now,
      );
    });

    const expired = await SELF.fetch(
      "https://example.com/v1/venues/retention/events?cursor=retention:1",
      { headers: { apikey: "test-key" } },
    );
    expect(expired.status).toBe(400);
    expect(await expired.json()).toEqual({
      code: "expired_cursor",
      message: "expired_cursor",
    });

    const ok = await SELF.fetch(
      "https://example.com/v1/venues/retention/events?cursor=retention:2",
      { headers: { apikey: "test-key" } },
    );
    expect(ok.status).toBe(200);
  });
});
