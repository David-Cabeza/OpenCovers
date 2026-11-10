import { Hono } from "hono";
import { db } from "./db/client";
import {
  addKey,
  addVenueKey,
  authenticate,
  authenticateAdmin,
  listKeys,
  listVenueKeys,
  revokeKey,
  revokeVenueKey,
} from "./lib/api-keys";
import { auth } from "./lib/auth";
import { getMembership, listVenuesForUser } from "./lib/memberships";
import {
  deleteService,
  deleteTable,
  listServices,
  listTables,
  upsertService,
  upsertTable,
} from "./lib/catalog";
import {
  cancelReservation,
  createReservation,
  getAvailability,
  getEvents,
  getEventsWatermark,
  getFloorPlan,
  getPacing,
  getReservation,
  listByDate,
  listByPrincipal,
  modifyReservation,
  searchReservations,
  setStatus,
  walkIn,
} from "./lib/reservations";
import { createVenue, erase, getConfig, setConfig } from "./lib/venue";
import { notifyReservation } from "./lib/notifications";
import {
  addWaitlist,
  cancelWaitlist,
  listWaitlist,
  seatWaitlist,
} from "./lib/waitlist";

const DEFAULT_DURATION_MINUTES = 120;

const HTTP_STATUS: Record<string, number> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  reservation_not_found: 404,
  waitlist_entry_not_found: 404,
  venue_not_found: 404,
  slot_taken: 409,
  no_suitable_table: 409,
  invalid_transition: 409,
  already_cancelled: 409,
  notice_address_required: 409,
  party_size_too_large: 400,
  outside_hours: 400,
  lead_time_violation: 400,
  expired_cursor: 400,
  transient: 500,
};

type AppEnv = {
  Variables: {
    principal: string;
    role: string;
  };
};

const app = new Hono<AppEnv>();

app.get("/health", (c) => c.json({ ok: true, service: "opencovers" }));

app.all("/api/auth/*", (c) => auth.handler(c.req.raw));

app.use("/v1/venues/:venueId/*", async (c, next) => {
  const venueId = c.req.param("venueId");
  const key = c.req.header("apikey");

  let principal: string;
  let role: string;

  if (key) {
    const result = await authenticate(db, key, venueId);
    if (!result.ok) {
      return result.reason === "unauthorized"
        ? error(c, "unauthorized", 401)
        : error(c, "venue_not_found", 404);
    }
    principal = result.principal;
    role = result.role;
  } else {
    const user = await sessionUser(c);
    if (!user) return error(c, "unauthorized", 401);
    const membership = await getMembership(db, user.id, venueId);
    if (!membership) return error(c, "venue_not_found", 404);
    principal = user.email;
    role = membership.role;
  }

  const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method);
  if (isWrite && role === "read") {
    return error(c, "forbidden", 403);
  }
  c.set("principal", principal);
  c.set("role", role);
  await next();
});

app.get("/v1/venues", async (c) => {
  const user = await sessionUser(c);
  if (!user) return error(c, "unauthorized", 401);
  const venues = await listVenuesForUser(db, user.id);
  return c.json({ venues });
});

app.post("/v1/venues", async (c) => {
  const user = await sessionUser(c);
  if (!user) return error(c, "unauthorized", 401);
  const body = await c.req.json();
  if (typeof body.name !== "string" || body.name.trim() === "") {
    return error(c, "invalid_request", 400);
  }
  const { id } = await createVenue(db, user.id, {
    id: typeof body.id === "string" ? body.id : undefined,
    name: body.name,
    timezone: typeof body.timezone === "string" ? body.timezone : undefined,
  });
  return c.json({ venue: { id, name: body.name } }, 201);
});

app.get("/v1/auth/keys", async (c) => {
  const admin = await authorizeAdmin(c);
  if (admin instanceof Response) return admin;
  const keys = await listKeys(db);
  return c.json({ keys });
});

