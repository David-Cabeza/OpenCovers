ALTER TABLE "venues" ADD COLUMN "lead_time_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "last_seating_offset_minutes" integer DEFAULT 0 NOT NULL;