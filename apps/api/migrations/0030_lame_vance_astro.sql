ALTER TABLE "venues" ADD COLUMN "max_advance_days" integer;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "max_active_per_guest_per_day" integer;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "blocked_dates" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_max_advance_days" CHECK ("venues"."max_advance_days" IS NULL OR ("venues"."max_advance_days" >= 0 AND "venues"."max_advance_days" <= 1000));--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_max_active_per_guest_per_day" CHECK ("venues"."max_active_per_guest_per_day" IS NULL OR ("venues"."max_active_per_guest_per_day" >= 1 AND "venues"."max_active_per_guest_per_day" <= 100));