app.post("/v1/auth/keys", async (c) => {
  const admin = await authorizeAdmin(c);
  if (admin instanceof Response) return admin;
  const body = await c.req.json();
  if (
    typeof body.key !== "string" ||
    typeof body.principal !== "string" ||
    !isRole(body.role)
  ) {
    return error(c, "invalid_request", 400);
  }
  const venues = body.venues === undefined ? ["*"] : body.venues;
  if (!Array.isArray(venues) || venues.some((v: unknown) => typeof v !== "string")) {
    return error(c, "invalid_request", 400);
  }
  await addKey(db, body.key, body.principal, venues, body.role);
  return c.json({ ok: true });
});

app.delete("/v1/auth/keys", async (c) => {
  const admin = await authorizeAdmin(c);
  if (admin instanceof Response) return admin;
  const body = await c.req.json();
  if (typeof body.key !== "string") return error(c, "invalid_request", 400);
  await revokeKey(db, body.key);
  return c.json({ ok: true });
});

app.post("/v1/venues/:venueId/reservations", async (c) => {
  const venueId = c.req.param("venueId");
  const key = c.req.header("Idempotency-Key");
  if (!key) return error(c, "invalid_request", 400);
  const body = await c.req.json();
  if (
    typeof body.date !== "string" ||
    typeof body.time !== "string" ||
    typeof body.partySize !== "number" ||
    (body.tables !== undefined &&
      (!Array.isArray(body.tables) ||
        body.tables.some((t: unknown) => typeof t !== "string")))
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
      zone: typeof body.zone === "string" ? body.zone : undefined,
      guestName: body.guest?.name,
      guestContact: body.guest?.contact,
      bookedVia: c.get("principal") as string,
      basis: "service",
      ownerPrincipal: c.get("principal") as string,
    },
    key,
  );
  if (result.ok) {
    void notifyReservation(db, venueId, result.id, result.version, "confirmation");
    void notifyReservation(db, venueId, result.id, result.version, "notice");
  }
  return writeResponse(c, result, venueId);
});

app.post("/v1/venues/:venueId/reservations/walk-in", async (c) => {
  const venueId = c.req.param("venueId");
  const key = c.req.header("Idempotency-Key");
  if (!key) return error(c, "invalid_request", 400);
  const body = await c.req.json();
  if (typeof body.partySize !== "number") return error(c, "invalid_request", 400);
  const result = await walkIn(
    db,
    venueId,
    {
      date: typeof body.date === "string" ? body.date : undefined,
      time: typeof body.time === "string" ? body.time : undefined,
      partySize: body.partySize,
      tableIds: Array.isArray(body.tables) ? body.tables : undefined,
      zone: typeof body.zone === "string" ? body.zone : undefined,
      guestName: body.guest?.name,
      guestContact: body.guest?.contact,
      bookedVia: c.get("principal") as string,
      basis: "service",
      ownerPrincipal: c.get("principal") as string,
    },
    key,
  );
  if (result.ok) {
    void notifyReservation(db, venueId, result.id, result.version, "confirmation");
    void notifyReservation(db, venueId, result.id, result.version, "notice");
  }
  return writeResponse(c, result, venueId);
});

app.get("/v1/venues/:venueId/waitlist", async (c) => {
  const venueId = c.req.param("venueId");
  const entries = await listWaitlist(db, venueId);
  return c.json({ entries });
});

app.post("/v1/venues/:venueId/waitlist", async (c) => {
  const venueId = c.req.param("venueId");
  const body = await c.req.json();
  if (typeof body.partySize !== "number") return error(c, "invalid_request", 400);
  const result = await addWaitlist(db, venueId, {
    partySize: body.partySize,
    zone: typeof body.zone === "string" ? body.zone : undefined,
    guestName: body.guest?.name,
    guestContact: body.guest?.contact,
  });
  if (!result.ok) return mapError(c, result.code);
  const entries = await listWaitlist(db, venueId);
  return c.json({ entries }, 201);
});

