CREATE TABLE "guest_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"venue_id" text NOT NULL,
	"guest_id" text NOT NULL,
	"action" text NOT NULL,
	"principal" text DEFAULT '' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"id" text PRIMARY KEY NOT NULL,
	"venue_id" text NOT NULL,
	"email" text,
	"phone" text,
	"name" text DEFAULT '' NOT NULL,
	"merged_into" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_visit_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "guest_id" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "phone_country" text;--> statement-breakpoint
ALTER TABLE "guest_audit" ADD CONSTRAINT "guest_audit_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_guest_audit_venue_guest" ON "guest_audit" USING btree ("venue_id","guest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_guests_venue_email" ON "guests" USING btree ("venue_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_guests_venue_phone" ON "guests" USING btree ("venue_id","phone");--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_reservations_venue_guest" ON "reservations" USING btree ("venue_id","guest_id");