import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { seedTestKey } from "./helpers";

beforeAll(seedTestKey);

function post(venueId: string, path: string, body: unknown, key: string) {
  return SELF.fetch(`https://example.com/v1/venues/${venueId}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key, apikey: "test-key" },
    body: JSON.stringify(body),
  });
}

function put(venueId: string, path: string, body: unknown, key: string) {
  return SELF.fetch(`https://example.com/v1/venues/${venueId}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key, apikey: "test-key" },
    body: JSON.stringify(body),
  });
}

function get(venueId: string, path: string) {
  return SELF.fetch(`https://example.com/v1/venues/${venueId}${path}`, {
    headers: { apikey: "test-key" },
  });
}

describe("config, availability, and erasure", () => {
  it("enforces the notice address rule", async () => {
    const enable = await put("config", "/config", { enabled: true }, "k1");
    expect(enable.status).toBe(409);
    expect(await enable.json()).toEqual({
      code: "notice_address_required",
      message: "notice_address_required",
    });

    await put("config", "/config", { noticeAddress: "owner@example.com" }, "k2");
    const enableOk = await put("config", "/config", { enabled: true }, "k3");
    expect(enableOk.status).toBe(200);

    const clear = await put("config", "/config", { noticeAddress: "" }, "k4");
    expect(clear.status).toBe(409);
    expect(await clear.json()).toEqual({
      code: "notice_address_required",
      message: "notice_address_required",
    });
  });

  it("returns availability grouped by service", async () => {
    const res8 = await get("avail", "/availability?date=2026-11-12&partySize=8");
    const body8 = (await res8.json()) as {
      availability: {
        lunch: { time: string; available: boolean }[];
        dinner: { time: string; available: boolean }[];
      };
    };
    expect(body8.availability.lunch.every((s) => !s.available)).toBe(true);
    expect(body8.availability.dinner.every((s) => !s.available)).toBe(true);

    await post(
      "avail",
      "/reservations",
      { date: "2026-11-12", time: "21:00", partySize: 6, tables: ["5"] },
      "k1",
    );
    const res6 = await get("avail", "/availability?date=2026-11-12&partySize=6");
    const body6 = (await res6.json()) as {
      availability: { dinner: { time: string; available: boolean }[] };
    };
    const dinner = body6.availability.dinner;
    expect(dinner.find((s) => s.time === "21:00")?.available).toBe(false);
    expect(dinner.find((s) => s.time === "19:00")?.available).toBe(true);
  });

  it("erases personal data and emits a tombstone", async () => {
    const created = await post(
      "erase",
      "/reservations",
      {
        date: "2026-11-12",
        time: "21:00",
        partySize: 2,
        tables: ["1"],
        guest: { name: "Carlos", contact: "carlos@example.com" },
      },
      "k1",
    );
    const c = (await created.json()) as { id: string };

    const res = await post("erase", "/erasure", { guestId: "carlos@example.com" }, "k2");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { erasedReservations: number; erasedGuests: number };
    expect(body).toEqual({ erasedReservations: 1, erasedGuests: 1 });

    const getRes = await get("erase", `/reservations/${c.id}`);
    const g = (await getRes.json()) as { guest: { name?: string; contact?: string } };
    expect(g.guest.name).toBeUndefined();
    expect(g.guest.contact).toBeUndefined();

    const feed = await get("erase", "/events");
    const fb = (await feed.json()) as {
      events: { type: string; tombstoneHash?: string }[];
    };
    const erased = fb.events.find((e) => e.type === "erased");
    expect(erased?.tombstoneHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a party larger than the assigned tables", async () => {
    const res = await post(
      "capacity",
      "/reservations",
      { date: "2026-11-12", time: "21:00", partySize: 8, tables: ["5"] },
      "k1",
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "party_size_too_large",
      message: "party_size_too_large",
    });
  });

  it("erasing twice does not double-count", async () => {
    await post(
      "erase2",
      "/reservations",
      {
        date: "2026-11-12",
        time: "21:00",
        partySize: 2,
        tables: ["1"],
        guest: { name: "Ana", contact: "ana@example.com" },
      },
      "k1",
    );
    const first = await post("erase2", "/erasure", { guestId: "ana@example.com" }, "k2");
    const second = await post("erase2", "/erasure", { guestId: "ana@example.com" }, "k3");
    expect(await first.json()).toEqual({ erasedReservations: 1, erasedGuests: 1 });
    expect(await second.json()).toEqual({ erasedReservations: 0, erasedGuests: 0 });
  });
});
