CREATE TABLE "floor_items" (
	"id" text PRIMARY KEY NOT NULL,
	"venue_id" text NOT NULL,
	"type" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"pos_x" integer DEFAULT 0 NOT NULL,
	"pos_y" integer DEFAULT 0 NOT NULL,
	"width" integer DEFAULT 80 NOT NULL,
	"height" integer DEFAULT 40 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "floor_items" ADD CONSTRAINT "floor_items_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_floor_items_venue" ON "floor_items" USING btree ("venue_id");