CREATE TABLE "guest_blocklist" (
	"id" text PRIMARY KEY NOT NULL,
	"venue_id" text NOT NULL,
	"kind" text NOT NULL,
	"key_id" text NOT NULL,
	"hash" text NOT NULL,
	"reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_blocklist_kind" CHECK ("guest_blocklist"."kind" IN ('email', 'phone')),
	CONSTRAINT "guest_blocklist_reason" CHECK ("guest_blocklist"."reason" IS NULL OR "guest_blocklist"."reason" IN ('no_show', 'late_cancellation', 'conduct', 'other')),
	CONSTRAINT "guest_blocklist_key_id" CHECK ("guest_blocklist"."key_id" ~ '^[0-9a-f]{16}$'),
	CONSTRAINT "guest_blocklist_hash" CHECK ("guest_blocklist"."hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "guest_blocklist" ADD CONSTRAINT "guest_blocklist_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_guest_blocklist_venue_key_hash" ON "guest_blocklist" USING btree ("venue_id","key_id","hash");--> statement-breakpoint
CREATE INDEX "idx_guest_blocklist_venue_created" ON "guest_blocklist" USING btree ("venue_id","created_at");