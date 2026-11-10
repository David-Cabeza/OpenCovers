CREATE TABLE "sent_emails" (
	"id" text PRIMARY KEY NOT NULL,
	"venue_id" text NOT NULL,
	"reservation_id" text NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "notifications_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sent_emails" ADD CONSTRAINT "sent_emails_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sent_emails_venue_reservation" ON "sent_emails" USING btree ("venue_id","reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sent_emails_once" ON "sent_emails" USING btree ("venue_id","reservation_id","kind","version");