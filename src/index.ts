import type { Env } from "./env";
import type { AuthResult, Role } from "./auth";
import type {
  CreateReservationInput,
  ModifyReservationInput,
  Reservation,
  WriteResult,
} from "./venue";

export { Venue } from "./venue";
export { Auth } from "./auth";

const DEFAULT_DURATION_MINUTES = 120;

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch {
      return errorResponse("transient", 500);
    }
  },
};

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return Response.json({ ok: true, service: "opencovers" });
  }

  if (url.pathname.startsWith("/v1/auth/")) {
    return handleAuthAdmin(request, env, url);
  }

  const venueMatch = url.pathname.match(/^\/v1\/venues\/([^/]+)(?:\/|$)/);
  if (!venueMatch) return new Response("not found", { status: 404 });
  const auth = await authenticate(env, request, venueMatch[1]);
  if (!auth.ok) {
    return auth.reason === "unauthorized"
      ? errorResponse("unauthorized", 401)
      : errorResponse("venue_not_found", 404);
  }

  const isWrite = request.method === "POST" || request.method === "PUT";
  if (isWrite && auth.role === "read") {
    return errorResponse("forbidden", 403);
  }

  const method = request.method;

  if (method === "POST") {
    const create = url.pathname.match(/^\/v1\/venues\/([^/]+)\/reservations$/);
    if (create) return handleCreate(request, env, create[1], auth.principal);

    const modify = url.pathname.match(
      /^\/v1\/venues\/([^/]+)\/reservations\/([^/]+)\/modify$/,
    );
    if (modify) return handleModify(request, env, modify[1], modify[2]);

    const cancel = url.pathname.match(
      /^\/v1\/venues\/([^/]+)\/reservations\/([^/]+)\/cancel$/,
    );
    if (cancel) return handleCancel(request, env, cancel[1], cancel[2]);

    const status = url.pathname.match(
      /^\/v1\/venues\/([^/]+)\/reservations\/([^/]+)\/status$/,
    );
    if (status) return handleStatus(request, env, status[1], status[2]);

    const erasure = url.pathname.match(/^\/v1\/venues\/([^/]+)\/erasure$/);
    if (erasure) return handleErasure(request, env, erasure[1]);
  }

  if (method === "PUT") {
    const config = url.pathname.match(/^\/v1\/venues\/([^/]+)\/config$/);
    if (config) return handleSetConfig(request, env, config[1]);
  }

  if (method === "GET") {
    const search = url.pathname.match(
      /^\/v1\/venues\/([^/]+)\/reservations\/search$/,
    );
    if (search) return handleSearch(env, search[1], url);

    const get = url.pathname.match(
      /^\/v1\/venues\/([^/]+)\/reservations\/([^/]+)$/,
    );
    if (get) return handleGet(env, get[1], get[2]);

    const list = url.pathname.match(/^\/v1\/venues\/([^/]+)\/reservations$/);
    if (list) return handleList(env, list[1], url);

    const agenda = url.pathname.match(/^\/v1\/venues\/([^/]+)\/agenda$/);
    if (agenda) return handleAgenda(env, agenda[1], url);

    const events = url.pathname.match(/^\/v1\/venues\/([^/]+)\/events$/);
    if (events) return handleEvents(env, events[1], url);

    const config = url.pathname.match(/^\/v1\/venues\/([^/]+)\/config$/);
    if (config) return handleGetConfig(env, config[1]);

    const availability = url.pathname.match(/^\/v1\/venues\/([^/]+)\/availability$/);
    if (availability) return handleAvailability(env, availability[1], url);
  }

  return new Response("not found", { status: 404 });
}

async function handleCreate(
  request: Request,
  env: Env,
  venueId: string,
  principal: string,
): Promise<Response> {
  const key = request.headers.get("Idempotency-Key");
  if (!key) return errorResponse("invalid_request", 400);
  const body = await readJson(request);
  if (
    !body ||
    typeof body.date !== "string" ||
    typeof body.time !== "string" ||
    typeof body.partySize !== "number" ||
    !Array.isArray(body.tables) ||
    body.tables.length === 0
  ) {
    return errorResponse("invalid_request", 400);
  }

  const input: CreateReservationInput = {
    date: body.date,
    time: body.time,
    durationMinutes: DEFAULT_DURATION_MINUTES,
    partySize: body.partySize,
    tableIds: body.tables,
    guestName: body.guest?.name,
    guestContact: body.guest?.contact,
    bookedVia: principal,
    basis: "service",
    ownerPrincipal: principal,
  };

  const stub = venueStub(env, venueId);
  const result = await stub.createReservation(input, key);
  return writeResponse(result, env, venueId);
}

