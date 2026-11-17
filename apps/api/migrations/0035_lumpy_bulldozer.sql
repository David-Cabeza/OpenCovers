CREATE TABLE "venue_online_booking" (
	"venue_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"booking_key" text,
	"allowed_origins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"services" jsonb,
	"weekdays" smallint[],
	"min_party_size" integer DEFAULT 1 NOT NULL,
	"max_party_size" integer DEFAULT 8 NOT NULL,
	"lead_time_minutes" integer DEFAULT 0 NOT NULL,
	"max_advance_days" integer,
	"self_service_cutoff_minutes" integer DEFAULT 120 NOT NULL,
	"max_open_bookings_per_contact" integer DEFAULT 2,
	"confirmation_mode" text DEFAULT 'auto' NOT NULL,
	"ask_consent" boolean DEFAULT false NOT NULL,
	"locale" text DEFAULT 'es' NOT NULL,
	"theme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_online_booking_key" CHECK ("venue_online_booking"."booking_key" IS NULL OR "venue_online_booking"."booking_key" ~ '^pk_[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "venue_online_booking_party" CHECK ("venue_online_booking"."min_party_size" BETWEEN 1 AND 100 AND "venue_online_booking"."max_party_size" BETWEEN 1 AND 100 AND "venue_online_booking"."min_party_size" <= "venue_online_booking"."max_party_size"),
	CONSTRAINT "venue_online_booking_lead" CHECK ("venue_online_booking"."lead_time_minutes" BETWEEN 0 AND 10080),
	CONSTRAINT "venue_online_booking_horizon" CHECK ("venue_online_booking"."max_advance_days" IS NULL OR "venue_online_booking"."max_advance_days" BETWEEN 0 AND 1000),
	CONSTRAINT "venue_online_booking_cutoff" CHECK ("venue_online_booking"."self_service_cutoff_minutes" BETWEEN 0 AND 10080),
	CONSTRAINT "venue_online_booking_open_cap" CHECK ("venue_online_booking"."max_open_bookings_per_contact" IS NULL OR "venue_online_booking"."max_open_bookings_per_contact" BETWEEN 1 AND 20),
	CONSTRAINT "venue_online_booking_mode" CHECK ("venue_online_booking"."confirmation_mode" = 'auto'),
	CONSTRAINT "venue_online_booking_locale" CHECK ("venue_online_booking"."locale" IN ('es', 'en')),
	CONSTRAINT "venue_online_booking_weekdays" CHECK ("venue_online_booking"."weekdays" IS NULL OR (cardinality("venue_online_booking"."weekdays") BETWEEN 1 AND 7 AND "venue_online_booking"."weekdays" <@ ARRAY[1,2,3,4,5,6,7]::smallint[])),
	CONSTRAINT "venue_online_booking_services" CHECK ("venue_online_booking"."services" IS NULL OR jsonb_array_length("venue_online_booking"."services") >= 1),
	CONSTRAINT "venue_online_booking_origins" CHECK (jsonb_array_length("venue_online_booking"."allowed_origins") <= 10)
);
--> statement-breakpoint
ALTER TABLE "venue_online_booking" ADD CONSTRAINT "venue_online_booking_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_venue_online_booking_key" ON "venue_online_booking" USING btree ("booking_key");