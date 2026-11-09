CREATE TABLE "venue_memberships" (
	"user_id" text NOT NULL,
	"venue_id" text NOT NULL,
	"role" text DEFAULT 'read' NOT NULL,
	CONSTRAINT "venue_memberships_user_id_venue_id_pk" PRIMARY KEY("user_id","venue_id")
);
--> statement-breakpoint
ALTER TABLE "venue_memberships" ADD CONSTRAINT "venue_memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_memberships" ADD CONSTRAINT "venue_memberships_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;