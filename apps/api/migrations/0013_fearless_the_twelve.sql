ALTER TABLE "reservations" ADD COLUMN "consent" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "consent_recorded_at" timestamp with time zone;