async function handleModify(
  request: Request,
  env: Env,
  venueId: string,
  reservationId: string,
): Promise<Response> {
  const key = request.headers.get("Idempotency-Key");
  if (!key) return errorResponse("invalid_request", 400);
  const body = await readJson(request);
  if (!body || typeof body !== "object" || Object.keys(body).length === 0) {
    return errorResponse("invalid_request", 400);
  }

  const input: ModifyReservationInput = {
    partySize: body.partySize,
    tableIds: body.tables,
  };

  const stub = venueStub(env, venueId);
  const result = await stub.modifyReservation(reservationId, input, key);
  return writeResponse(result, env, venueId);
}

async function handleCancel(
  request: Request,
  env: Env,
  venueId: string,
  reservationId: string,
): Promise<Response> {
  const key = request.headers.get("Idempotency-Key");
  if (!key) return errorResponse("invalid_request", 400);

  const stub = venueStub(env, venueId);
  const result = await stub.cancelReservation(reservationId, key);
  if (!result.ok) return mapError(result.code);
  const reservation = await stub.getReservation(reservationId);
  if (!reservation) return mapError("reservation_not_found");
  return Response.json(toApi(reservation, venueId), { status: 200 });
}

async function handleStatus(
  request: Request,
  env: Env,
  venueId: string,
  reservationId: string,
): Promise<Response> {
  const key = request.headers.get("Idempotency-Key");
  if (!key) return errorResponse("invalid_request", 400);
  const body = await readJson(request);
  if (
    !body ||
    (body.status !== "seated" &&
      body.status !== "attended" &&
      body.status !== "no_show")
  ) {
    return errorResponse("invalid_request", 400);
  }

  const stub = venueStub(env, venueId);
  const result = await stub.setStatus(reservationId, body.status, key);
  return writeResponse(result, env, venueId);
}

async function handleGet(
  env: Env,
  venueId: string,
  reservationId: string,
): Promise<Response> {
  const reservation = await venueStub(env, venueId).getReservation(reservationId);
  if (!reservation) return mapError("reservation_not_found");
  return Response.json(toApi(reservation, venueId), { status: 200 });
}

async function handleList(env: Env, venueId: string, url: URL): Promise<Response> {
  return Response.json({ reservations: [] });
}

async function handleSearch(env: Env, venueId: string, url: URL): Promise<Response> {
  const dateStart = url.searchParams.get("dateStart");
  const dateEnd = url.searchParams.get("dateEnd");
  if (!dateStart || !dateEnd) return errorResponse("invalid_request", 400);
  const statuses = url.searchParams.getAll("status");
  const reservations = await venueStub(env, venueId).searchReservations(
    dateStart,
    dateEnd,
    statuses.length > 0 ? statuses : undefined,
  );
  return Response.json({ reservations: reservations.map((r) => toApi(r, venueId)) });
}

async function handleAgenda(env: Env, venueId: string, url: URL): Promise<Response> {
  const date = url.searchParams.get("date");
  if (!date) return errorResponse("invalid_request", 400);
  const reservations = await venueStub(env, venueId).listByDate(date);
  return Response.json({ reservations: reservations.map((r) => toApi(r, venueId)) });
}

async function handleEvents(env: Env, venueId: string, url: URL): Promise<Response> {
  const cursor = url.searchParams.get("cursor");
  let afterId = 0;
  if (cursor) {
    const prefix = `${venueId}:`;
    if (!cursor.startsWith(prefix)) return mapError("invalid_request");
    afterId = parseInt(cursor.slice(prefix.length), 10);
    if (Number.isNaN(afterId)) return mapError("invalid_request");
  }
  const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
  const result = await venueStub(env, venueId).getEvents(afterId, limit);
  if (!result.ok) return mapError(result.code);
  const events = result.events;
  const lastId = events.length > 0 ? events[events.length - 1].id : afterId;
  return Response.json({
    events: events.map((e) => ({ ...e, id: String(e.id) })),
    nextCursor: `${venueId}:${lastId}`,
  });
}

async function handleGetConfig(env: Env, venueId: string): Promise<Response> {
  const config = await venueStub(env, venueId).getConfig();
  return Response.json(config, { status: 200 });
}

