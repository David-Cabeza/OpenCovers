import { Hono, type MiddlewareHandler } from "hono";
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
import {
  AUDIT_DEFAULT_LIMIT,
  AUDIT_MAX_LIMIT,
  decodeAuditCursor,
  encodeAuditCursor,
  listMembershipAudit,
} from "./lib/membership-audit";
import { auth } from "./lib/auth";
import {
  addToBlocklist,
  BLOCKLIST_DEFAULT_LIMIT,
  BLOCKLIST_MAX_LIMIT,
  blocklistKeys,
  decodeBlocklistCursor,
  encodeBlocklistCursor,
  lookupBlocklist,
  pageBlocklist,
  parseBlocklistReason,
  parseBlocklistSubject,
  removeFromBlocklist,
  type BlocklistCursor,
} from "./lib/blocklist";
import {
  createInvitation,
  isExpiryHours,
  isInvitationEmail,
  listInvitations,
  redeemInvitation,
  revokeInvitation,
} from "./lib/invitations";
import { createRateLimiter, rateLimitConfigFromEnv } from "./lib/rate-limit";
import { findKey } from "./lib/idempotency";
import {
  guestView,
  isDate as isPublicDate,
  isPublicIdempotencyKey,
  parsePublicCreate,
  parseSelfServiceModify,
  publicConfig,
  publicVenueOf,
  resolveBookingKey,
  rulesOf,
  storedKey,
} from "./lib/public-booking";
import { challengeConfigFromEnv, createChallengeVerifier, issueChallenge } from "./lib/public-challenge";
import { findLink, reissueLink, type Link } from "./lib/self-service";
import { getMembership, listVenuesForUser } from "./lib/memberships";
import { isCreator, mayCreateVenue, signupMode, transferCreator } from "./lib/signup";
import { changeMemberRole, listMembers, removeMember } from "./lib/members";
import {
  deleteService,
  deleteTable,
  listServices,
  parseDays,
  listTables,
  updateTableLayout,
  upsertService,
  upsertTable,
} from "./lib/catalog";
import {
  cancelReservation,
  createReservation,
  explainSlot,
  getAvailability,
  publicTimes,
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
import { isConsent } from "./lib/consent";
import { isCommentary } from "./lib/commentary";
import { isRating } from "./lib/rating";
import { isReconfirmation } from "./lib/reconfirmation";
import { createVenue, erase, getConfig, setConfig } from "./lib/venue";
import { getOnlineBooking, parseOnlineBookingInput, rotateBookingKey, setOnlineBooking } from "./lib/online-booking";
import {
  etagMatches,
  etagOf,
  getJsonLd,
  getProfile,
  parseProfileInput,
  setProfile,
} from "./lib/public-profile";
import {
  decodeGuestCursor,
  encodeGuestCursor,
  getGuest,
  listGuests,
  mergeGuest,
  unmergeGuest,
  type GuestCursor,
  type GuestWrite,
} from "./lib/guests";
import { toCountryCode } from "./lib/contact";
import { isMaxActivePerGuest, isMaxAdvanceDays, parseBlockedDates } from "./lib/booking-policy";
import { parseTurnTimes } from "./lib/turn-times";
import { notifyReservation } from "./lib/notifications";
import {
  addFloorItem,
  deleteFloorItem,
  listFloorItems,
  updateFloorItemLayout,
} from "./lib/floor-items";
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  webhookPolicyFromEnv,
} from "./lib/webhooks";
import { ERRORS, errorBody, type ErrorCode } from "./lib/errors";
import {
  addWaitlist,
  cancelWaitlist,
  listWaitlist,
  seatWaitlist,
} from "./lib/waitlist";

type AppEnv = {
  Variables: {
    principal: string;
    role: string;
  };
};

const app = new Hono<AppEnv>();
const challengeConfig = challengeConfigFromEnv();

// Above the limiter, so its 429 is not cached either (ADR-0017).
app.use("/v1/public/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

app.use("*", createRateLimiter(rateLimitConfigFromEnv()).middleware);

app.get("/health", (c) => c.json({ ok: true, service: "opencovers" }));

app.all("/api/auth/*", (c) => auth.handler(c.req.raw));

// Public and unauthenticated by design (ADR-0012). It must stay above the
// venue auth middleware below. GET is not rate limited (ADR-0007).
const NOT_FOUND_BODY = JSON.stringify(errorBody("venue_not_found"));

app.options("/v1/venues/:venueId/public.jsonld", (c) =>
  c.body(null, 204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Max-Age": "86400",
  }),
);

app.get("/v1/venues/:venueId/public.jsonld", async (c) => {
  const doc = await getJsonLd(db, c.req.param("venueId"));
  if (!doc) {
    return c.body(NOT_FOUND_BODY, 404, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60",
    });
  }
  const body = JSON.stringify(doc);
  const etag = etagOf(body);
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300",
    ETag: etag,
    Vary: "Accept-Encoding",
  };
  if (etagMatches(c.req.header("if-none-match"), etag)) return c.body(null, 304, headers);
  return c.body(body, 200, { ...headers, "Content-Type": "application/ld+json; charset=utf-8" });
});

// The guest channel of ADR-0017. No credentials, no cookie, no session, no CORS: the widget calls these
// from its own origin, which proxies /v1/public to the API. A guest is not a principal.
const challenges = createChallengeVerifier(challengeConfig);

// Self-service routes come before `/v1/public/:bookingKey`, which would otherwise read `self-service` as a key.
// The token names one reservation of one venue, so these routes take neither id.
const selfServiceToken = (c: any) => c.req.header("X-Self-Service-Token") as string | undefined;

