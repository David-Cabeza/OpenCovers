ALTER TABLE "venues" ADD COLUMN "resend_api_key" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "from_email" text DEFAULT '' NOT NULL;