async function handleSetConfig(
  request: Request,
  env: Env,
  venueId: string,
): Promise<Response> {
  const key = request.headers.get("Idempotency-Key");
  if (!key) return errorResponse("invalid_request", 400);
  const body = await readJson(request);
  if (!body || typeof body !== "object") return errorResponse("invalid_request", 400);
  const result = await venueStub(env, venueId).setConfig({
    enabled: body.enabled,
    noticeAddress: body.noticeAddress,
  });
  if (!result.ok) return mapError(result.code);
  return Response.json(result.config, { status: 200 });
}

async function handleAvailability(
  env: Env,
  venueId: string,
  url: URL,
): Promise<Response> {
  const date = url.searchParams.get("date");
  const partySizeRaw = url.searchParams.get("partySize");
  if (!date || !partySizeRaw) return errorResponse("invalid_request", 400);
  const partySize = parseInt(partySizeRaw, 10);
  if (Number.isNaN(partySize)) return errorResponse("invalid_request", 400);
  const availability = await venueStub(env, venueId).getAvailability(date, partySize);
  return Response.json({ availability });
}

async function handleErasure(
  request: Request,
  env: Env,
  venueId: string,
): Promise<Response> {
  const key = request.headers.get("Idempotency-Key");
  if (!key) return errorResponse("invalid_request", 400);
  const body = await readJson(request);
  if (!body || (body.guestId === undefined && body.principal === undefined)) {
    return errorResponse("invalid_request", 400);
  }
  const result = await venueStub(env, venueId).erase(body.guestId, body.principal);
  return Response.json(result, { status: 200 });
}

function venueStub(env: Env, venueId: string) {
  const ns = env.VENUE_JURISDICTION
    ? env.VENUE.jurisdiction(env.VENUE_JURISDICTION as DurableObjectJurisdiction)
    : env.VENUE;
  const id = ns.idFromName(venueId);
  return ns.get(id);
}

function authStub(env: Env) {
  const id = env.AUTH.idFromName("global");
  return env.AUTH.get(id);
}

async function authenticate(
  env: Env,
  request: Request,
  venueId: string,
): Promise<AuthResult> {
  const key = request.headers.get("apikey");
  if (!key) return { ok: false, reason: "unauthorized" };
  return authStub(env).authenticate(key, venueId);
}

async function handleAuthAdmin(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const key = request.headers.get("apikey");
  if (!key) return errorResponse("unauthorized", 401);
  const admin = await authStub(env).authenticateAdmin(key);
  if (!admin.ok) {
    return admin.reason === "unauthorized"
      ? errorResponse("unauthorized", 401)
      : errorResponse("forbidden", 403);
  }

  if (url.pathname !== "/v1/auth/keys") {
    return new Response("not found", { status: 404 });
  }

  if (request.method === "GET") {
    const keys = await authStub(env).listKeys();
    return Response.json({ keys });
  }

  if (request.method === "POST") {
    const body = await readJson(request);
    if (
      !body ||
      typeof body.key !== "string" ||
      typeof body.principal !== "string" ||
      !isRole(body.role)
    ) {
      return errorResponse("invalid_request", 400);
    }
    const venues = body.venues === undefined ? ["*"] : body.venues;
    if (!Array.isArray(venues) || venues.some((v) => typeof v !== "string")) {
      return errorResponse("invalid_request", 400);
    }
    await authStub(env).addKey(body.key, body.principal, venues, body.role);
    return Response.json({ ok: true });
  }

  if (request.method === "DELETE") {
    const body = await readJson(request);
    if (!body || typeof body.key !== "string") {
      return errorResponse("invalid_request", 400);
    }
    await authStub(env).revokeKey(body.key);
    return Response.json({ ok: true });
  }

  return new Response("not found", { status: 404 });
}

function isRole(value: unknown): value is Role {
  return value === "read" || value === "write" || value === "admin";
}

async function writeResponse(
  result: WriteResult,
  env: Env,
  venueId: string,
): Promise<Response> {
  if (!result.ok) return mapError(result.code);
  const reservation = await venueStub(env, venueId).getReservation(result.id);
  if (!reservation) return mapError("reservation_not_found");
  return Response.json(toApi(reservation, venueId), { status: 200 });
}

function toApi(reservation: Reservation, venueId: string) {
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

function mapError(code: string): Response {
  const status = HTTP_STATUS[code] ?? 400;
  return errorResponse(code, status);
}

function errorResponse(code: string, status: number): Response {
  return Response.json({ code, message: code }, { status });
}

async function readJson(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