async function guestAnswer(c: any, link: Link) {
  const target = await publicVenueOf(db, link.venueId);
  const view = target && (await guestView(db, target, link.reservationId));
  return view ? c.json(view) : error(c, "self_service_link_invalid");
}

app.get("/v1/public/self-service", async (c) => {
  const link = await findLink(db, selfServiceToken(c));
  if (!link || link.revokedAt) return error(c, "self_service_link_invalid");
  return guestAnswer(c, link);
});

app.post("/v1/public/self-service/modify", async (c) => {
  const key = c.req.header("Idempotency-Key");
  const input = parseSelfServiceModify(await c.req.json().catch(() => null));
  if (!isPublicIdempotencyKey(key) || !input) return error(c, "invalid_request");
  const link = await findLink(db, selfServiceToken(c));
  if (!link || link.revokedAt) return error(c, "self_service_link_invalid");
  const target = await publicVenueOf(db, link.venueId);
  if (!target) return error(c, "self_service_link_invalid");
  const { settings } = target;
  const result = await modifyReservation(
    db,
    link.venueId,
    link.reservationId,
    {
      partySize: input.partySize,
      commentary: input.commentary,
      consent: settings.askConsent ? input.consent : undefined,
      selfService: {
        linkId: link.id,
        cutoffMinutes: settings.selfServiceCutoffMinutes,
        version: input.version,
        rules: rulesOf(settings),
      },
    },
    storedKey(key),
  );
  if (!result.ok) return error(c, result.code);
  if (input.partySize !== undefined) {
    void notifyReservation(db, link.venueId, link.reservationId, result.version, "confirmation");
  }
  return guestAnswer(c, link);
});

app.post("/v1/public/self-service/cancel", async (c) => {
  const key = c.req.header("Idempotency-Key");
  if (!isPublicIdempotencyKey(key)) return error(c, "invalid_request");
  const link = await findLink(db, selfServiceToken(c));
  // A revoked link answers only a repeat of the cancel that revoked it (ADR-0017, amendment of 2026-11-17).
  if (!link || (link.revokedAt && link.cancelKey !== storedKey(key))) return error(c, "self_service_link_invalid");
  const target = await publicVenueOf(db, link.venueId);
  if (!target) return error(c, "self_service_link_invalid");
  const result = await cancelReservation(db, link.venueId, link.reservationId, storedKey(key), {
    linkId: link.id,
    cutoffMinutes: target.settings.selfServiceCutoffMinutes,
  });
  if (!result.ok) return error(c, result.code);
  const view = await guestView(db, target, link.reservationId);
  if (!view) return error(c, "self_service_link_invalid");
  if (!link.revokedAt) void notifyReservation(db, link.venueId, link.reservationId, view.version, "cancellation");
  return c.json(view);
});

app.get("/v1/public/:bookingKey", async (c) => {
  const bookingKey = c.req.param("bookingKey");
  const target = await resolveBookingKey(db, bookingKey);
  if (!target) return error(c, "venue_not_found");
  return c.json(await publicConfig(db, target, issueChallenge(challengeConfig, bookingKey)));
});

app.get("/v1/public/:bookingKey/availability", async (c) => {
  const target = await resolveBookingKey(db, c.req.param("bookingKey"));
  if (!target) return error(c, "venue_not_found");
  const date = c.req.query("date");
  const rawParty = c.req.query("partySize") ?? "";
  if (!isPublicDate(date) || !/^[1-9]\d{0,5}$/.test(rawParty)) return error(c, "invalid_request");
  const partySize = Number(rawParty);
  const times = await publicTimes(db, target.venue.id, date, partySize, rulesOf(target.settings));
  return c.json({ date, partySize, times });
});

app.post("/v1/public/:bookingKey/reservations", async (c) => {
  const bookingKey = c.req.param("bookingKey");
  const target = await resolveBookingKey(db, bookingKey);
  if (!target) return error(c, "venue_not_found");
  const key = c.req.header("Idempotency-Key");
  if (!isPublicIdempotencyKey(key)) return error(c, "invalid_request");
  const input = parsePublicCreate(await c.req.json().catch(() => null), target);
  if (!input) return error(c, "invalid_request");
  const venueId = target.venue.id;
  const replay = await findKey(db, venueId, storedKey(key));
  if (!replay && !challenges.verify(bookingKey, input.challenge, input.solution, key)) {
    return error(c, "invalid_request");
  }
  const result = await createReservation(
    db,
    venueId,
    {
      date: input.date,
      time: input.time,
      partySize: input.partySize,
      guestName: input.name,
      guestContact: input.contact,
      consent: input.consent,
      commentary: input.commentary,
      bookedVia: "widget",
      basis: "service",
      ownerPrincipal: "widget",
      channel: { kind: "public", rules: rulesOf(target.settings) },
    },
    storedKey(key),
  );
  if (!result.ok) return error(c, result.code);
  if (!replay) {
    void notifyReservation(db, venueId, result.id, result.version, "confirmation");
    void notifyReservation(db, venueId, result.id, result.version, "notice");
  }
  const reservation = await guestView(db, target, result.id);
  if (!reservation) return error(c, "reservation_not_found");
  return c.json({ reservation, selfServiceToken: result.selfServiceToken ?? null });
});

