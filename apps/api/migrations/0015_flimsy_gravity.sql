ALTER TABLE "reservations" ADD COLUMN "rating" integer;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "rating_recorded_at" timestamp with time zone;