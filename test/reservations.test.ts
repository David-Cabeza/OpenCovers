import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { seedTestKey } from "./helpers";

beforeAll(seedTestKey);

function post(venueId: string, path: string, body: unknown, key: string) {
  return SELF.fetch(`https://example.com/v1/venues/${venueId}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
      apikey: "test-key",
    },
    body: JSON.stringify(body),
  });
}

const create = {
  date: "2026-11-12",
  time: "21:00",
  partySize: 2,
  tables: ["1"],
};

describe("reservations API", () => {
  it("creates a reservation", async () => {
    const res = await post("create", "/reservations", create, "k1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      venueId: string;
      status: string;
      version: number;
      service: string;
    };
    expect(body.venueId).toBe("create");
    expect(body.status).toBe("booked");
    expect(body.version).toBe(1);
    expect(body.service).toBe("dinner");
    expect(body.id).toEqual(expect.any(String));
  });

  it("replays a create with the same key", async () => {
    const first = await post("replay", "/reservations", create, "k1");
    const second = await post("replay", "/reservations", create, "k1");
    const a = (await first.json()) as { id: string };
    const b = (await second.json()) as { id: string };
    expect(a.id).toBe(b.id);
  });

  it("returns slot_taken for an overlapping booking", async () => {
    await post("overlap", "/reservations", create, "k1");
    const res = await post(
      "overlap",
      "/reservations",
      { ...create, time: "21:30" },
      "k2",
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "slot_taken", message: "slot_taken" });
  });

  it("rejects a create without tables", async () => {
    const res = await post(
      "notables",
      "/reservations",
      { date: "2026-11-12", time: "21:00", partySize: 2 },
      "k1",
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "invalid_request",
      message: "invalid_request",
    });
  });

  it("rejects a write without an idempotency key", async () => {
    const res = await SELF.fetch("https://example.com/v1/venues/nokey/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: "test-key" },
      body: JSON.stringify(create),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "invalid_request",
      message: "invalid_request",
    });
  });

  it("modifies a reservation and bumps the version", async () => {
    const created = await post("modify", "/reservations", create, "k1");
    const c = (await created.json()) as { id: string };
    const res = await post(
      "modify",
      `/reservations/${c.id}/modify`,
      { partySize: 3 },
      "k2",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: number; partySize: number };
    expect(body.version).toBe(2);
    expect(body.partySize).toBe(3);
  });

  it("cancels a reservation and then reports already_cancelled", async () => {
    const created = await post("cancel", "/reservations", create, "k1");
    const c = (await created.json()) as { id: string };
    const cancel = await post("cancel", `/reservations/${c.id}/cancel`, {}, "k2");
    expect(cancel.status).toBe(200);
    const again = await post("cancel", `/reservations/${c.id}/cancel`, {}, "k3");
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({
      code: "already_cancelled",
      message: "already_cancelled",
    });
  });
});