app.use("/v1/venues/:venueId/*", async (c, next) => {
  const venueId = c.req.param("venueId");
  const key = c.req.header("apikey");

  let principal: string;
  let role: string;

  if (key) {
    const result = await authenticate(db, key, venueId);
    if (!result.ok) {
      return result.reason === "unauthorized"
        ? error(c, "unauthorized")
        : error(c, "venue_not_found");
    }
    principal = result.principal;
    role = result.role;
  } else {
    const user = await sessionUser(c);
    if (!user) return error(c, "unauthorized");
    const membership = await getMembership(db, user.id, venueId);
    if (!membership) return error(c, "venue_not_found");
    principal = user.email;
    role = membership.role;
  }

  const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method);
  if (isWrite && role === "read") {
    return error(c, "forbidden");
  }
  c.set("principal", principal);
  c.set("role", role);
  await next();
});

const adminOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("role") !== "admin") return error(c, "forbidden");
  await next();
};

app.get("/v1/venues", async (c) => {
  const user = await sessionUser(c);
  if (!user) return error(c, "unauthorized");
  const venues = await listVenuesForUser(db, user.id);
  return c.json({ venues });
});

app.get("/v1/account", async (c) => {
  if (c.req.header("apikey")) return error(c, "forbidden");
  const user = await sessionUser(c);
  if (!user) return error(c, "unauthorized");
  return c.json({ account: { userId: user.id, isCreator: await isCreator(db, user.id) } });
});

app.post("/v1/account/transfer-creator", async (c) => {
  if (c.req.header("apikey")) return error(c, "forbidden");
  const user = await sessionUser(c);
  if (!user) return error(c, "unauthorized");
  const body = await c.req.json().catch(() => null);
  if (typeof body?.userId !== "string" || body.userId === "") return error(c, "invalid_request");
  const result = await transferCreator(db, user.id, body.userId);
  if (!result.ok) return error(c, result.code);
  return c.json({ creator: result.creator });
});

app.post("/v1/venues", async (c) => {
  const user = await sessionUser(c);
  if (!user) return error(c, "unauthorized");
  if (!(await mayCreateVenue(db, signupMode(), user.id))) {
    return error(c, "venue_creation_closed");
  }
  const body = await c.req.json();
  if (typeof body.name !== "string" || body.name.trim() === "") {
    return error(c, "invalid_request");
  }
  const { id } = await createVenue(db, user.id, {
    id: typeof body.id === "string" ? body.id : undefined,
    name: body.name,
    timezone: typeof body.timezone === "string" ? body.timezone : undefined,
  });
  return c.json({ venue: { id, name: body.name } }, 201);
});

const staffSessionOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.header("apikey")) return error(c, "forbidden");
  await next();
};

app.get("/v1/venues/:venueId/invitations", adminOnly, staffSessionOnly, async (c) => {
  const invitations = await listInvitations(db, c.req.param("venueId"));
  return c.json({ invitations });
});

app.post("/v1/venues/:venueId/invitations", adminOnly, staffSessionOnly, async (c) => {
  const user = await sessionUser(c);
  if (!user) return error(c, "unauthorized");
  const body = await c.req.json().catch(() => null);
  if (
    !isRole(body?.role) ||
    (body.email !== undefined && !isInvitationEmail(body.email)) ||
    (body.expiresInHours !== undefined && !isExpiryHours(body.expiresInHours))
  ) {
    return error(c, "invalid_request");
  }
  const { invitation, token } = await createInvitation(db, c.req.param("venueId"), user.id, {
    role: body.role,
    email: body.email,
    expiresInHours: body.expiresInHours,
  });
  return c.json({ invitation: { ...invitation, token } }, 201);
});

app.delete("/v1/venues/:venueId/invitations/:invitationId", adminOnly, staffSessionOnly, async (c) => {
  const user = await sessionUser(c);
  if (!user) return error(c, "unauthorized");
  const result = await revokeInvitation(
    db,
    c.req.param("venueId"),
    c.req.param("invitationId"),
    user.id,
  );
  if (!result.ok) return error(c, result.code);
  return c.json({ invitation: result.invitation });
});

app.get("/v1/venues/:venueId/members", adminOnly, staffSessionOnly, async (c) => {
  const members = await listMembers(db, c.req.param("venueId"));
  return c.json({ members });
});

app.patch("/v1/venues/:venueId/members/:userId", adminOnly, staffSessionOnly, async (c) => {
  const user = await sessionUser(c);
  if (!user) return error(c, "unauthorized");
  const body = await c.req.json().catch(() => null);
  if (!isRole(body?.role)) return error(c, "invalid_request");
  const result = await changeMemberRole(
    db,
    c.req.param("venueId"),
    user.id,
    c.req.param("userId"),
    body.role,
  );
  if (!result.ok) return error(c, result.code);
  return c.json({ member: result.member });
});

app.delete("/v1/venues/:venueId/members/:userId", adminOnly, staffSessionOnly, async (c) => {
  const user = await sessionUser(c);
  if (!user) return error(c, "unauthorized");
  const result = await removeMember(db, c.req.param("venueId"), user.id, c.req.param("userId"));
  if (!result.ok) return error(c, result.code);
  return c.json({ member: result.member, revoked: result.revoked });
});

app.get("/v1/venues/:venueId/audit", adminOnly, async (c) => {
  const venueId = c.req.param("venueId");
  const limitRaw = c.req.query("limit") ?? String(AUDIT_DEFAULT_LIMIT);
  const limit = Number(limitRaw);
  if (!/^\d+$/.test(limitRaw) || limit < 1 || limit > AUDIT_MAX_LIMIT) {
    return error(c, "invalid_request");
  }
  const cursor = c.req.query("cursor");
  let after: number | undefined;
  if (cursor) {
    const decoded = decodeAuditCursor(venueId, cursor);
    if (decoded === null) return error(c, "invalid_request");
    after = decoded;
  }
  const page = await listMembershipAudit(db, venueId, { after, limit });
  return c.json({
    entries: page.entries,
    nextCursor: page.next === null ? null : encodeAuditCursor(venueId, page.next),
  });
});

