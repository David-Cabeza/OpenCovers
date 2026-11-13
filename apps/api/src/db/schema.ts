import type { Consent } from "../lib/consent";
import type { Rating } from "../lib/rating";
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
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
});

export const services = pgTable(
  "services",
  {
    venueId: text("venue_id")
      .notNull()
      .references(() => venues.id),
    name: text("name").notNull(),
    openStart: text("open_start").notNull(),
    openEnd: text("open_end").notNull(),
  },
  (t) => [primaryKey({ columns: [t.venueId, t.name] })],
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

export const guestAudit = pgTable(
  "guest_audit",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    venueId: text("venue_id")
      .notNull()
      .references(() => venues.id),
    guestId: text("guest_id").notNull(),
    action: text("action").$type<"created" | "erased" | "expired">().notNull(),
    principal: text("principal").notNull().default(""),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_guest_audit_venue_guest").on(t.venueId, t.guestId)],
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
    erased: boolean("erased").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_reservations_venue_date").on(t.venueId, t.date),
    index("idx_reservations_venue_guest").on(t.venueId, t.guestId),
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
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_events_venue_occurred").on(t.venueId, t.occurredAt)],
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

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

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

export const betterAuthSchema = { user, session, account, verification };
