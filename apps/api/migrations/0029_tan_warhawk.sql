ALTER TABLE "venues" ADD COLUMN "public_profile_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "public_street" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "public_locality" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "public_postal_code" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "public_region" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "public_country" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "public_phone" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "public_website_url" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "public_booking_url" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "public_cuisine" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "public_price_range" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "public_latitude" double precision;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "public_longitude" double precision;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_public_geo" CHECK (("venues"."public_latitude" IS NULL) = ("venues"."public_longitude" IS NULL) AND ("venues"."public_latitude" IS NULL OR ("venues"."public_latitude" BETWEEN -90 AND 90 AND "venues"."public_longitude" BETWEEN -180 AND 180)));