// ADR-0018. A contact travels only in a request body, so these routes refuse
// any query parameter they do not define.
const queryOnly =
  (...allowed: string[]): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    if (Object.keys(c.req.queries()).some((name) => !allowed.includes(name))) {
      return error(c, "invalid_request");
    }
    await next();
  };

const BLOCKLIST = "/v1/venues/:venueId/blocklist";

app.get(BLOCKLIST, adminOnly, staffSessionOnly, queryOnly("limit", "cursor"), async (c) => {
  const venueId = c.req.param("venueId");
  const limitRaw = c.req.query("limit") ?? String(BLOCKLIST_DEFAULT_LIMIT);
  const limit = Number(limitRaw);
  if (!/^\d+$/.test(limitRaw) || limit < 1 || limit > BLOCKLIST_MAX_LIMIT) {
    return error(c, "invalid_request");
  }
  const cursor = c.req.query("cursor");
  let after: BlocklistCursor | undefined;
  if (cursor) {
    const decoded = decodeBlocklistCursor(venueId, cursor);
    if (!decoded) return error(c, "invalid_request");
    after = decoded;
  }
  const page = await pageBlocklist(db, blocklistKeys, venueId, { limit, after });
  if (!page.ok) return error(c, page.code);
  return c.json({
    entries: page.entries,
    nextCursor: page.next ? encodeBlocklistCursor(venueId, page.next) : null,
  });
});

app.post(BLOCKLIST, adminOnly, staffSessionOnly, queryOnly(), async (c) => {
  const user = await sessionUser(c);
  if (!user) return error(c, "unauthorized");
  const body = await c.req.json().catch(() => null);
  const subject = parseBlocklistSubject(body);
  const reason = parseBlocklistReason(body?.reason);
  if (!subject || reason === undefined) return error(c, "invalid_request");
  const result = await addToBlocklist(db, blocklistKeys, c.req.param("venueId"), user.id, subject, reason);
  if (!result.ok) return error(c, result.code);
  return c.json({ entries: result.entries, bookedReservations: result.bookedReservations });
});

app.post(`${BLOCKLIST}/lookup`, adminOnly, staffSessionOnly, queryOnly(), async (c) => {
  const subject = parseBlocklistSubject(await c.req.json().catch(() => null));
  if (!subject) return error(c, "invalid_request");
  const result = await lookupBlocklist(db, blocklistKeys, c.req.param("venueId"), subject);
  if (!result.ok) return error(c, result.code);
  return c.json({ entries: result.entries });
});

app.delete(`${BLOCKLIST}/:entryId`, adminOnly, staffSessionOnly, queryOnly(), async (c) => {
  const user = await sessionUser(c);
  if (!user) return error(c, "unauthorized");
  const result = await removeFromBlocklist(
    db,
    blocklistKeys,
    c.req.param("venueId"),
    user.id,
    c.req.param("entryId"),
  );
  if (!result.ok) return error(c, result.code);
  return c.json({ entry: result.entry });
});

app.post("/v1/invitations/redeem", async (c) => {
  const user = await sessionUser(c);
  if (!user) return error(c, "unauthorized");
  const body = await c.req.json().catch(() => null);
  if (typeof body?.token !== "string" || body.token === "") {
    return error(c, "invalid_request");
  }
  const membership = await redeemInvitation(db, body.token, user);
  if (!membership) return error(c, "invalid_invitation");
  return c.json({ membership });
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
    return error(c, "invalid_request");
  }
  const venues = body.venues === undefined ? ["*"] : body.venues;
  if (!Array.isArray(venues) || venues.some((v: unknown) => typeof v !== "string")) {
    return error(c, "invalid_request");
  }
  await addKey(db, body.key, body.principal, venues, body.role);
  return c.json({ ok: true });
});

app.delete("/v1/auth/keys", async (c) => {
  const admin = await authorizeAdmin(c);
  if (admin instanceof Response) return admin;
  const body = await c.req.json();
  if (typeof body.key !== "string") return error(c, "invalid_request");
  await revokeKey(db, body.key);
  return c.json({ ok: true });
});

