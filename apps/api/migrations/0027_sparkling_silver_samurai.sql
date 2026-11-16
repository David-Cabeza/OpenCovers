CREATE TABLE "membership_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"venue_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" text,
	"target_user_id" text,
	"invitation_id" text,
	"role" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_audit_action" CHECK ("membership_audit"."action" IN ('invited', 'invite_revoked', 'redeemed', 'member_removed'))
);
--> statement-breakpoint
ALTER TABLE "membership_audit" ADD CONSTRAINT "membership_audit_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_membership_audit_venue" ON "membership_audit" USING btree ("venue_id","occurred_at");