import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { db } from "./db/client";
import {
  ACCOUNT_KEY_FIELDS,
  ACCOUNT_KEY_REVOKE_FIELDS,
  addKey,
  addVenueKey,
  authenticate,
  authenticateAdmin,
  listKeys,
  listVenueKeys,
  revokeKey,
  revokeVenueKey,
  VENUE_KEY_FIELDS,
  VENUE_KEY_REVOKE_FIELDS,
} from "./lib/api-keys";
import {
  AUDIT_DEFAULT_LIMIT,
  AUDIT_MAX_LIMIT,
  decodeAuditCursor,
  encodeAuditCursor,
  listMembershipAudit,
} from "./lib/membership-audit";
import { auth, mcpRemote, trustedOrigins } from "./lib/auth";
import { getReservationTrace } from "./lib/reservation-trace";
import { staffOriginGuard } from "./lib/staff-origin";
import { CHANNEL_HEADER, keyOrigin, sessionOrigin, WIDGET, type Origin } from "./lib/origin";
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
  invitationUsable,
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
import {
  findWaitlistLink,
  joinableDate,
  joinWaitlist,
  leaveWaitlist,
  parseWaitlistJoin,
  sendJoinEmail,
  waitlistGuestView,
  waitlistOpen,
} from "./lib/public-waitlist";
import {
  defaultWidgetDist,
  embedScriptHeaders,
  notFoundHtml,
  readWidgetAsset,
  SELF_SERVICE_TITLES,
  selfServiceHeaders,
  servesWidgetOn,
  WAITLIST_TITLES,
  widgetAssets,
  widgetEmbedScript,
  widgetHeaders,
  widgetHtml,
  widgetOrigin,
  widgetServingFromEnv,
} from "./lib/widget-page";
import { canResend, parseResendEmail, resendLinks } from "./lib/link-resend";
import { getMembership, listVenuesForUser } from "./lib/memberships";
import { demoMode } from "./demo/settings";
import { demoStatus } from "./demo/status";
import { magicLinkChallenges } from "./demo/magic-link-challenge";
import { DemoLimitError } from "./demo/limits";
import { normalizeEmail } from "./demo/normalize";
import { isCreator, mayCreateVenue, signupMode, transferCreator } from "./lib/signup";
import { changeMemberRole, listMembers, removeMember } from "./lib/members";
import {
  deleteService,
  hasService,
  MAX_SERVICE_PATH_LENGTH,
  deleteTable,
  listServices,
  parseDays,
  listTables,
  TABLE_FIELDS,
  TABLE_LAYOUT_FIELDS,
  updateTableLayout,
  upsertService,
  upsertTable,
} from "./lib/catalog";
import { checkFields, checkNoFields, parseBody, type FieldProblem } from "./lib/body";
import {
  CREATE_FIELDS,
  MODIFY_FIELDS,
  STATUS_FIELDS,
  WAITLIST_ADD_FIELDS,
  WALK_IN_FIELDS,
} from "./lib/staff-writes";
import {
  cancelReservation,
  createReservation,
  explainSlot,
  getAvailability,
  publicDays,
  publicTimes,
  getEvents,
  getEventsWatermark,
  getFloorPlan,
  getPacing,
  getReservation,
  listByDate,
  listByPrincipal,
  modifyReservation,
  type Reservation,
  searchReservations,
  setStatus,
  walkIn,
} from "./lib/reservations";
import { dietaryViews } from "./lib/dietary";
import { loggable } from "./lib/loggable";
import { createVenue, erase, getConfig, setConfig } from "./lib/venue";
import { effectivePublicZones, enabledLocales, getOnlineBooking, parseOnlineBookingInput, rotateBookingKey, setOnlineBooking } from "./lib/online-booking";
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
  FLOOR_ITEM_FIELDS,
  FLOOR_ITEM_LAYOUT_FIELDS,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  listFloorItems,
  updateFloorItemLayout,
} from "./lib/floor-items";
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  webhookPolicyFromEnv,
} from "./lib/webhooks";
import { ERRORS, errorBody, invalidBodyError, type ErrorCode } from "./lib/errors";
import { addDays, isCalendarDate, isValidTimeZone, localDateTime } from "./lib/time";
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
    origin: Origin;
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

