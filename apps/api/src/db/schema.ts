import { sql } from "drizzle-orm";
import type { BlocklistReason } from "../lib/blocklist";
import type { Consent } from "../lib/consent";
import type { ContactKey } from "../lib/contact";
import type { Rating } from "../lib/rating";
import type { Reconfirmation } from "../lib/reconfirmation";
import type { DateRange } from "../lib/booking-policy";
import type { TurnTime } from "../lib/turn-times";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const DEFAULT_RETENTION_DAYS = 400;

export const venues = pgTable("venues", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  timezone: text("timezone").notNull().default("UTC"),
  enabled: boolean("enabled").notNull().default(false),
  noticeAddress: text("notice_address").notNull().default(""),
  notificationsEnabled: boolean("notifications_enabled").notNull().default(false),
  resendApiKey: text("resend_api_key"),
  fromEmail: text("from_email").notNull().default(""),
  slotIntervalMinutes: integer("slot_interval_minutes").notNull().default(15),
  leadTimeMinutes: integer("lead_time_minutes").notNull().default(0),
  lastSeatingOffsetMinutes: integer("last_seating_offset_minutes").notNull().default(0),
  eventsWatermark: bigint("events_watermark", { mode: "number" }).notNull().default(0),
  retentionDays: integer("retention_days").notNull().default(DEFAULT_RETENTION_DAYS),
  phoneCountry: text("phone_country"),
  turnTimes: jsonb("turn_times").$type<TurnTime[]>().notNull().default([]),
  overbookingCeiling: integer("overbooking_ceiling").notNull().default(0),
  maxAdvanceDays: integer("max_advance_days"),
  maxActivePerGuestPerDay: integer("max_active_per_guest_per_day"),
  blockedDates: jsonb("blocked_dates").$type<DateRange[]>().notNull().default([]),
  publicProfileEnabled: boolean("public_profile_enabled").notNull().default(false),
  publicStreet: text("public_street"),
  publicLocality: text("public_locality"),
  publicPostalCode: text("public_postal_code"),
  publicRegion: text("public_region"),
  publicCountry: text("public_country"),
  publicPhone: text("public_phone"),
  publicWebsiteUrl: text("public_website_url"),
  publicBookingUrl: text("public_booking_url"),
  publicCuisine: text("public_cuisine"),
  publicPriceRange: text("public_price_range"),
  publicLatitude: doublePrecision("public_latitude"),
  publicLongitude: doublePrecision("public_longitude"),
}, (t) => [
  check("venues_overbooking_ceiling", sql`${t.overbookingCeiling} >= 0 AND ${t.overbookingCeiling} <= 1000`),
  check("venues_max_advance_days", sql`${t.maxAdvanceDays} IS NULL OR (${t.maxAdvanceDays} >= 0 AND ${t.maxAdvanceDays} <= 1000)`),
  check(
    "venues_max_active_per_guest_per_day",
    sql`${t.maxActivePerGuestPerDay} IS NULL OR (${t.maxActivePerGuestPerDay} >= 1 AND ${t.maxActivePerGuestPerDay} <= 100)`,
  ),
  check(
    "venues_public_geo",
    sql`(${t.publicLatitude} IS NULL) = (${t.publicLongitude} IS NULL) AND (${t.publicLatitude} IS NULL OR (${t.publicLatitude} BETWEEN -90 AND 90 AND ${t.publicLongitude} BETWEEN -180 AND 180))`,
  ),
]);

export const services = pgTable(
  "services",
  {
    venueId: text("venue_id")
      .notNull()
      .references(() => venues.id),
    name: text("name").notNull(),
    openStart: text("open_start").notNull(),
    openEnd: text("open_end").notNull(),
    minPartySize: integer("min_party_size"),
    maxPartySize: integer("max_party_size"),
    // ISO weekdays (1 Monday to 7 Sunday) the service opens on. An overnight service
    // belongs to the day it opens. All seven by default.
    days: smallint("days").array().notNull().default(sql`'{1,2,3,4,5,6,7}'::smallint[]`),
  },
  (t) => [
    primaryKey({ columns: [t.venueId, t.name] }),
    check(
      "services_days",
      sql`cardinality(${t.days}) BETWEEN 1 AND 7 AND ${t.days} <@ ARRAY[1,2,3,4,5,6,7]::smallint[]`,
    ),
    check(
      "services_party_size_limits",
      sql`(${t.minPartySize} IS NULL OR ${t.minPartySize} >= 1) AND (${t.maxPartySize} IS NULL OR ${t.maxPartySize} >= 1) AND (${t.minPartySize} IS NULL OR ${t.maxPartySize} IS NULL OR ${t.minPartySize} <= ${t.maxPartySize})`,
    ),
  ],
);

