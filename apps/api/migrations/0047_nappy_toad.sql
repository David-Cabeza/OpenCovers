CREATE TABLE "waitlist_links" (
	"id" text PRIMARY KEY NOT NULL,
	"venue_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"leave_key" text,
	CONSTRAINT "waitlist_links_hash" CHECK ("waitlist_links"."secret_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "waitlist_links_leave_revoked" CHECK ("waitlist_links"."leave_key" IS NULL OR "waitlist_links"."revoked_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "venue_online_booking" ADD COLUMN "waitlist_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "date" date;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "window_start" text;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "window_end" text;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "source" text DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waitlist_links" ADD CONSTRAINT "waitlist_links_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_links" ADD CONSTRAINT "waitlist_links_entry_id_waitlist_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."waitlist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_waitlist_links_entry" ON "waitlist_links" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "idx_waitlist_venue_date" ON "waitlist" USING btree ("venue_id","date");--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_source" CHECK ("waitlist"."source" IN ('staff', 'widget'));--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_window" CHECK (("waitlist"."window_start" IS NULL AND "waitlist"."window_end" IS NULL) OR ("waitlist"."window_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "waitlist"."window_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "waitlist"."window_start" < "waitlist"."window_end"));--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_widget_entry" CHECK ("waitlist"."source" = 'staff' OR ("waitlist"."date" IS NOT NULL AND "waitlist"."consent_at" IS NOT NULL));