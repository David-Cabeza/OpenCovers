CREATE TABLE "api_keys" (
	"hash" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"role" text DEFAULT 'read' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"venue_id" text NOT NULL,
	"type" text NOT NULL,
	"reservation_id" text NOT NULL,
	"version" integer NOT NULL,
	"tombstone_hash" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grants" (
	"key_hash" text NOT NULL,
	"venue_id" text NOT NULL,
	CONSTRAINT "grants_key_hash_venue_id_pk" PRIMARY KEY("key_hash","venue_id")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text NOT NULL,
	"venue_id" text NOT NULL,
	"reservation_id" text NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "idempotency_keys_venue_id_key_pk" PRIMARY KEY("venue_id","key")
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"venue_id" text NOT NULL,
	"date" date NOT NULL,
	"service" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"party_size" integer NOT NULL,
	"status" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"booked_via" text DEFAULT '' NOT NULL,
	"basis" text DEFAULT '' NOT NULL,
	"owner_principal" text DEFAULT '' NOT NULL,
	"guest_name" text DEFAULT '' NOT NULL,
	"guest_contact" text DEFAULT '' NOT NULL,
	"erased" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"venue_id" text NOT NULL,
	"name" text NOT NULL,
	"open_start" text NOT NULL,
	"open_end" text NOT NULL,
	CONSTRAINT "services_venue_id_name_pk" PRIMARY KEY("venue_id","name")
);
--> statement-breakpoint
CREATE TABLE "table_allocations" (
	"reservation_id" text NOT NULL,
	"venue_id" text NOT NULL,
	"table_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	CONSTRAINT "table_allocations_reservation_id_table_id_pk" PRIMARY KEY("reservation_id","table_id")
);
--> statement-breakpoint
CREATE TABLE "tables" (
	"id" text NOT NULL,
	"venue_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"seats" integer NOT NULL,
	"zone" text DEFAULT '' NOT NULL,
	CONSTRAINT "tables_venue_id_id_pk" PRIMARY KEY("venue_id","id")
);
--> statement-breakpoint
CREATE TABLE "tombstones" (
	"reservation_id" text PRIMARY KEY NOT NULL,
	"venue_id" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"notice_address" text DEFAULT '' NOT NULL,
	"slot_interval_minutes" integer DEFAULT 15 NOT NULL,
	"retention_days" integer DEFAULT 400 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_key_hash_api_keys_hash_fk" FOREIGN KEY ("key_hash") REFERENCES "public"."api_keys"("hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_allocations" ADD CONSTRAINT "table_allocations_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tables" ADD CONSTRAINT "tables_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_events_venue_occurred" ON "events" USING btree ("venue_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_reservations_venue_date" ON "reservations" USING btree ("venue_id","date");--> statement-breakpoint
CREATE INDEX "idx_allocations_venue_table" ON "table_allocations" USING btree ("venue_id","table_id");
--> statement-breakpoint
ALTER TABLE "table_allocations" ADD CONSTRAINT "table_allocations_no_overlap" EXCLUDE USING gist ("venue_id" WITH =, "table_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&);
