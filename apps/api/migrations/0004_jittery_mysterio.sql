CREATE TABLE "waitlist" (
	"id" text PRIMARY KEY NOT NULL,
	"venue_id" text NOT NULL,
	"party_size" integer NOT NULL,
	"zone" text DEFAULT '' NOT NULL,
	"guest_name" text DEFAULT '' NOT NULL,
	"guest_contact" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"reservation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_waitlist_venue_created" ON "waitlist" USING btree ("venue_id","created_at");