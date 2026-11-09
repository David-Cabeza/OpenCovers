import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";

const testEnv = env as unknown as Env;

function venue(name: string) {
  const id = testEnv.VENUE.idFromName(name);
  return testEnv.VENUE.get(id);
}

const base = {
  date: "2026-11-12",
  durationMinutes: 120,
  partySize: 2,
  tableIds: ["1"],
};

describe("Venue Durable Object", () => {
  it("creates a reservation with version 1", async () => {
    const res = await venue("create").createReservation({ ...base, time: "21:00" }, "k1");
    expect(res).toEqual({ ok: true, version: 1, id: expect.any(String) });
  });

  it("replays a create with the same idempotency key", async () => {
    const v = venue("create-replay");
    const first = await v.createReservation({ ...base, time: "21:00" }, "k1");
    const second = await v.createReservation({ ...base, time: "21:00" }, "k1");
    expect(second).toEqual(first);
  });

  it("rejects an overlapping table and time", async () => {
    const v = venue("overlap");
    await v.createReservation({ ...base, time: "21:00" }, "k1");
    const res = await v.createReservation({ ...base, time: "21:30" }, "k2");
    expect(res).toEqual({ ok: false, code: "slot_taken" });
  });

  it("accepts a non-overlapping time on the same table", async () => {
    const v = venue("nonoverlap");
    await v.createReservation({ ...base, time: "19:00" }, "k1");
    const res = await v.createReservation({ ...base, time: "21:00" }, "k2");
    expect(res.ok).toBe(true);
  });

  it("double-books under concurrency: exactly one winner", async () => {
    const v = venue("concurrent");
    const [a, b] = await Promise.all([
      v.createReservation({ ...base, time: "21:00" }, "ka"),
      v.createReservation({ ...base, time: "21:00" }, "kb"),
    ]);
    const winners = [a, b].filter((r) => r.ok);
    const losers = [a, b].filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]).toEqual({ ok: false, code: "slot_taken" });
  });

  it("rejects an overlapping allocation even when the application check is bypassed", async () => {
    const v = venue("trigger-bypass");
    await runInDurableObject(v, (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO reservations (id, date, time, start_epoch, end_epoch, party_size, status, version, created_at) VALUES ('r1', '2026-11-12', '21:00', 1000, 2000, 2, 'booked', 1, 0)",
      );
      state.storage.sql.exec(
        "INSERT INTO table_allocations (reservation_id, table_id, start_epoch, end_epoch) VALUES ('r1', '1', 1000, 2000)",
      );
    });
    await expect(
      runInDurableObject(v, (_instance, state) => {
        state.storage.sql.exec(
          "INSERT INTO table_allocations (reservation_id, table_id, start_epoch, end_epoch) VALUES ('r2', '1', 1500, 2500)",
        );
      }),
    ).rejects.toThrow(/slot_taken/);
  });

  it("bumps the version on each modify", async () => {
    const v = venue("version");
    const created = await v.createReservation({ ...base, time: "21:00" }, "k1");
    if (!created.ok) throw new Error("create failed");
    const m1 = await v.modifyReservation(created.id, { partySize: 3 }, "k2");
    const m2 = await v.modifyReservation(created.id, { partySize: 4 }, "k3");
    expect(m1).toEqual({ ok: true, id: created.id, version: 2 });
    expect(m2).toEqual({ ok: true, id: created.id, version: 3 });
  });

  it("rejects a modify into an occupied table", async () => {
    const v = venue("modify-overlap");
    const a = await v.createReservation({ ...base, tableIds: ["1"], time: "21:00" }, "k1");
    const b = await v.createReservation({ ...base, tableIds: ["2"], time: "21:00" }, "k2");
    if (!a.ok || !b.ok) throw new Error("create failed");
    const res = await v.modifyReservation(a.id, { tableIds: ["2"] }, "k3");
    expect(res).toEqual({ ok: false, code: "slot_taken" });
  });

  it("rejects a modify after cancel", async () => {
    const v = venue("modify-cancelled");
    const created = await v.createReservation({ ...base, time: "21:00" }, "k1");
    if (!created.ok) throw new Error("create failed");
    await v.cancelReservation(created.id, "k2");
    const res = await v.modifyReservation(created.id, { partySize: 3 }, "k3");
    expect(res).toEqual({ ok: false, code: "invalid_transition" });
  });

  it("writes a tombstone on cancel and stays idempotent", async () => {
    const v = venue("tombstone");
    const created = await v.createReservation({ ...base, time: "21:00" }, "k1");
    if (!created.ok) throw new Error("create failed");
    const res = await v.cancelReservation(created.id, "k2");
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.hash).toMatch(/^[0-9a-f]{64}$/);

    const rows = await runInDurableObject(v, (_instance, state) => {
      return state.storage.sql
        .exec<{ reservation_id: string; hash: string }>(
          "SELECT reservation_id, hash FROM tombstones WHERE reservation_id = ?",
          created.id,
        )
        .toArray();
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].hash).toBe(res.hash);

    const again = await v.cancelReservation(created.id, "k3");
    expect(again).toEqual({ ok: false, code: "already_cancelled" });

    const replay = await v.cancelReservation(created.id, "k2");
    expect(replay).toEqual({ ok: true, hash: res.hash });
  });
});
