ALTER TABLE "table_allocations" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE "table_allocations" SET "active" = false FROM "reservations" WHERE "reservations"."id" = "table_allocations"."reservation_id" AND "reservations"."status" IN ('attended', 'no_show');--> statement-breakpoint
ALTER TABLE "table_allocations" DROP CONSTRAINT "table_allocations_no_overlap";--> statement-breakpoint
ALTER TABLE "table_allocations" ADD CONSTRAINT "table_allocations_no_overlap" EXCLUDE USING gist ("venue_id" WITH =, "table_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&) WHERE ("active");
