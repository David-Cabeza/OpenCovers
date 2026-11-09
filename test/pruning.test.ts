import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";

const testEnv = env as unknown as Env;

function venue(name: string) {
  return testEnv.VENUE.get(testEnv.VENUE.idFromName(name));
}

describe("pruning", () => {
  it("deletes events and tombstones older than retention", async () => {
    const v = venue("prune");
    const old = Math.floor(Date.now() / 1000) - 500 * 86400;
    const now = Math.floor(Date.now() / 1000);
    await runInDurableObject(v, (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO reservations (id, date, time, service, start_epoch, end_epoch, party_size, status, version, created_at) VALUES ('r-old', '2025-01-01', '12:00', 'lunch', 0, 0, 2, 'booked', 1, 0)",
      );
      state.storage.sql.exec(
        "INSERT INTO events (type, reservation_id, version, occurred_at) VALUES ('created', 'r-old', 1, ?)",
        old,
      );
      state.storage.sql.exec(
        "INSERT INTO tombstones (reservation_id, hash, created_at) VALUES ('r-old', 'h', ?)",
        old,
      );
      state.storage.sql.exec(
        "INSERT INTO reservations (id, date, time, service, start_epoch, end_epoch, party_size, status, version, created_at) VALUES ('r-new', '2026-11-12', '12:00', 'lunch', 0, 0, 2, 'booked', 1, 0)",
      );
      state.storage.sql.exec(
        "INSERT INTO events (type, reservation_id, version, occurred_at) VALUES ('created', 'r-new', 1, ?)",
        now,
      );
    });

    await runDurableObjectAlarm(v);

    const events = await runInDurableObject(v, (_instance, state) => {
      return state.storage.sql
        .exec<{ reservation_id: string }>("SELECT reservation_id FROM events")
        .toArray();
    });
    expect(events.map((e) => e.reservation_id)).toEqual(["r-new"]);

    const tombstones = await runInDurableObject(v, (_instance, state) => {
      return state.storage.sql
        .exec<{ reservation_id: string }>("SELECT reservation_id FROM tombstones")
        .toArray();
    });
    expect(tombstones).toHaveLength(0);
  });
});