export const tables = pgTable(
  "tables",
  {
    id: text("id").notNull(),
    venueId: text("venue_id")
      .notNull()
      .references(() => venues.id),
    name: text("name").notNull().default(""),
    seats: integer("seats").notNull(),
    zone: text("zone").notNull().default(""),
    shape: text("shape").notNull().default("round"),
    posX: integer("pos_x").notNull().default(0),
    posY: integer("pos_y").notNull().default(0),
    rotation: integer("rotation").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.venueId, t.id] })],
);

export const guests = pgTable(
  "guests",
  {
    id: text("id").primaryKey(),
    venueId: text("venue_id")
      .notNull()
      .references(() => venues.id),
    email: text("email"),
    phone: text("phone"),
    name: text("name").notNull().default(""),
    mergedInto: text("merged_into"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastVisitAt: timestamp("last_visit_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("uq_guests_venue_email").on(t.venueId, t.email),
    uniqueIndex("uq_guests_venue_phone").on(t.venueId, t.phone),
    index("idx_guests_venue_last_visit").on(t.venueId, t.lastVisitAt),
  ],
);

export interface GuestSnapshot {
  email: string | null;
  phone: string | null;
  name: string;
  lastVisitAt: string;
}

export const guestAudit = pgTable(
  "guest_audit",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    venueId: text("venue_id")
      .notNull()
      .references(() => venues.id),
    guestId: text("guest_id").notNull(),
    action: text("action")
      .$type<"created" | "erased" | "expired" | "merged" | "unmerged">()
      .notNull(),
    principal: text("principal").notNull().default(""),
    targetGuestId: text("target_guest_id"),
    priorState: jsonb("prior_state").$type<GuestSnapshot>(),
    reservationIds: jsonb("reservation_ids").$type<string[]>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_guest_audit_venue_guest").on(t.venueId, t.guestId),
    index("idx_guest_audit_venue_target").on(t.venueId, t.targetGuestId),
  ],
);

export const reservations = pgTable(
  "reservations",
  {
    id: text("id").primaryKey(),
    venueId: text("venue_id")
      .notNull()
      .references(() => venues.id),
    date: date("date").notNull(),
    service: text("service").notNull().default(""),
    zone: text("zone").notNull().default(""),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    partySize: integer("party_size").notNull(),
    status: text("status").notNull(),
    version: integer("version").notNull().default(1),
    bookedVia: text("booked_via").notNull().default(""),
    basis: text("basis").notNull().default(""),
    ownerPrincipal: text("owner_principal").notNull().default(""),
    guestName: text("guest_name").notNull().default(""),
    guestContact: text("guest_contact").notNull().default(""),
    guestId: text("guest_id").references(() => guests.id),
    consent: text("consent").$type<Consent>().notNull().default("unknown"),
    consentRecordedAt: timestamp("consent_recorded_at", { withTimezone: true }),
    rating: integer("rating").$type<Rating>(),
    ratingRecordedAt: timestamp("rating_recorded_at", { withTimezone: true }),
    reconfirmation: text("reconfirmation").$type<Reconfirmation>().notNull().default("none"),
    reconfirmationRecordedAt: timestamp("reconfirmation_recorded_at", { withTimezone: true }),
    commentary: text("commentary").notNull().default(""),
    erased: boolean("erased").notNull().default(false),
    guestLocale: text("guest_locale"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "reservations_guest_locale",
      sql`${t.guestLocale} IS NULL OR ${t.guestLocale} IN ('es', 'en', 'ca', 'fr', 'de', 'it', 'pt')`,
    ),
    check("reservations_commentary_length", sql`char_length(${t.commentary}) <= 500`),
    index("idx_reservations_venue_date").on(t.venueId, t.date),
    index("idx_reservations_venue_guest").on(t.venueId, t.guestId),
    index("idx_reservations_unlinked_retention")
      .on(t.venueId, t.endsAt, t.id)
      .where(sql`${t.guestId} is null and ${t.erased} = false and (${t.guestName} <> '' or ${t.guestContact} <> '' or ${t.commentary} <> '')`),
  ],
);

export const tableAllocations = pgTable(
  "table_allocations",
  {
    reservationId: text("reservation_id")
      .notNull()
      .references(() => reservations.id),
    venueId: text("venue_id").notNull(),
    tableId: text("table_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.reservationId, t.tableId] }),
    index("idx_allocations_venue_table").on(t.venueId, t.tableId),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: text("key").notNull(),
    venueId: text("venue_id").notNull(),
    reservationId: text("reservation_id").notNull(),
    kind: text("kind").notNull(),
    version: integer("version").notNull(),
  },
  (t) => [primaryKey({ columns: [t.venueId, t.key] })],
);

export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    venueId: text("venue_id").notNull(),
    type: text("type").notNull(),
    reservationId: text("reservation_id").notNull(),
    version: integer("version").notNull(),
    tombstoneHash: text("tombstone_hash"),
    // Who made the change (lib/origin.ts). Null on rows written before ADR-0023 and on system sweeps: unknown.
    channel: text("channel"),
    actor: text("actor"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_events_venue_occurred").on(t.venueId, t.occurredAt),
    check("events_channel", sql`${t.channel} IS NULL OR ${t.channel} IN ('widget', 'staff', 'api', 'mcp')`),
  ],
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: text("id").primaryKey(),
    venueId: text("venue_id")
      .notNull()
      .references(() => venues.id),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    lastEventId: bigint("last_event_id", { mode: "number" }).notNull(),
    failures: integer("failures").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Set only for endpoints created by a staff session after ADR-0011.
    // Older rows and endpoints created with a key stay null (unknown).
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    // Set when the creator is removed from the venue. The endpoint keeps working.
    creatorDepartedAt: timestamp("creator_departed_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_webhook_endpoints_venue").on(t.venueId),
    index("idx_webhook_endpoints_due").on(t.nextAttemptAt),
  ],
);