app.post("/v1/venues/:venueId/reservations", async (c) => {
  const venueId = c.req.param("venueId");
  const key = c.req.header("Idempotency-Key");
  if (!key) return error(c, "invalid_request");
  const body = await c.req.json();
  if (
    hasInvalidConsent(body) ||
    hasInvalidRating(body) ||
    hasInvalidCommentary(body) ||
    hasInvalidReconfirmation(body)
  ) {
    return error(c, "invalid_request");
  }
  if (
    typeof body.date !== "string" ||
    typeof body.time !== "string" ||
    typeof body.partySize !== "number" ||
    (body.tables !== undefined &&
      (!Array.isArray(body.tables) ||
        body.tables.some((t: unknown) => typeof t !== "string")))
  ) {
    return error(c, "invalid_request");
  }
  const result = await createReservation(
    db,
    venueId,
    {
      date: body.date,
      time: body.time,
      partySize: body.partySize,
      tableIds: body.tables,
      zone: typeof body.zone === "string" ? body.zone : undefined,
      guestName: body.guest?.name,
      guestContact: body.guest?.contact,
      consent: body.guest?.consent,
      rating: body.rating,
      commentary: body.commentary,
      reconfirmation: body.reconfirmation,
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
  if (!key) return error(c, "invalid_request");
  const body = await c.req.json();
  if (typeof body.partySize !== "number") return error(c, "invalid_request");
  if (
    hasInvalidConsent(body) ||
    hasInvalidRating(body) ||
    hasInvalidCommentary(body) ||
    body.reconfirmation !== undefined
  ) {
    return error(c, "invalid_request");
  }
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
      consent: body.guest?.consent,
      rating: body.rating,
      commentary: body.commentary,
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
  if (typeof body.partySize !== "number") return error(c, "invalid_request");
  const result = await addWaitlist(
    db,
    venueId,
    {
      partySize: body.partySize,
      zone: typeof body.zone === "string" ? body.zone : undefined,
      guestName: body.guest?.name,
      guestContact: body.guest?.contact,
    },
    c.req.header("Idempotency-Key") || undefined,
  );
  if (!result.ok) return error(c, result.code);
  const entries = await listWaitlist(db, venueId);
  return c.json({ entries }, 201);
});

app.post("/v1/venues/:venueId/waitlist/:id/seat", async (c) => {
  const venueId = c.req.param("venueId");
  const id = c.req.param("id");
  const key = c.req.header("Idempotency-Key");
  if (!key) return error(c, "invalid_request");
  const result = await seatWaitlist(db, venueId, id, key);
  if (!result.ok) return error(c, result.code);
  const reservation = await getReservation(db, venueId, result.reservationId);
  if (!reservation) return error(c, "reservation_not_found");
  void notifyReservation(db, venueId, result.reservationId, reservation.version, "confirmation");
  void notifyReservation(db, venueId, result.reservationId, reservation.version, "notice");
  return c.json(toApi(reservation, venueId), 200);
});

app.post("/v1/venues/:venueId/waitlist/:id/cancel", async (c) => {
  const venueId = c.req.param("venueId");
  const id = c.req.param("id");
  const result = await cancelWaitlist(db, venueId, id, c.req.header("Idempotency-Key") || undefined);
  if (!result.ok) return error(c, result.code);
  const entries = await listWaitlist(db, venueId);
  return c.json({ entries });
});

app.post("/v1/venues/:venueId/reservations/:id/modify", async (c) => {
  const venueId = c.req.param("venueId");
  const id = c.req.param("id");
  const key = c.req.header("Idempotency-Key");
  if (!key) return error(c, "invalid_request");
  const body = await c.req.json();
  if (typeof body !== "object" || Object.keys(body).length === 0) {
    return error(c, "invalid_request");
  }
  if (
    hasInvalidConsent(body) ||
    hasInvalidRating(body) ||
    hasInvalidCommentary(body) ||
    hasInvalidReconfirmation(body)
  ) {
    return error(c, "invalid_request");
  }
  const result = await modifyReservation(
    db,
    venueId,
    id,
    { partySize: body.partySize, tableIds: body.tables, consent: body.guest?.consent, rating: body.rating, commentary: body.commentary, reconfirmation: body.reconfirmation },
    key,
  );
  if (result.ok && (body.partySize !== undefined || body.tables !== undefined)) {
    void notifyReservation(db, venueId, result.id, result.version, "confirmation");
  }
  return writeResponse(c, result, venueId);
});

app.post("/v1/venues/:venueId/reservations/:id/cancel", async (c) => {
  const venueId = c.req.param("venueId");
  const id = c.req.param("id");
  const key = c.req.header("Idempotency-Key");
  if (!key) return error(c, "invalid_request");
  const result = await cancelReservation(db, venueId, id, key);
  if (!result.ok) return error(c, result.code);
  const reservation = await getReservation(db, venueId, id);
  if (!reservation) return error(c, "reservation_not_found");
  void notifyReservation(db, venueId, id, reservation.version, "cancellation");
  return c.json(toApi(reservation, venueId), 200);
});

// The only staff route that returns a self-service token (ADR-0017). The read role is refused by the middleware.
app.post("/v1/venues/:venueId/reservations/:id/self-service-link", async (c) => {
  c.header("Cache-Control", "no-store");
  const key = c.req.header("Idempotency-Key");
  if (!key) return error(c, "invalid_request");
  const result = await reissueLink(db, c.req.param("venueId"), c.req.param("id"), key);
  if (!result.ok) return error(c, result.code);
  return c.json({ selfServiceToken: result.link.token, linkExpiresAt: result.link.expiresAt.toISOString() });
});

app.post("/v1/venues/:venueId/reservations/:id/status", async (c) => {
  const venueId = c.req.param("venueId");
  const id = c.req.param("id");
  const key = c.req.header("Idempotency-Key");
  if (!key) return error(c, "invalid_request");
  const body = await c.req.json();
  if (body.status !== "seated" && body.status !== "attended" && body.status !== "no_show") {
    return error(c, "invalid_request");
  }
  const result = await setStatus(db, venueId, id, body.status, key);
  return writeResponse(c, result, venueId);
});

app.get("/v1/venues/:venueId/reservations/search", async (c) => {
  const venueId = c.req.param("venueId");
  const dateStart = c.req.query("dateStart");
  const dateEnd = c.req.query("dateEnd");
  if (!dateStart || !dateEnd) return error(c, "invalid_request");
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
  if (!reservation) return error(c, "reservation_not_found");
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
  if (!date) return error(c, "invalid_request");
  const reservations = await listByDate(db, venueId, date);
  return c.json({ reservations: reservations.map((r) => toApi(r, venueId)) });
});

app.get("/v1/venues/:venueId/events", async (c) => {
  const venueId = c.req.param("venueId");
  const cursor = c.req.query("cursor");
  let afterId = 0;
  if (cursor) {
    const prefix = `${venueId}:`;
    if (!cursor.startsWith(prefix)) return error(c, "invalid_request");
    afterId = parseInt(cursor.slice(prefix.length), 10);
    if (Number.isNaN(afterId)) return error(c, "invalid_request");
  }
  const limit = parseInt(c.req.query("limit") ?? "100", 10);
  const watermark = await getEventsWatermark(db, venueId);
  if (afterId > 0 && watermark > 0 && afterId < watermark) {
    return error(c, "expired_cursor");
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
  if (!date || !partySizeRaw) return error(c, "invalid_request");
  const partySize = parseInt(partySizeRaw, 10);
  if (Number.isNaN(partySize)) return error(c, "invalid_request");
  const availability = await getAvailability(db, venueId, date, partySize);
  return c.json({ availability });
});

app.get("/v1/venues/:venueId/availability/explain", async (c) => {
  const venueId = c.req.param("venueId");
  const date = c.req.query("date") ?? "";
  const time = c.req.query("time") ?? "";
  const partySizeRaw = c.req.query("partySize") ?? "";
  const zone = c.req.query("zone");
  if (!isDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !/^[1-9]\d*$/.test(partySizeRaw)) {
    return error(c, "invalid_request");
  }
  const explanation = await explainSlot(db, venueId, {
    date,
    time,
    partySize: Number(partySizeRaw),
    zone: zone || undefined,
  });
  if (!explanation) return error(c, "venue_not_found");
  return c.json(explanation);
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
  if (!date) return error(c, "invalid_request");
  const pacing = await getPacing(db, venueId, date);
  return c.json({ pacing });
});

app.get("/v1/venues/:venueId/floor-items", async (c) => {
  const venueId = c.req.param("venueId");
  const items = await listFloorItems(db, venueId);
  return c.json({ items });
});

app.post("/v1/venues/:venueId/floor-items", adminOnly, async (c) => {
  const venueId = c.req.param("venueId");
  const body = await c.req.json();
  if (typeof body.type !== "string" || body.type === "") {
    return error(c, "invalid_request");
  }
  const item = await addFloorItem(db, venueId, {
    type: body.type,
    label: typeof body.label === "string" ? body.label : undefined,
    posX: typeof body.posX === "number" ? body.posX : undefined,
    posY: typeof body.posY === "number" ? body.posY : undefined,
    width: typeof body.width === "number" ? body.width : undefined,
    height: typeof body.height === "number" ? body.height : undefined,
  });
  const items = await listFloorItems(db, venueId);
  return c.json({ items, item }, 201);
});

app.delete("/v1/venues/:venueId/floor-items/:itemId", adminOnly, async (c) => {
  const venueId = c.req.param("venueId");
  const itemId = c.req.param("itemId");
  await deleteFloorItem(db, venueId, itemId);
  const items = await listFloorItems(db, venueId);
  return c.json({ items });
});

app.patch("/v1/venues/:venueId/floor-items/:itemId", adminOnly, async (c) => {
  const venueId = c.req.param("venueId");
  const itemId = c.req.param("itemId");
  const body = await c.req.json();
  await updateFloorItemLayout(db, venueId, itemId, {
    x: typeof body.x === "number" ? body.x : undefined,
    y: typeof body.y === "number" ? body.y : undefined,
    rotation: typeof body.rotation === "number" ? body.rotation : undefined,
    width: typeof body.width === "number" ? body.width : undefined,
    height: typeof body.height === "number" ? body.height : undefined,
  });
  const items = await listFloorItems(db, venueId);
  return c.json({ items });
});

app.get("/v1/venues/:venueId/tables", async (c) => {
  const venueId = c.req.param("venueId");
  const tables = await listTables(db, venueId);
  return c.json({ tables });
});

app.post("/v1/venues/:venueId/tables", adminOnly, async (c) => {
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
    return error(c, "invalid_request");
  }
  await upsertTable(db, venueId, {
    id: body.id,
    name: body.name,
    seats: body.seats,
    zone: typeof body.zone === "string" ? body.zone : undefined,
    shape: typeof body.shape === "string" ? body.shape : undefined,
  });
  const tables = await listTables(db, venueId);
  return c.json({ tables });
});

app.delete("/v1/venues/:venueId/tables/:tableId", adminOnly, async (c) => {
  const venueId = c.req.param("venueId");
  const tableId = c.req.param("tableId");
  await deleteTable(db, venueId, tableId);
  const tables = await listTables(db, venueId);
  return c.json({ tables });
});

app.patch("/v1/venues/:venueId/tables/:tableId", adminOnly, async (c) => {
  const venueId = c.req.param("venueId");
  const tableId = c.req.param("tableId");
  const body = await c.req.json();
  await updateTableLayout(db, venueId, tableId, {
    x: typeof body.x === "number" ? body.x : undefined,
    y: typeof body.y === "number" ? body.y : undefined,
    rotation: typeof body.rotation === "number" ? body.rotation : undefined,
  });
  const tables = await listTables(db, venueId);
  return c.json({ tables });
});

app.get("/v1/venues/:venueId/services", async (c) => {
  const venueId = c.req.param("venueId");
  const services = await listServices(db, venueId);
  return c.json({ services });
});

app.post("/v1/venues/:venueId/services", adminOnly, async (c) => {
  const venueId = c.req.param("venueId");
  const body = await c.req.json();
  if (
    typeof body.name !== "string" ||
    body.name === "" ||
    typeof body.openStart !== "string" ||
    typeof body.openEnd !== "string" ||
    !isPartyLimit(body.minPartySize) ||
    !isPartyLimit(body.maxPartySize) ||
    (body.days !== undefined && parseDays(body.days) === null)
  ) {
    return error(c, "invalid_request");
  }
  const upserted = await upsertService(db, venueId, {
    name: body.name,
    openStart: body.openStart,
    openEnd: body.openEnd,
    minPartySize: body.minPartySize,
    maxPartySize: body.maxPartySize,
    days: body.days === undefined ? undefined : (parseDays(body.days) as number[]),
  });
  if (!upserted.ok) return error(c, upserted.code);
  const services = await listServices(db, venueId);
  return c.json({ services });
});

app.delete("/v1/venues/:venueId/services/:name", adminOnly, async (c) => {
  const venueId = c.req.param("venueId");
  const name = c.req.param("name");
  await deleteService(db, venueId, name);
  const services = await listServices(db, venueId);
  return c.json({ services });
});

app.get("/v1/venues/:venueId/keys", adminOnly, async (c) => {
  const venueId = c.req.param("venueId");
  const keys = await listVenueKeys(db, venueId);
  return c.json({ keys });
});

app.post("/v1/venues/:venueId/keys", adminOnly, async (c) => {
  const venueId = c.req.param("venueId");
  const body = await c.req.json();
  if (
    typeof body.key !== "string" ||
    body.key === "" ||
    typeof body.principal !== "string" ||
    body.principal === "" ||
    (body.role !== "read" && body.role !== "write")
  ) {
    return error(c, "invalid_request");
  }
  await addVenueKey(db, venueId, body.key, body.principal, body.role, await creatorId(c));
  const keys = await listVenueKeys(db, venueId);
  return c.json({ keys }, 201);
});

app.delete("/v1/venues/:venueId/keys", adminOnly, async (c) => {
  const venueId = c.req.param("venueId");
  const body = await c.req.json();
  if (typeof body.hash !== "string") return error(c, "invalid_request");
  await revokeVenueKey(db, venueId, body.hash);
  const keys = await listVenueKeys(db, venueId);
  return c.json({ keys });
});

app.get("/v1/venues/:venueId/guests", async (c) => {
  const venueId = c.req.param("venueId");
  const limitRaw = c.req.query("limit") ?? "50";
  const limit = Number(limitRaw);
  if (!/^\d+$/.test(limitRaw) || limit < 1 || limit > 200) return error(c, "invalid_request");
  const cursor = c.req.query("cursor");
  let after: GuestCursor | undefined;
  if (cursor) {
    const decoded = decodeGuestCursor(venueId, cursor);
    if (!decoded) return error(c, "invalid_request");
    after = decoded;
  }
  const page = await listGuests(db, venueId, {
    contact: c.req.query("contact"),
    namePrefix: c.req.query("name"),
    after,
    limit,
  });
  return c.json({
    guests: page.guests,
    nextCursor: page.next ? encodeGuestCursor(venueId, page.next) : null,
  });
});

app.get("/v1/venues/:venueId/guests/:guestId", async (c) => {
  const guest = await getGuest(db, c.req.param("venueId"), c.req.param("guestId"));
  if (!guest) return error(c, "guest_not_found");
  return c.json(guest);
});

app.post("/v1/venues/:venueId/guests/:guestId/merge", adminOnly, async (c) => {
  const venueId = c.req.param("venueId");
  const key = c.req.header("Idempotency-Key");
  if (!key) return error(c, "invalid_request");
  const body = await c.req.json().catch(() => null);
  if (typeof body?.intoGuestId !== "string" || body.intoGuestId === "") {
    return error(c, "invalid_request");
  }
  const result = await mergeGuest(db, venueId, c.req.param("guestId"), body.intoGuestId, key, c.get("principal"));
  return guestResponse(c, result, venueId);
});

app.post("/v1/venues/:venueId/guests/:guestId/unmerge", adminOnly, async (c) => {
  const venueId = c.req.param("venueId");
  const result = await unmergeGuest(db, venueId, c.req.param("guestId"), c.get("principal"));
  return guestResponse(c, result, venueId);
});

async function guestResponse(c: any, result: GuestWrite, venueId: string) {
  if (!result.ok) return error(c, result.code);
  const guest = await getGuest(db, venueId, result.guestId);
  if (!guest) return error(c, "guest_not_found");
  return c.json(guest);
}

async function writeResponse(c: any, result: any, venueId: string) {
  if (!result.ok) return error(c, result.code);
  const reservation = await getReservation(db, venueId, result.id);
  if (!reservation) return error(c, "reservation_not_found");
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
      guestId: reservation.guestId ?? undefined,
      consent: reservation.consent,
      consentRecordedAt: reservation.consentRecordedAt ?? undefined,
    },
    rating: reservation.rating ?? null,
    ratingRecordedAt: reservation.ratingRecordedAt ?? null,
    commentary: reservation.commentary,
    reconfirmation: reservation.reconfirmation,
    reconfirmationRecordedAt: reservation.reconfirmationRecordedAt ?? null,
    tables: reservation.tableIds,
  };
}

