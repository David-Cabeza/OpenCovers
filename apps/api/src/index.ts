import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { db } from "./db/client";
import {
  cancelReservation,
  createReservation,
  getAvailability,
  getEvents,
  getReservation,
  listByDate,
  modifyReservation,
  searchReservations,
  setStatus,
} from "./lib/reservations";

const DEFAULT_DURATION_MINUTES = 120;
const CHANNEL = "api";

const HTTP_STATUS: Record<string, number> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  reservation_not_found: 404,
  venue_not_found: 404,
  slot_taken: 409,
  invalid_transition: 409,
  already_cancelled: 409,
  notice_address_required: 409,
  party_size_too_large: 400,
  outside_hours: 400,
  expired_cursor: 400,
  transient: 500,
};

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, service: "opencovers" }));

app.post("/v1/venues/:venueId/reservations", async (c) => {
  const venueId = c.req.param("venueId");
  const key = c.req.header("Idempotency-Key");
  if (!key) return error(c, "invalid_request", 400);
  const body = await c.req.json();
  if (
    typeof body.date !== "string" ||
    typeof body.time !== "string" ||
    typeof body.partySize !== "number" ||
    !Array.isArray(body.tables) ||
    body.tables.length === 0
  ) {
    return error(c, "invalid_request", 400);
  }
  const result = await createReservation(
    db,
    venueId,
    {
      date: body.date,
      time: body.time,
      durationMinutes: DEFAULT_DURATION_MINUTES,
      partySize: body.partySize,
      tableIds: body.tables,
      guestName: body.guest?.name,
      guestContact: body.guest?.contact,
      bookedVia: CHANNEL,
      basis: "service",
      ownerPrincipal: CHANNEL,
    },
    key,
  );
  return writeResponse(c, result, venueId);
});

app.post("/v1/venues/:venueId/reservations/:id/modify", async (c) => {
  const venueId = c.req.param("venueId");
  const id = c.req.param("id");
  const key = c.req.header("Idempotency-Key");
  if (!key) return error(c, "invalid_request", 400);
  const body = await c.req.json();
  if (typeof body !== "object" || Object.keys(body).length === 0) {
    return error(c, "invalid_request", 400);
  }
  const result = await modifyReservation(
    db,
    venueId,
    id,
    { partySize: body.partySize, tableIds: body.tables },
    key,
  );
  return writeResponse(c, result, venueId);
});

app.post("/v1/venues/:venueId/reservations/:id/cancel", async (c) => {
  const venueId = c.req.param("venueId");
  const id = c.req.param("id");
  const key = c.req.header("Idempotency-Key");
  if (!key) return error(c, "invalid_request", 400);
  const result = await cancelReservation(db, venueId, id, key);
  if (!result.ok) return mapError(c, result.code);
  const reservation = await getReservation(db, venueId, id);
  if (!reservation) return mapError(c, "reservation_not_found");
  return c.json(toApi(reservation, venueId), 200);
});

app.post("/v1/venues/:venueId/reservations/:id/status", async (c) => {
  const venueId = c.req.param("venueId");
  const id = c.req.param("id");
  const key = c.req.header("Idempotency-Key");
  if (!key) return error(c, "invalid_request", 400);
  const body = await c.req.json();
  if (body.status !== "seated" && body.status !== "attended" && body.status !== "no_show") {
    return error(c, "invalid_request", 400);
  }
  const result = await setStatus(db, venueId, id, body.status, key);
  return writeResponse(c, result, venueId);
});

app.get("/v1/venues/:venueId/reservations/search", async (c) => {
  const venueId = c.req.param("venueId");
  const dateStart = c.req.query("dateStart");
  const dateEnd = c.req.query("dateEnd");
  if (!dateStart || !dateEnd) return error(c, "invalid_request", 400);
  const statuses = c.req.queries("status");
  const reservations = await searchReservations(
    db,
    venueId,
    dateStart,
    dateEnd,
    statuses && statuses.length > 0 ? statuses : undefined,
  );
  return c.json({ reservations: reservations.map((r) => toApi(r, venueId)) });
});

app.get("/v1/venues/:venueId/reservations/:id", async (c) => {
  const venueId = c.req.param("venueId");
  const id = c.req.param("id");
  const reservation = await getReservation(db, venueId, id);
  if (!reservation) return mapError(c, "reservation_not_found");
  return c.json(toApi(reservation, venueId));
});

app.get("/v1/venues/:venueId/reservations", async (c) => {
  return c.json({ reservations: [] });
});

app.get("/v1/venues/:venueId/agenda", async (c) => {
  const venueId = c.req.param("venueId");
  const date = c.req.query("date");
  if (!date) return error(c, "invalid_request", 400);
  const reservations = await listByDate(db, venueId, date);
  return c.json({ reservations: reservations.map((r) => toApi(r, venueId)) });
});

app.get("/v1/venues/:venueId/events", async (c) => {
  const venueId = c.req.param("venueId");
  const cursor = c.req.query("cursor");
  let afterId = 0;
  if (cursor) {
    const prefix = `${venueId}:`;
    if (!cursor.startsWith(prefix)) return mapError(c, "invalid_request");
    afterId = parseInt(cursor.slice(prefix.length), 10);
    if (Number.isNaN(afterId)) return mapError(c, "invalid_request");
  }
  const limit = parseInt(c.req.query("limit") ?? "100", 10);
  const events = await getEvents(db, venueId, afterId, limit);
  const lastId = events.length > 0 ? events[events.length - 1].id : afterId;
  return c.json({
    events: events.map((e) => ({ ...e, id: String(e.id) })),
    nextCursor: `${venueId}:${lastId}`,
  });
});

app.get("/v1/venues/:venueId/availability", async (c) => {
  const venueId = c.req.param("venueId");
  const date = c.req.query("date");
  const partySizeRaw = c.req.query("partySize");
  if (!date || !partySizeRaw) return error(c, "invalid_request", 400);
  const partySize = parseInt(partySizeRaw, 10);
  if (Number.isNaN(partySize)) return error(c, "invalid_request", 400);
  const availability = await getAvailability(db, venueId, date, partySize);
  return c.json({ availability });
});

async function writeResponse(c: any, result: any, venueId: string) {
  if (!result.ok) return mapError(c, result.code);
  const reservation = await getReservation(db, venueId, result.id);
  if (!reservation) return mapError(c, "reservation_not_found");
  return c.json(toApi(reservation, venueId), 200);
}

function toApi(reservation: any, venueId: string) {
  return {
    id: reservation.id,
    venueId,
    date: reservation.date,
    time: reservation.time,
    service: reservation.service,
    partySize: reservation.partySize,
    status: reservation.status,
    version: reservation.version,
    bookedVia: reservation.bookedVia,
    basis: reservation.basis,
    ownerPrincipal: reservation.ownerPrincipal,
    guest: {
      name: reservation.guestName || undefined,
      contact: reservation.guestContact || undefined,
    },
  };
}

function mapError(c: any, code: string) {
  const status = HTTP_STATUS[code] ?? 400;
  return error(c, code, status);
}

function error(c: any, code: string, status: number) {
  return c.json({ code, message: code }, status);
}

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`opencovers api listening on port ${info.port}`);
});

export default app;