export const tombstones = pgTable("tombstones", {
  reservationId: text("reservation_id").primaryKey(),
  venueId: text("venue_id").notNull(),
  hash: text("hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const waitlist = pgTable(
  "waitlist",
  {
    id: text("id").primaryKey(),
    venueId: text("venue_id")
      .notNull()
      .references(() => venues.id),
    partySize: integer("party_size").notNull(),
    zone: text("zone").notNull().default(""),
    guestName: text("guest_name").notNull().default(""),
    guestContact: text("guest_contact").notNull().default(""),
    status: text("status").notNull().default("waiting"),
    reservationId: text("reservation_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_waitlist_venue_created").on(t.venueId, t.createdAt)],
);

export const sentEmails = pgTable(
  "sent_emails",
  {
    id: text("id").primaryKey(),
    venueId: text("venue_id")
      .notNull()
      .references(() => venues.id),
    reservationId: text("reservation_id").notNull(),
    kind: text("kind").notNull(),
    version: integer("version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_sent_emails_venue_reservation").on(t.venueId, t.reservationId),
    uniqueIndex("uq_sent_emails_once").on(
      t.venueId,
      t.reservationId,
      t.kind,
      t.version,
    ),
  ],
);

export const floorItems = pgTable(
  "floor_items",
  {
    id: text("id").primaryKey(),
    venueId: text("venue_id")
      .notNull()
      .references(() => venues.id),
    type: text("type").notNull(),
    label: text("label").notNull().default(""),
    posX: integer("pos_x").notNull().default(0),
    posY: integer("pos_y").notNull().default(0),
    width: integer("width").notNull().default(80),
    height: integer("height").notNull().default(40),
    rotation: integer("rotation").notNull().default(0),
  },
  (t) => [index("idx_floor_items_venue").on(t.venueId)],
);

export const apiKeys = pgTable("api_keys", {
  hash: text("hash").primaryKey(),
  principal: text("principal").notNull(),
  role: text("role").notNull().default("read"),
  // The staff member who minted the key. Null for keys made before ADR-0011
  // and for keys made through the global admin-key route.
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
});

export const grants = pgTable(
  "grants",
  {
    keyHash: text("key_hash")
      .notNull()
      .references(() => apiKeys.hash),
    venueId: text("venue_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.keyHash, t.venueId] })],
);

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull(),
    image: text("image"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    firstSignup: boolean("first_signup").notNull().default(false),
  },
  (t) => [
    uniqueIndex("uq_user_first_signup")
      .on(t.firstSignup)
      .where(sql`${t.firstSignup}`),
  ],
);

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export const venueMemberships = pgTable(
  "venue_memberships",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    venueId: text("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("read"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.venueId] })],
);

export const invitations = pgTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    venueId: text("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    email: text("email"),
    tokenHash: text("token_hash").notNull(),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    redeemedBy: text("redeemed_by").references(() => user.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_invitations_venue").on(t.venueId, t.createdAt),
    index("idx_invitations_expires").on(t.expiresAt),
    check("invitations_role", sql`${t.role} IN ('read', 'write', 'admin')`),
    check("invitations_not_both", sql`${t.redeemedAt} IS NULL OR ${t.revokedAt} IS NULL`),
  ],
);

export const membershipAudit = pgTable(
  "membership_audit",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    venueId: text("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    action: text("action")
      .$type<
        | "invited"
        | "invite_revoked"
        | "redeemed"
        | "member_removed"
        | "role_changed"
        | "creator_transferred"
        | "guest_blocked"
        | "guest_unblocked"
      >()
      .notNull(),
    actorUserId: text("actor_user_id"),
    targetUserId: text("target_user_id"),
    invitationId: text("invitation_id"),
    role: text("role"),
    blocklistEntryId: text("blocklist_entry_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_membership_audit_venue").on(t.venueId, t.occurredAt),
    check(
      "membership_audit_action",
      sql`${t.action} IN ('invited', 'invite_revoked', 'redeemed', 'member_removed', 'role_changed', 'creator_transferred', 'guest_blocked', 'guest_unblocked')`,
    ),
  ],
);

export const guestBlocklist = pgTable(
  "guest_blocklist",
  {
    id: text("id").primaryKey(),
    venueId: text("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ContactKey["kind"]>().notNull(),
    keyId: text("key_id").notNull(),
    hash: text("hash").notNull(),
    reason: text("reason").$type<BlocklistReason>(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_guest_blocklist_venue_key_hash").on(t.venueId, t.keyId, t.hash),
    index("idx_guest_blocklist_venue_created").on(t.venueId, t.createdAt),
    check("guest_blocklist_kind", sql`${t.kind} IN ('email', 'phone')`),
    check(
      "guest_blocklist_reason",
      sql`${t.reason} IS NULL OR ${t.reason} IN ('no_show', 'late_cancellation', 'conduct', 'other')`,
    ),
    check("guest_blocklist_key_id", sql`${t.keyId} ~ '^[0-9a-f]{16}$'`),
    check("guest_blocklist_hash", sql`${t.hash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const venueOnlineBooking = pgTable(
  "venue_online_booking",
  {
    venueId: text("venue_id")
      .primaryKey()
      .references(() => venues.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    bookingKey: text("booking_key"),
    allowedOrigins: jsonb("allowed_origins").$type<string[]>().notNull().default([]),
    services: jsonb("services").$type<string[]>(),
    weekdays: smallint("weekdays").array(),
    minPartySize: integer("min_party_size").notNull().default(1),
    maxPartySize: integer("max_party_size").notNull().default(8),
    leadTimeMinutes: integer("lead_time_minutes").notNull().default(0),
    maxAdvanceDays: integer("max_advance_days"),
    selfServiceCutoffMinutes: integer("self_service_cutoff_minutes").notNull().default(120),
    maxOpenBookingsPerContact: integer("max_open_bookings_per_contact").default(2),
    confirmationMode: text("confirmation_mode").notNull().default("auto"),
    askConsent: boolean("ask_consent").notNull().default(false),
    locale: text("locale").notNull().default("es"),
    theme: jsonb("theme").$type<Record<string, unknown>>().notNull().default({}),
    privacyNoticeUrl: text("privacy_notice_url"),
    // ADR-0021, section 2: the table zones the widget lets a guest pick, and whether it names the service of a time.
    publicZones: jsonb("public_zones").$type<string[]>().notNull().default([]),
    showServiceNames: boolean("show_service_names").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_venue_online_booking_key").on(t.bookingKey),
    check("venue_online_booking_key", sql`${t.bookingKey} IS NULL OR ${t.bookingKey} ~ '^pk_[A-Za-z0-9_-]{22}$'`),
    check(
      "venue_online_booking_party",
      sql`${t.minPartySize} BETWEEN 1 AND 100 AND ${t.maxPartySize} BETWEEN 1 AND 100 AND ${t.minPartySize} <= ${t.maxPartySize}`,
    ),
    check("venue_online_booking_lead", sql`${t.leadTimeMinutes} BETWEEN 0 AND 10080`),
    check("venue_online_booking_horizon", sql`${t.maxAdvanceDays} IS NULL OR ${t.maxAdvanceDays} BETWEEN 0 AND 1000`),
    check("venue_online_booking_cutoff", sql`${t.selfServiceCutoffMinutes} BETWEEN 0 AND 10080`),
    check(
      "venue_online_booking_open_cap",
      sql`${t.maxOpenBookingsPerContact} IS NULL OR ${t.maxOpenBookingsPerContact} BETWEEN 1 AND 20`,
    ),
    check("venue_online_booking_mode", sql`${t.confirmationMode} = 'auto'`),
    check("venue_online_booking_locale", sql`${t.locale} IN ('es', 'en', 'ca', 'fr', 'de', 'it', 'pt')`),
    check(
      "venue_online_booking_weekdays",
      sql`${t.weekdays} IS NULL OR (cardinality(${t.weekdays}) BETWEEN 1 AND 7 AND ${t.weekdays} <@ ARRAY[1,2,3,4,5,6,7]::smallint[])`,
    ),
    check("venue_online_booking_services", sql`${t.services} IS NULL OR jsonb_array_length(${t.services}) >= 1`),
    check(
      "venue_online_booking_public_zones",
      sql`jsonb_array_length(${t.publicZones}) = 0 OR jsonb_array_length(${t.publicZones}) BETWEEN 2 AND 10`,
    ),
    check("venue_online_booking_origins", sql`jsonb_array_length(${t.allowedOrigins}) <= 10`),
    check(
      "venue_online_booking_privacy_url",
      sql`${t.privacyNoticeUrl} IS NULL OR (${t.privacyNoticeUrl} ~* '^https://[^/?#@[:space:][:cntrl:]]' AND ${t.privacyNoticeUrl} !~ '[[:space:][:cntrl:]]' AND char_length(${t.privacyNoticeUrl}) <= 2048)`,
    ),
  ],
);

// ADR-0017: one capability link per reservation. Only the SHA-256 of the secret is stored.
export const selfServiceLinks = pgTable(
  "self_service_links",
  {
    id: text("id").primaryKey(),
    venueId: text("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    reservationId: text("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    secretHash: text("secret_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    // The public key of the guest cancel that revoked the link, so a repeat of that cancel can replay.
    cancelKey: text("cancel_key"),
  },
  (t) => [
    uniqueIndex("uq_self_service_links_live").on(t.reservationId).where(sql`${t.revokedAt} IS NULL`),
    index("idx_self_service_links_expires").on(t.expiresAt),
    check("self_service_links_hash", sql`${t.secretHash} ~ '^[0-9a-f]{64}$'`),
    check("self_service_links_cancel_revoked", sql`${t.cancelKey} IS NULL OR ${t.revokedAt} IS NOT NULL`),
  ],
);

// Hosted demo (ADR-0022). One sandbox venue per account. `last_sign_in_at` starts the 14-day expiry. The rows
// vanish with the account or the venue.
export const demoSandboxes = pgTable("demo_sandbox", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  venueId: text("venue_id")
    .notNull()
    .unique()
    .references(() => venues.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }).notNull().defaultNow(),
  // The visitor's address with Gmail dots and +tags removed (demo/normalize.ts). One sandbox per value (audit F4).
  normalizedEmail: text("normalized_email").notNull().unique(),
});

// A demo visitor's contact. Deliberately not tied to the account: it outlives the sandbox. No HTTP route reads it.
export const demoLeads = pgTable("demo_lead", {
  // The verified address as the visitor signed in with it: where outreach goes.
  email: text("email").primaryKey(),
  // The same value `demo_sandbox.normalized_email` holds (demo/normalize.ts). One lead per person, however spelled.
  normalizedEmail: text("normalized_email").notNull().unique(),
  name: text("name"),
  source: text("source").notNull(),
  locale: text("locale").notNull().default("en"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  contactConsent: boolean("contact_consent").notNull().default(false),
  consentTextVersion: text("consent_text_version"),
  // Set by the unsubscribe route or by an operator. A withdrawn row is excluded from the export.
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
});

export const betterAuthSchema = { user, session, account, verification };