function error(c: any, code: ErrorCode) {
  return c.json(errorBody(code), ERRORS[code].status);
}

app.get("/v1/venues/:venueId/config", async (c) => {
  const venueId = c.req.param("venueId");
  const config = await getConfig(db, venueId);
  if (!config) return error(c, "venue_not_found");
  return c.json(config);
});

app.put("/v1/venues/:venueId/config", adminOnly, async (c) => {
  const venueId = c.req.param("venueId");
  const body = await c.req.json();
  if (body.phoneCountry != null && !toCountryCode(body.phoneCountry)) {
    return error(c, "invalid_request");
  }
  const turnTimes = body.turnTimes === undefined ? undefined : parseTurnTimes(body.turnTimes);
  if (turnTimes === null) return error(c, "invalid_request");
  if (body.overbookingCeiling !== undefined && !isCeiling(body.overbookingCeiling)) {
    return error(c, "invalid_request");
  }
  const blockedDates = body.blockedDates === undefined ? undefined : parseBlockedDates(body.blockedDates);
  if (blockedDates === null) return error(c, "invalid_request");
  if (body.maxAdvanceDays != null && !isMaxAdvanceDays(body.maxAdvanceDays)) return error(c, "invalid_request");
  if (body.maxActivePerGuestPerDay != null && !isMaxActivePerGuest(body.maxActivePerGuestPerDay)) {
    return error(c, "invalid_request");
  }
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
    phoneCountry: body.phoneCountry === null ? null : toCountryCode(body.phoneCountry) ?? undefined,
    turnTimes,
    overbookingCeiling: body.overbookingCeiling,
    maxAdvanceDays: body.maxAdvanceDays,
    maxActivePerGuestPerDay: body.maxActivePerGuestPerDay,
    blockedDates,
  });
  if (!result.ok) return error(c, result.code);
  return c.json(result.config);
});

