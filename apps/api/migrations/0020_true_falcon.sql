ALTER TABLE "guest_audit" ADD COLUMN "target_guest_id" text;--> statement-breakpoint
ALTER TABLE "guest_audit" ADD COLUMN "prior_state" jsonb;--> statement-breakpoint
ALTER TABLE "guest_audit" ADD COLUMN "reservation_ids" jsonb;--> statement-breakpoint
CREATE INDEX "idx_guest_audit_venue_target" ON "guest_audit" USING btree ("venue_id","target_guest_id");