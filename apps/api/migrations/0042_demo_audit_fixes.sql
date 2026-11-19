ALTER TABLE "demo_lead" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
-- ADR-0022 decision 7: a lead row exists only with consent. Rows 0040's code wrote without it are dropped.
DELETE FROM "demo_lead" WHERE "contact_consent" = false;--> statement-breakpoint
ALTER TABLE "demo_sandbox" ADD COLUMN "normalized_email" text;--> statement-breakpoint
-- Rows made by 0040's code get the same value demo/normalize.ts computes (minus Unicode NFKC, which SQL lacks).
UPDATE "demo_sandbox" AS s SET "normalized_email" = CASE
  WHEN split_part(lower(u."email"), '@', 2) IN ('gmail.com', 'googlemail.com')
    THEN replace(split_part(split_part(lower(u."email"), '@', 1), '+', 1), '.', '') || '@gmail.com'
  ELSE lower(u."email")
END FROM "user" AS u WHERE u."id" = s."user_id";--> statement-breakpoint
ALTER TABLE "demo_sandbox" ALTER COLUMN "normalized_email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_sandbox" ADD CONSTRAINT "demo_sandbox_normalized_email_unique" UNIQUE("normalized_email");