app.get("/v1/venues/:venueId/public-profile", async (c) => {
  const profile = await getProfile(db, c.req.param("venueId"));
  if (!profile) return error(c, "venue_not_found");
  return c.json(profile);
});

app.put("/v1/venues/:venueId/public-profile", adminOnly, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return error(c, "invalid_request");
  }
  const input = parseProfileInput(body);
  if (!input) return error(c, "invalid_request");
  const result = await setProfile(db, c.req.param("venueId"), input);
  if (!result.ok) return error(c, result.code);
  return c.json(result.profile);
});

app.get("/v1/venues/:venueId/online-booking", async (c) => {
  const settings = await getOnlineBooking(db, c.req.param("venueId"));
  if (!settings) return error(c, "venue_not_found");
  return c.json(settings);
});

app.put("/v1/venues/:venueId/online-booking", adminOnly, async (c) => {
  const body = await c.req.json().catch(() => null);
  const input = parseOnlineBookingInput(body);
  if (!input) return error(c, "invalid_request");
  const result = await setOnlineBooking(db, c.req.param("venueId"), input);
  if (!result.ok) return error(c, result.code);
  return c.json({ ...result.settings, warnings: result.warnings });
});

app.post("/v1/venues/:venueId/online-booking/rotate-key", adminOnly, async (c) => {
  const result = await rotateBookingKey(db, c.req.param("venueId"));
  if (!result.ok) return error(c, result.code);
  return c.json(result.settings);
});

