CREATE TABLE "demo_lead" (
	"email" text PRIMARY KEY NOT NULL,
	"name" text,
	"source" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contact_consent" boolean DEFAULT false NOT NULL,
	"consent_text_version" text
);
--> statement-breakpoint
CREATE TABLE "demo_sandbox" (
	"user_id" text PRIMARY KEY NOT NULL,
	"venue_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sign_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_sandbox_venue_id_unique" UNIQUE("venue_id")
);
--> statement-breakpoint
ALTER TABLE "demo_sandbox" ADD CONSTRAINT "demo_sandbox_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_sandbox" ADD CONSTRAINT "demo_sandbox_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;