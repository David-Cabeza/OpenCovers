import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const venues = pgTable("venues", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  timezone: text("timezone").notNull().default("UTC"),
  enabled: boolean("enabled").notNull().default(false),
  noticeAddress: text("notice_address").notNull().default(""),
  slotIntervalMinutes: integer("slot_interval_minutes").notNull().default(15),
  retentionDays: integer("retention_days").notNull().default(400),
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
  },
  (t) => [primaryKey({ columns: [t.venueId, t.id] })],
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
    erased: boolean("erased").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_reservations_venue_date").on(t.venueId, t.date)],
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