// Below the limiter, so an oversized body still spends the caller's budget. The widget's largest body is about
// 2 KB and the staff app's (a config with 366 blocked date ranges) about 20 KB.
const bodyTooLarge = (c: any) => error(c, "invalid_request");
app.use("/v1/public/*", bodyLimit({ maxSize: 16 * 1024, onError: bodyTooLarge }));
app.use("*", bodyLimit({ maxSize: 256 * 1024, onError: bodyTooLarge }));
app.use("/v1/*", staffOriginGuard(trustedOrigins));

app.get("/health", (c) => c.json({ ok: true, service: "opencovers" }));

app.all("/api/auth/*", (c) => auth.handler(c.req.raw));

if (mcpRemote) {
  // RFC 8414 places the metadata of the issuer <origin>/api/auth at this path.
  const authServerMetadata = oauthProviderAuthServerMetadata(auth);
  app.get("/.well-known/oauth-authorization-server/api/auth", (c) => authServerMetadata(c.req.raw));
}

// The staff app asks this before it shows a sign-in form (ADR-0022). Demo off: `enabled: false` and nothing else.
// Signed in with a sandbox: that session's own sandbox, and no one else's.
app.get("/api/demo/status", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  c.header("Cache-Control", "no-store");
  return c.json(await demoStatus(db, session?.user.id ?? null));
});

// The hosted demo's own routes (ADR-0022, decision 11), outside docs/contract. They answer 404 unless DEMO_MODE=1.
app.use("/api/demo/*", staffOriginGuard(trustedOrigins));

// ADR-0022, decision 8(a): the proof-of-work challenge a demo magic link needs. Outside the contract, public, rate
// limited per IP (lib/rate-limit.ts). Issuing says nothing about the address, so it does not touch the accounts.
// A body with no usable address (missing, oversized, not JSON, whitespace, a list) is a 400.
app.post("/api/demo/magic-link-challenge", async (c) => {
  if (!demoMode()) return c.notFound();
  const length = Number(c.req.header("content-length") ?? Number.NaN);
  if (!(length > 0 && length <= 4096)) return error(c, "invalid_request");
  const body = (await c.req.json().catch(() => null)) as { email?: unknown } | null;
  const email = body?.email;
  if (typeof email !== "string" || normalizeEmail(email) === null) return error(c, "invalid_request");
  c.header("Cache-Control", "no-store");
  return c.json(magicLinkChallenges().issue(email));
});

// A sandbox hit one of its caps. A code outside the contract, and only a demo instance can emit it.
app.onError((err, c) => {
  if (err instanceof DemoLimitError) {
    return c.json({ code: "demo_limit_reached", message: "demo_limit_reached", kind: err.kind, retryable: false }, 409);
  }
  console.error(loggable(err));
  return c.text("Internal Server Error", 500);
});

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
const widgetServing = widgetServingFromEnv();
const linkOrigin = widgetOrigin(widgetServing);

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
      origin: WIDGET,
    },
    storedKey(key),
  );
  if (!result.ok) return error(c, result.code);
  if (input.partySize !== undefined && result.version !== input.version) {
    void notifyReservation(db, link.venueId, link.reservationId, result.version, "confirmation", { guestModify: true });
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
  const result = await cancelReservation(db, link.venueId, link.reservationId, storedKey(key), WIDGET, {
    linkId: link.id,
    cutoffMinutes: target.settings.selfServiceCutoffMinutes,
  });
  if (!result.ok) return error(c, result.code);
  const view = await guestView(db, target, link.reservationId);
  if (!view) return error(c, "self_service_link_invalid");
  if (!link.revokedAt) void notifyReservation(db, link.venueId, link.reservationId, view.version, "cancellation");
  return c.json(view);
});

// The public waitlist of ADR-0021, section 3. Like the self-service routes, the entry routes take the waitlist token
// only, and sit above `/v1/public/:bookingKey`. Every failure of a token reads the same (C74).
async function waitlistAnswer(c: any, venueId: string, entryId: string) {
  const target = await publicVenueOf(db, venueId);
  const view = target && (await waitlistGuestView(db, target, entryId));
  return view ? c.json(view) : error(c, "self_service_link_invalid");
}

