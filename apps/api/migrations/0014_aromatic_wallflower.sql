CREATE TABLE "webhook_endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"venue_id" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_event_id" bigint NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_webhook_endpoints_venue" ON "webhook_endpoints" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_endpoints_due" ON "webhook_endpoints" USING btree ("next_attempt_at");