app.get("/v1/venues/:venueId/webhooks", async (c) => {
  if (c.get("role") === "read") return error(c, "forbidden");
  const webhooks = await listWebhooks(db, c.req.param("venueId"));
  return c.json({ webhooks });
});

app.post("/v1/venues/:venueId/webhooks", async (c) => {
  const venueId = c.req.param("venueId");
  const body = await c.req.json().catch(() => null);
  if (typeof body?.url !== "string") return error(c, "invalid_request");
  const result = await createWebhook(
    db,
    venueId,
    body.url,
    webhookPolicyFromEnv(),
    await creatorId(c),
  );
  if (!result.ok) return error(c, result.code);
  return c.json(result.webhook, 201);
});

app.delete("/v1/venues/:venueId/webhooks/:webhookId", async (c) => {
  const venueId = c.req.param("venueId");
  const deleted = await deleteWebhook(db, venueId, c.req.param("webhookId"));
  if (!deleted) return error(c, "webhook_not_found");
  const webhooks = await listWebhooks(db, venueId);
  return c.json({ webhooks });
});

app.post("/v1/venues/:venueId/erasure", adminOnly, async (c) => {
  const venueId = c.req.param("venueId");
  const body = await c.req.json();
  const result = await erase(db, venueId, body.guestId, body.principal, c.get("principal") as string);
  return c.json(result);
});

async function sessionUser(c: any) {
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!result) return null;
  return result.user ?? null;
}

// The staff member behind a request, or null when a key made it. Only a
// session names a person, so a key's creations stay unattributed.
async function creatorId(c: any): Promise<string | null> {
  if (c.req.header("apikey")) return null;
  return (await sessionUser(c))?.id ?? null;
}

async function authorizeAdmin(c: any): Promise<{ principal: string } | Response> {
  const key = c.req.header("apikey");
  if (!key) return error(c, "unauthorized");
  const admin = await authenticateAdmin(db, key);
  if (!admin.ok) {
    return admin.reason === "unauthorized"
      ? error(c, "unauthorized")
      : error(c, "forbidden");
  }
  return { principal: admin.principal };
}

function hasInvalidConsent(body: any): boolean {
  const consent = body?.guest?.consent;
  return consent !== undefined && !isConsent(consent);
}

function hasInvalidRating(body: any): boolean {
  const rating = body?.rating;
  return rating !== undefined && rating !== null && !isRating(rating);
}

function hasInvalidReconfirmation(body: any): boolean {
  const reconfirmation = body?.reconfirmation;
  return reconfirmation !== undefined && !isReconfirmation(reconfirmation);
}

function hasInvalidCommentary(body: any): boolean {
  const commentary = body?.commentary;
  return commentary !== undefined && !isCommentary(commentary);
}

function isRole(value: unknown): value is "read" | "write" | "admin" {
  return value === "read" || value === "write" || value === "admin";
}

function isDate(value: string): boolean {
  const ms = Date.parse(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(ms) && new Date(ms).toISOString().startsWith(value);
}

function isPartyLimit(value: unknown): boolean {
  return value === undefined || value === null || (Number.isInteger(value) && (value as number) >= 1);
}

function isCeiling(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1000;
}

function isPosInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export default app;