app.get("/v1/public/waitlist-entry", async (c) => {
  const link = await findWaitlistLink(db, selfServiceToken(c));
  if (!link || link.revokedAt) return error(c, "self_service_link_invalid");
  return waitlistAnswer(c, link.venueId, link.entryId);
});

app.post("/v1/public/waitlist-entry/leave", async (c) => {
  const key = c.req.header("Idempotency-Key");
  if (!isPublicIdempotencyKey(key)) return error(c, "invalid_request");
  const link = await findWaitlistLink(db, selfServiceToken(c));
  // A revoked link answers only a repeat of the leave that revoked it (C75).
  if (!link || (link.revokedAt && link.leaveKey !== storedKey(key))) return error(c, "self_service_link_invalid");
  const result = await leaveWaitlist(db, link, storedKey(key));
  if (!result.ok) return error(c, result.code);
  return waitlistAnswer(c, link.venueId, link.entryId);
});

app.get("/v1/public/:bookingKey", async (c) => {
  const bookingKey = c.req.param("bookingKey");
  const target = await resolveBookingKey(db, bookingKey);
  if (!target) return error(c, "venue_not_found");
  const challenge = issueChallenge(challengeConfig, bookingKey);
  return c.json(await publicConfig(db, target, challenge, canResend(target.venue, linkOrigin)));
});

// A lost link (ADR-0017 stage 12). The answer is the same whatever the address matches, and it is sent before
// any lookup of the address: the work starts on a later turn of the event loop.
app.post("/v1/public/:bookingKey/self-service/resend", async (c) => {
  const target = await resolveBookingKey(db, c.req.param("bookingKey"));
  if (!target) return error(c, "venue_not_found");
  const email = parseResendEmail(await c.req.json().catch(() => null));
  if (!email) return error(c, "invalid_request");
  setImmediate(() => void resendLinks(db, target, email, linkOrigin));
  return c.json({ accepted: true }, 202);
});

app.get("/v1/public/:bookingKey/availability", async (c) => {
  const target = await resolveBookingKey(db, c.req.param("bookingKey"));
  if (!target) return error(c, "venue_not_found");
  const date = c.req.query("date");
  const rawParty = c.req.query("partySize") ?? "";
  if (!isPublicDate(date) || !/^[1-9]\d{0,5}$/.test(rawParty)) return error(c, "invalid_request");
  const partySize = Number(rawParty);
  const { publicZones, showServiceNames } = target.settings;
  // A venue with nothing stored takes the old path: no extra query, no extra evaluation, the same answer (C66).
  const zones = await effectivePublicZones(db, target.venue.id, publicZones);
  const zone = c.req.query("zone");
  if (zone !== undefined && !zones.includes(zone)) return error(c, "invalid_request");
  const extras = zones.length > 0 || showServiceNames ? { zones, zone, showServiceNames } : undefined;
  const { times, reason, slots } = await publicTimes(
    db,
    target.venue.id,
    date,
    partySize,
    rulesOf(target.settings),
    extras,
  );
  return c.json({ date, partySize, times, reason, ...(slots ? { slots } : {}) });
});

