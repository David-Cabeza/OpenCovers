CREATE TABLE "self_service_links" (
	"id" text PRIMARY KEY NOT NULL,
	"venue_id" text NOT NULL,
	"reservation_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"cancel_key" text,
	CONSTRAINT "self_service_links_hash" CHECK ("self_service_links"."secret_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "self_service_links_cancel_revoked" CHECK ("self_service_links"."cancel_key" IS NULL OR "self_service_links"."revoked_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "self_service_links" ADD CONSTRAINT "self_service_links_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_service_links" ADD CONSTRAINT "self_service_links_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_self_service_links_live" ON "self_service_links" USING btree ("reservation_id") WHERE "self_service_links"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_self_service_links_expires" ON "self_service_links" USING btree ("expires_at");