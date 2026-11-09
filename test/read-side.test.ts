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

function get(venueId: string, path: string) {
  return SELF.fetch(`https://example.com/v1/venues/${venueId}${path}`, {
    headers: { apikey: "test-key" },
  });
}

const create = {
  date: "2026-11-12",
  time: "21:00",
  partySize: 2,
  tables: ["1"],
  guest: { name: "Carlos", contact: "carlos@example.com" },
};

async function createReservation(venueId: string, key: string): Promise<string> {
  const res = await post(venueId, "/reservations", create, key);
  const body = (await res.json()) as { id: string };
  return body.id;
}

describe("read side", () => {
  it("emits events in the feed with a cursor", async () => {
    const id = await createReservation("feed", "k1");
    await post("feed", `/reservations/${id}/status`, { status: "seated" }, "k2");
    await post("feed", `/reservations/${id}/cancel`, {}, "k3");

    const res = await get("feed", "/events");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: { id: string; type: string; reservationId: string }[];
      nextCursor: string;
    };
    expect(body.events.map((e) => e.type)).toEqual([
      "created",
      "seated",
      "cancelled",
    ]);
    expect(body.events.every((e) => e.reservationId === id)).toBe(true);
    expect(body.nextCursor).toBe(`feed:${body.events[body.events.length - 1].id}`);

    const again = await get("feed", `/events?cursor=${body.nextCursor}`);
    const againBody = (await again.json()) as { events: unknown[]; nextCursor: string };
    expect(againBody.events).toHaveLength(0);
    expect(againBody.nextCursor).toBe(body.nextCursor);
  });

  it("rejects a cursor from another venue", async () => {
    const res = await get("feed", "/events?cursor=other:5");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "invalid_request",
      message: "invalid_request",
    });
  });

  it("transitions status seated then attended", async () => {
    const id = await createReservation("status", "k1");
    const seated = await post("status", `/reservations/${id}/status`, { status: "seated" }, "k2");
    const seatedBody = (await seated.json()) as { status: string; version: number };
    expect(seatedBody.status).toBe("seated");
    expect(seatedBody.version).toBe(2);

    const attended = await post(
      "status",
      `/reservations/${id}/status`,
      { status: "attended" },
      "k3",
    );
    const attendedBody = (await attended.json()) as { status: string; version: number };
    expect(attendedBody.status).toBe("attended");
    expect(attendedBody.version).toBe(3);
  });

  it("rejects an invalid status transition", async () => {
    const id = await createReservation("bad-status", "k1");
    const res = await post(
      "bad-status",
      `/reservations/${id}/status`,
      { status: "attended" },
      "k2",
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "invalid_transition",
      message: "invalid_transition",
    });
  });

  it("reads a reservation with its guest", async () => {
    const id = await createReservation("get", "k1");
    const res = await get("get", `/reservations/${id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      status: string;
      guest: { name: string; contact: string };
    };
    expect(body.id).toBe(id);
    expect(body.status).toBe("booked");
    expect(body.guest).toEqual({ name: "Carlos", contact: "carlos@example.com" });
  });

  it("lists the agenda for a date", async () => {
    await post("agenda", "/reservations", { ...create, time: "19:00" }, "k1");
    await post("agenda", "/reservations", { ...create, time: "21:00" }, "k2");
    const res = await get("agenda", "/agenda?date=2026-11-12");
    const body = (await res.json()) as { reservations: { time: string }[] };
    expect(body.reservations).toHaveLength(2);
    expect(body.reservations.map((r) => r.time)).toEqual(["19:00", "21:00"]);
  });

  it("searches reservations by date and status", async () => {
    const id = await createReservation("search", "k1");
    await post("search", `/reservations/${id}/cancel`, {}, "k2");
    const res = await get(
      "search",
      "/reservations/search?dateStart=2026-11-12&dateEnd=2026-11-12&status=cancelled",
    );
    const body = (await res.json()) as { reservations: { id: string }[] };
    expect(body.reservations).toHaveLength(1);
    expect(body.reservations[0].id).toBe(id);
  });

  it("returns an empty list without a guest principal", async () => {
    await createReservation("guest", "k1");
    const res = await get("guest", "/reservations");
    const body = (await res.json()) as { reservations: unknown[] };
    expect(body.reservations).toHaveLength(0);
  });
});