// The status of each date for a party (ADR-0021, C63). It takes no `zone` (C66): a stray `zone` query is ignored,
// since a day is `available` when a create without a zone could book. One venue lookup, then the availability rules per date.
app.get("/v1/public/:bookingKey/days", async (c) => {
  const target = await resolveBookingKey(db, c.req.param("bookingKey"));
  if (!target) return error(c, "venue_not_found");
  const rawParty = c.req.query("partySize") ?? "";
  const rawDays = c.req.query("days");
  const rawFrom = c.req.query("from");
  if (!/^[1-9]\d{0,5}$/.test(rawParty)) return error(c, "invalid_request");
  if (rawDays !== undefined && !/^([1-9]|1[0-4])$/.test(rawDays)) return error(c, "invalid_request");
  if (rawFrom !== undefined && !isPublicDate(rawFrom)) return error(c, "invalid_request");
  const partySize = Number(rawParty);
  const { minPartySize, maxPartySize } = target.settings;
  if (partySize < minPartySize || partySize > maxPartySize) return error(c, "invalid_request");
  const from = rawFrom ?? localDateTime(new Date(), target.venue.timezone).date;
  const dates = Array.from({ length: rawDays === undefined ? 12 : Number(rawDays) }, (_, i) => addDays(from, i));
  return c.json({
    from,
    partySize,
    days: await publicDays(db, target.venue.id, dates, partySize, rulesOf(target.settings)),
  });
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
  if (
    input.zone !== undefined &&
    !(await effectivePublicZones(db, venueId, target.settings.publicZones)).includes(input.zone)
  ) {
    return error(c, "invalid_request");
  }
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
      zone: input.zone,
      bookedVia: "widget",
      basis: "service",
      ownerPrincipal: "widget",
      guestLocale: input.locale ?? null,
      channel: { kind: "public", rules: rulesOf(target.settings) },
      origin: WIDGET,
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

// The waitlist join (ADR-0021, section 3, C69 to C73). The checks run in the create's order: the key, the body, a
// replay (which needs no challenge), the challenge, then whether the waitlist and the date take joins. The caps and
// the blocklist run inside the write. The email goes after the commit and never changes the answer.
app.post("/v1/public/:bookingKey/waitlist", async (c) => {
  const bookingKey = c.req.param("bookingKey");
  const target = await resolveBookingKey(db, bookingKey);
  if (!target) return error(c, "venue_not_found");
  const key = c.req.header("Idempotency-Key");
  if (!isPublicIdempotencyKey(key)) return error(c, "invalid_request");
  const input = parseWaitlistJoin(await c.req.json().catch(() => null), target);
  if (!input) return error(c, "invalid_request");
  const venueId = target.venue.id;
  const replay = await findKey(db, venueId, storedKey(key));
  if (!replay) {
    if (!challenges.verify(bookingKey, input.challenge, input.solution, key)) return error(c, "invalid_request");
    if (!waitlistOpen(target, linkOrigin) || !(await joinableDate(db, target, input.date, input.partySize))) {
      return error(c, "waitlist_unavailable");
    }
  }
  const result = await joinWaitlist(db, target, input, storedKey(key));
  if (!result.ok) return error(c, result.code);
  if (result.token) void sendJoinEmail(db, target, input, result.token, linkOrigin);
  const entry = await waitlistGuestView(db, target, result.entryId);
  if (!entry) return error(c, "invalid_request");
  return c.json({ entry, waitlistToken: result.token });
});

// The widget page (ADR-0017 section 1). The API serves it, not Caddy, because `frame-ancestors` is per venue.
// Not rate limited. An unknown, rotated or disabled key, and a host that is not the widget's, read alike.
const widgetDist = () => process.env.WIDGET_DIST || defaultWidgetDist();
const widgetNotFound = (c: any) =>
  c.body(notFoundHtml(c.req.query("lang"), c.req.header("accept-language")), 404, widgetHeaders([]));
const widgetNotBuilt = (c: any) => {
  console.error(`widget page: no build in ${widgetDist()}. Run pnpm --filter @opencovers/widget build.`);
  return c.body("The booking widget is not built.", 503, {
    ...widgetHeaders([]),
    "Content-Type": "text/plain; charset=utf-8",
  });
};

const widgetFileNotFound = (c: any) =>
  c.body("Not found", 404, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });

// Browsers ask for /favicon.ico on every page. The widget host answers 204 (no icon, no console error) with no
// body, so the page's CSP and the uniform 404 of every other route are untouched. Anywhere else it is a 404.
app.get("/favicon.ico", (c, next) => {
  if (!servesWidgetOn(widgetServing, c.req.url)) return next();
  return c.body(null, 204, { "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" });
});

app.get("/w/assets/:file", (c) => {
  const asset = servesWidgetOn(widgetServing, c.req.url) && readWidgetAsset(widgetDist(), c.req.param("file"));
  if (!asset) return widgetFileNotFound(c);
  return c.body(new Uint8Array(asset.body), 200, {
    "Content-Type": asset.type,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
});

// The optional resize script (ADR-0017 stage 10). Above `/w/:bookingKey`, which would otherwise take its name.
app.get("/w/embed.js", (c) => {
  const script = servesWidgetOn(widgetServing, c.req.url) && widgetEmbedScript(widgetDist());
  if (!script) return widgetFileNotFound(c);
  const headers = embedScriptHeaders(script.etag);
  const tags = c.req.header("if-none-match")?.split(",") ?? [];
  if (tags.some((tag) => tag.trim().replace(/^W\//, "") === script.etag)) return c.body(null, 304, headers);
  return c.body(new Uint8Array(script.body), 200, headers);
});

app.get("/w/:bookingKey", async (c) => {
  if (!servesWidgetOn(widgetServing, c.req.url)) return widgetNotFound(c);
  const target = await resolveBookingKey(db, c.req.param("bookingKey"));
  if (!target) return widgetNotFound(c);
  const assets = widgetAssets(widgetDist());
  if (!assets) return widgetNotBuilt(c);
  const lang = c.req.query("lang");
  const html = widgetHtml({
    lang: lang && enabledLocales().includes(lang) ? lang : target.settings.locale,
    title: target.venue.name,
    assets,
  });
  return c.body(html, 200, widgetHeaders(target.settings.allowedOrigins));
});

// The self-service page (ADR-0017 section 2, stage 6), the same widget build. The token rides in the fragment and
// never reaches this route, so the page is the same for every booking and reads the booking itself. It answers on
// the hosts `/w/*` answers on, and is never framed.
app.get("/r", (c) => {
  if (!servesWidgetOn(widgetServing, c.req.url)) return widgetNotFound(c);
  const assets = widgetAssets(widgetDist());
  if (!assets) return widgetNotBuilt(c);
  const query = c.req.query("lang");
  const lang = query && Object.hasOwn(SELF_SERVICE_TITLES, query) && enabledLocales().includes(query) ? query : "es";
  return c.body(widgetHtml({ lang, title: SELF_SERVICE_TITLES[lang], assets }), 200, selfServiceHeaders());
});

// The page of a waitlist leave link (ADR-0021, C74), served as `/r` is: the same build and headers, one page for
// every entry. The widget reads the token from the fragment (stage 12).
app.get("/r/waitlist", (c) => {
  if (!servesWidgetOn(widgetServing, c.req.url)) return widgetNotFound(c);
  const assets = widgetAssets(widgetDist());
  if (!assets) return widgetNotBuilt(c);
  const query = c.req.query("lang");
  const lang = query && Object.hasOwn(WAITLIST_TITLES, query) && enabledLocales().includes(query) ? query : "es";
  return c.body(widgetHtml({ lang, title: WAITLIST_TITLES[lang], assets }), 200, selfServiceHeaders());
});

app.use("/v1/venues/:venueId/*", async (c, next) => {
  const venueId = c.req.param("venueId");
  const key = c.req.header("apikey");

  let principal: string;
  let role: string;
  let origin: Origin;

  if (key) {
    const result = await authenticate(db, key, venueId);
    if (!result.ok) {
      return result.reason === "unauthorized"
        ? error(c, "unauthorized")
        : error(c, "venue_not_found");
    }
    principal = result.principal;
    role = result.role;
    origin = keyOrigin(result.keyId, c.req.header(CHANNEL_HEADER));
  } else {
    const user = await sessionUser(c);
    if (!user) return error(c, "unauthorized");
    const membership = await getMembership(db, user.id, venueId);
    if (!membership) return error(c, "venue_not_found");
    principal = user.email;
    role = membership.role;
    origin = sessionOrigin(user.id);
  }

  const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method);
  if (isWrite && role === "read") {
    return error(c, "forbidden");
  }
  c.set("principal", principal);
  c.set("role", role);
  c.set("origin", origin);
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
  // A demo visitor has the one sandbox they were given (ADR-0022).
  if (demoMode() || !(await mayCreateVenue(db, signupMode(), user.id))) {
    return error(c, "venue_creation_closed");
  }
  const body = await c.req.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return error(c, "invalid_request");
  }
  if ("id" in body || typeof body.name !== "string" || body.name.trim() === "") {
    return error(c, "invalid_request");
  }
  const timezone = body.timezone ?? undefined;
  if (timezone !== undefined && !isValidTimeZone(timezone)) return error(c, "invalid_request");
  const { id } = await createVenue(db, user.id, { name: body.name, timezone });
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

// Whether an invitation link still works, so the staff app can say so before asking for an account. Public like the
// sign-up it precedes, it spends the same budget as a redemption and answers `valid` and nothing else.
app.post("/v1/invitations/check", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (typeof body?.token !== "string" || body.token === "") {
    return error(c, "invalid_request");
  }
  return c.json({ valid: await invitationUsable(db, body.token) });
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
  const input = hasQuery(c) ? null : await parseBody(c.req, ACCOUNT_KEY_FIELDS);
  if (!input) return error(c, "invalid_request");
  const result = await addKey(db, input.key, input.principal, input.venues ?? ["*"], input.role);
  if (!result.ok) return error(c, result.code);
  return c.json({ ok: true });
});

app.delete("/v1/auth/keys", async (c) => {
  const admin = await authorizeAdmin(c);
  if (admin instanceof Response) return admin;
  const input = hasQuery(c) ? null : await parseBody(c.req, ACCOUNT_KEY_REVOKE_FIELDS);
  if (!input) return error(c, "invalid_request");
  await revokeKey(db, input.key);
  return c.json({ ok: true });
});

app.post("/v1/venues/:venueId/reservations", async (c) => {
  const venueId = c.req.param("venueId");
  const key = c.req.header("Idempotency-Key");
  if (!key) return error(c, "invalid_request");
  const body = checkFields(await c.req.json().catch(() => undefined), CREATE_FIELDS);
  if (!body.ok) return invalidBody(c, body.fields);
  const { tables: tableIds, guest, ...booking } = body.value;
  const result = await createReservation(
    db,
    venueId,
    {
      ...booking,
      tableIds,
      guestName: guest?.name,
      guestContact: guest?.contact,
      consent: guest?.consent,
      bookedVia: c.get("principal") as string,
      basis: "service",
      ownerPrincipal: c.get("principal") as string,
      origin: c.get("origin"),
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
  const body = checkFields(await c.req.json().catch(() => undefined), WALK_IN_FIELDS);
  if (!body.ok) return invalidBody(c, body.fields);
  const { tables: tableIds, guest, ...booking } = body.value;
  const result = await walkIn(
    db,
    venueId,
    {
      ...booking,
      tableIds,
      guestName: guest?.name,
      guestContact: guest?.contact,
      consent: guest?.consent,
      bookedVia: c.get("principal") as string,
      origin: c.get("origin"),
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
  const date = c.req.query("date");
  if (date !== undefined && !isCalendarDate(date)) return error(c, "invalid_request");
  const entries = await listWaitlist(db, venueId, date);
  return c.json({ entries });
});

app.post("/v1/venues/:venueId/waitlist", async (c) => {
  const venueId = c.req.param("venueId");
  const body = checkFields(await c.req.json().catch(() => undefined), WAITLIST_ADD_FIELDS);
  if (!body.ok) return invalidBody(c, body.fields);
  const { partySize, zone, guest } = body.value;
  const result = await addWaitlist(
    db,
    venueId,
    { partySize, zone, guestName: guest?.name, guestContact: guest?.contact },
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
  const body = await checkNoFields(c.req);
  if (!body.ok) return invalidBody(c, body.fields);
  const result = await seatWaitlist(db, venueId, id, key, c.get("origin"));
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
  const body = await checkNoFields(c.req);
  if (!body.ok) return invalidBody(c, body.fields);
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
  const body = checkFields(await c.req.json().catch(() => undefined), MODIFY_FIELDS);
  if (!body.ok) return invalidBody(c, body.fields);
  const sent = Object.values(body.value).filter((value) => value !== undefined).length;
  if (sent === 0) return error(c, "invalid_request");
  const { date, time, zone, tables: tableIds, guest, ...changes } = body.value;
  const result = await modifyReservation(
    db,
    venueId,
    id,
    {
      ...changes,
      tableIds,
      consent: guest?.consent,
      restated: { date, time, zone },
      dietaryWithdrawal: changes.dietary === null && sent === 1,
      origin: c.get("origin"),
    },
    key,
  );
  if (result.ok && result.partySizeChanged) {
    void notifyReservation(db, venueId, result.id, result.version, "confirmation");
  }
  return writeResponse(c, result, venueId);
});

app.post("/v1/venues/:venueId/reservations/:id/cancel", async (c) => {
  const venueId = c.req.param("venueId");
  const id = c.req.param("id");
  const key = c.req.header("Idempotency-Key");
  if (!key) return error(c, "invalid_request");
  const body = await checkNoFields(c.req);
  if (!body.ok) return invalidBody(c, body.fields);
  const result = await cancelReservation(db, venueId, id, key, c.get("origin"));
  if (!result.ok) return error(c, result.code);
  const reservation = await getReservation(db, venueId, id);
  if (!reservation) return error(c, "reservation_not_found");
  void notifyReservation(db, venueId, id, reservation.version, "cancellation");
  return c.json((await withDietary([reservation], venueId))[0], 200);
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
  const body = checkFields(await c.req.json().catch(() => undefined), STATUS_FIELDS);
  if (!body.ok) return invalidBody(c, body.fields);
  const result = await setStatus(db, venueId, id, body.value.status, key, c.get("origin"));
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
  return c.json((await withDietary([reservation], venueId))[0]);
});

app.get("/v1/venues/:venueId/reservations/:id/trace", async (c) => {
  const trace = await getReservationTrace(db, c.req.param("venueId"), c.req.param("id"));
  if (!trace) return error(c, "reservation_not_found");
  return c.json(trace);
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
  if (!date || !isDate(date)) return error(c, "invalid_request");
  const reservations = await listByDate(db, venueId, date);
  return c.json({ reservations: await withDietary(reservations, venueId) });
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
  if (!date || !isDate(date) || !partySizeRaw) return error(c, "invalid_request");
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
  if ((date !== undefined && !isDate(date)) || (time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
    return error(c, "invalid_request");
  }
  const tables = await getFloorPlan(db, venueId, date, time);
  return c.json({ tables });
});

app.get("/v1/venues/:venueId/pacing", async (c) => {
  const venueId = c.req.param("venueId");
  const date = c.req.query("date");
  if (!date || !isDate(date)) return error(c, "invalid_request");
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
  const key = c.req.header("Idempotency-Key");
  if (key !== undefined && (key === "" || key.length > MAX_IDEMPOTENCY_KEY_LENGTH)) return error(c, "invalid_request");
  const input = await parseBody(c.req, FLOOR_ITEM_FIELDS);
  if (!input) return error(c, "invalid_request");
  const result = await addFloorItem(db, venueId, input, key);
  if (!result.ok) return error(c, result.code);
  const items = await listFloorItems(db, venueId);
  return c.json({ items, ...(result.item ? { item: result.item } : {}) }, 201);
});

app.delete("/v1/venues/:venueId/floor-items/:itemId", adminOnly, async (c) => {
  const venueId = c.req.param("venueId");
  const result = await deleteFloorItem(db, venueId, c.req.param("itemId"));
  if (!result.ok) return error(c, result.code);
  const items = await listFloorItems(db, venueId);
  return c.json({ items });
});

app.patch("/v1/venues/:venueId/floor-items/:itemId", adminOnly, async (c) => {
  const venueId = c.req.param("venueId");
  const input = await parseBody(c.req, FLOOR_ITEM_LAYOUT_FIELDS);
  if (!input || Object.values(input).every((v) => v === undefined)) return error(c, "invalid_request");
  const result = await updateFloorItemLayout(db, venueId, c.req.param("itemId"), input);
  if (!result.ok) return error(c, result.code);
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
  const input = await parseBody(c.req, TABLE_FIELDS);
  if (!input) return error(c, "invalid_request");
  const result = await upsertTable(db, venueId, input);
  if (!result.ok) return error(c, result.code);
  const tables = await listTables(db, venueId);
  return c.json({ tables });
});

app.delete("/v1/venues/:venueId/tables/:tableId", adminOnly, async (c) => {
  const venueId = c.req.param("venueId");
  const result = await deleteTable(db, venueId, c.req.param("tableId"));
  if (!result.ok) return error(c, result.code);
  const tables = await listTables(db, venueId);
  return c.json({ tables });
});

app.patch("/v1/venues/:venueId/tables/:tableId", adminOnly, async (c) => {
  const venueId = c.req.param("venueId");
  const input = await parseBody(c.req, TABLE_LAYOUT_FIELDS);
  if (!input || Object.values(input).every((v) => v === undefined)) return error(c, "invalid_request");
  const result = await updateTableLayout(db, venueId, c.req.param("tableId"), input);
  if (!result.ok) return error(c, result.code);
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
    body.name.length > MAX_SERVICE_PATH_LENGTH ||
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
  // A very long name is a bad request, not an unknown service. One stored before the bound still deletes.
  if (name.length > MAX_SERVICE_PATH_LENGTH && !(await hasService(db, venueId, name))) {
    return error(c, "invalid_request");
  }
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
  const input = hasQuery(c) ? null : await parseBody(c.req, VENUE_KEY_FIELDS);
  if (!input) return error(c, "invalid_request");
  const result = await addVenueKey(db, venueId, input.key, input.principal, input.role, await creatorId(c));
  if (!result.ok) return error(c, result.code);
  const keys = await listVenueKeys(db, venueId);
  return c.json({ keys }, 201);
});

app.delete("/v1/venues/:venueId/keys", adminOnly, async (c) => {
  const venueId = c.req.param("venueId");
  const input = hasQuery(c) ? null : await parseBody(c.req, VENUE_KEY_REVOKE_FIELDS);
  if (!input) return error(c, "invalid_request");
  const result = await revokeVenueKey(db, venueId, input.hash);
  if (!result.ok) return error(c, result.code);
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
  if (!result.ok) return result.fields ? invalidBody(c, result.fields) : error(c, result.code);
  const reservation = await getReservation(db, venueId, result.id);
  if (!reservation) return error(c, "reservation_not_found");
  return c.json((await withDietary([reservation], venueId))[0], 200);
}

/**
 * The answers that carry `dietary` (ADR-0027, decision 7): get, the agenda, and the reservation a create, walk-in,
 * modify, cancel or status returns. Every other answer is `toApi` alone, which never copies it.
 */
async function withDietary(reservations: Reservation[], venueId: string) {
  const views = await dietaryViews(db, venueId, reservations.map((r) => r.dietary));
  return reservations.map((r, i) => ({ ...toApi(r, venueId), ...(views[i] ? { dietary: views[i] } : {}) }));
}

function toApi(reservation: Reservation, venueId: string) {
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
    guestLocale: reservation.guestLocale ?? null,
    tables: reservation.tableIds,
  };
}

function error(c: any, code: ErrorCode) {
  return c.json(errorBody(code), ERRORS[code].status);
}

function invalidBody(c: any, fields: FieldProblem[]) {
  return c.json(invalidBodyError(fields), ERRORS.invalid_request.status);
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
  const result = await erase(db, venueId, body.guestId, body.principal, c.get("principal") as string, c.get("origin"));
  return c.json(result);
});

async function sessionUser(c: any) {
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!result) return null;
  return result.user ?? null;
}

// The staff member behind a request, or null when a key made it. Only a
// session names a person, so a key's creations stay unattributed.
/** The key routes take no query parameter: a key in a URL ends up in logs (C81). */
function hasQuery(c: any): boolean {
  return Object.keys(c.req.queries()).length > 0;
}

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

function isRole(value: unknown): value is "read" | "write" | "admin" {
  return value === "read" || value === "write" || value === "admin";
}

function isDate(value: string): boolean {
  return isCalendarDate(value);
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