app.post("/v1/venues/:venueId/waitlist/:id/seat", async (c) => {
  const venueId = c.req.param("venueId");
  const id = c.req.param("id");
  const key = c.req.header("Idempotency-Key");
  if (!key) return error(c, "invalid_request", 400);
  const result = await seatWaitlist(db, venueId, id, key);
  if (!result.ok) return mapError(c, result.code);
  const reservation = await getReservation(db, venueId, result.reservationId);
  if (!reservation) return mapError(c, "reservation_not_found");
  void notifyReservation(db, venueId, result.reservationId, reservation.version, "confirmation");
  void notifyReservation(db, venueId, result.reservationId, reservation.version, "notice");
  return c.json(toApi(reservation, venueId), 200);
});

app.post("/v1/venues/:venueId/waitlist/:id/cancel", async (c) => {
  const venueId = c.req.param("venueId");
  const id = c.req.param("id");
  const result = await cancelWaitlist(db, venueId, id);
  if (!result.ok) return mapError(c, result.code);
  const entries = await listWaitlist(db, venueId);
  return c.json({ entries });
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
  if (result.ok) {
    void notifyReservation(db, venueId, result.id, result.version, "confirmation");
  }
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
  void notifyReservation(db, venueId, id, reservation.version, "cancellation");
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
  const venueId = c.req.param("venueId");
  const principal = c.get("principal") as string;
  const reservations = await listByPrincipal(db, venueId, principal);
  return c.json({ reservations: reservations.map((r) => toApi(r, venueId)) });
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
  const watermark = await getEventsWatermark(db, venueId);
  if (afterId > 0 && watermark > 0 && afterId < watermark) {
    return mapError(c, "expired_cursor");
  }
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

app.get("/v1/venues/:venueId/floor", async (c) => {
  const venueId = c.req.param("venueId");
  const date = c.req.query("date");
  const time = c.req.query("time");
  const tables = await getFloorPlan(db, venueId, date, time);
  return c.json({ tables });
});

app.get("/v1/venues/:venueId/pacing", async (c) => {
  const venueId = c.req.param("venueId");
  const date = c.req.query("date");
  if (!date) return error(c, "invalid_request", 400);
  const pacing = await getPacing(db, venueId, date);
  return c.json({ pacing });
});

app.get("/v1/venues/:venueId/tables", async (c) => {
  const venueId = c.req.param("venueId");
  const tables = await listTables(db, venueId);
  return c.json({ tables });
});

app.post("/v1/venues/:venueId/tables", async (c) => {
  const venueId = c.req.param("venueId");
  const body = await c.req.json();
  if (
    typeof body.id !== "string" ||
    body.id === "" ||
    typeof body.name !== "string" ||
    typeof body.seats !== "number" ||
    !Number.isInteger(body.seats) ||
    body.seats < 1
  ) {
    return error(c, "invalid_request", 400);
  }
  await upsertTable(db, venueId, {
    id: body.id,
    name: body.name,
    seats: body.seats,
    zone: typeof body.zone === "string" ? body.zone : undefined,
  });
  const tables = await listTables(db, venueId);
  return c.json({ tables });
});

app.delete("/v1/venues/:venueId/tables/:tableId", async (c) => {
  const venueId = c.req.param("venueId");
  const tableId = c.req.param("tableId");
  await deleteTable(db, venueId, tableId);
  const tables = await listTables(db, venueId);
  return c.json({ tables });
});

app.get("/v1/venues/:venueId/services", async (c) => {
  const venueId = c.req.param("venueId");
  const services = await listServices(db, venueId);
  return c.json({ services });
});

app.post("/v1/venues/:venueId/services", async (c) => {
  const venueId = c.req.param("venueId");
  const body = await c.req.json();
  if (
    typeof body.name !== "string" ||
    body.name === "" ||
    typeof body.openStart !== "string" ||
    typeof body.openEnd !== "string"
  ) {
    return error(c, "invalid_request", 400);
  }
  await upsertService(db, venueId, {
    name: body.name,
    openStart: body.openStart,
    openEnd: body.openEnd,
  });
  const services = await listServices(db, venueId);
  return c.json({ services });
});

app.delete("/v1/venues/:venueId/services/:name", async (c) => {
  const venueId = c.req.param("venueId");
  const name = c.req.param("name");
  await deleteService(db, venueId, name);
  const services = await listServices(db, venueId);
  return c.json({ services });
});

app.get("/v1/venues/:venueId/keys", async (c) => {
  if (c.get("role") !== "admin") return error(c, "forbidden", 403);
  const venueId = c.req.param("venueId");
  const keys = await listVenueKeys(db, venueId);
  return c.json({ keys });
});

app.post("/v1/venues/:venueId/keys", async (c) => {
  if (c.get("role") !== "admin") return error(c, "forbidden", 403);
  const venueId = c.req.param("venueId");
  const body = await c.req.json();
  if (
    typeof body.key !== "string" ||
    body.key === "" ||
    typeof body.principal !== "string" ||
    body.principal === "" ||
    (body.role !== "read" && body.role !== "write")
  ) {
    return error(c, "invalid_request", 400);
  }
  await addVenueKey(db, venueId, body.key, body.principal, body.role);
  const keys = await listVenueKeys(db, venueId);
  return c.json({ keys }, 201);
});

app.delete("/v1/venues/:venueId/keys", async (c) => {
  if (c.get("role") !== "admin") return error(c, "forbidden", 403);
  const venueId = c.req.param("venueId");
  const body = await c.req.json();
  if (typeof body.hash !== "string") return error(c, "invalid_request", 400);
  await revokeVenueKey(db, venueId, body.hash);
  const keys = await listVenueKeys(db, venueId);
  return c.json({ keys });
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
    zone: reservation.zone,
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

app.get("/v1/venues/:venueId/config", async (c) => {
  const venueId = c.req.param("venueId");
  const config = await getConfig(db, venueId);
  if (!config) return mapError(c, "venue_not_found");
  return c.json(config);
});

app.put("/v1/venues/:venueId/config", async (c) => {
  const venueId = c.req.param("venueId");
  const body = await c.req.json();
  const result = await setConfig(db, venueId, {
    enabled: body.enabled,
    noticeAddress: body.noticeAddress,
    notificationsEnabled: typeof body.notificationsEnabled === "boolean" ? body.notificationsEnabled : undefined,
    resendApiKey: typeof body.resendApiKey === "string" ? body.resendApiKey : undefined,
    fromEmail: typeof body.fromEmail === "string" ? body.fromEmail : undefined,
    slotIntervalMinutes: isPosInt(body.slotIntervalMinutes) ? body.slotIntervalMinutes : undefined,
    leadTimeMinutes: isPosInt(body.leadTimeMinutes) ? body.leadTimeMinutes : undefined,
    lastSeatingOffsetMinutes: isPosInt(body.lastSeatingOffsetMinutes)
      ? body.lastSeatingOffsetMinutes
      : undefined,
  });
  if (!result.ok) return mapError(c, result.code);
  return c.json(result.config);
});

app.post("/v1/venues/:venueId/erasure", async (c) => {
  const venueId = c.req.param("venueId");
  const body = await c.req.json();
  const result = await erase(db, venueId, body.guestId, body.principal);
  return c.json(result);
});

async function sessionUser(c: any) {
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!result) return null;
  return result.user ?? null;
}

async function authorizeAdmin(c: any): Promise<{ principal: string } | Response> {
  const key = c.req.header("apikey");
  if (!key) return error(c, "unauthorized", 401);
  const admin = await authenticateAdmin(db, key);
  if (!admin.ok) {
    return admin.reason === "unauthorized"
      ? error(c, "unauthorized", 401)
      : error(c, "forbidden", 403);
  }
  return { principal: admin.principal };
}

function isRole(value: unknown): value is "read" | "write" | "admin" {
  return value === "read" || value === "write" || value === "admin";
}

function isPosInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export default app;
