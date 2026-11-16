CREATE TABLE "invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"venue_id" text NOT NULL,
	"role" text NOT NULL,
	"email" text,
	"token_hash" text NOT NULL,
	"invited_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"redeemed_by" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "invitations_role" CHECK ("invitations"."role" IN ('read', 'write', 'admin')),
	CONSTRAINT "invitations_not_both" CHECK ("invitations"."redeemed_at" IS NULL OR "invitations"."revoked_at" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_redeemed_by_user_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_invitations_venue" ON "invitations" USING btree ("venue_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_invitations_expires" ON "invitations" USING btree ("expires_at");