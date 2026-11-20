ALTER TABLE "demo_lead" ADD COLUMN "normalized_email" text;--> statement-breakpoint
-- Same value demo/normalize.ts computes, minus Unicode NFKC and IDNA, which SQL lacks. Addresses with those are rare
-- and fix themselves on the lead's next sign-in.
UPDATE "demo_lead" SET "normalized_email" = CASE
  WHEN split_part(lower("email"), '@', 2) IN ('gmail.com', 'googlemail.com')
    THEN replace(split_part(split_part(lower("email"), '@', 1), '+', 1), '.', '') || '@gmail.com'
  ELSE lower("email")
END;--> statement-breakpoint
-- ADR-0022 decision 8b: one lead per normalized address. Where spellings of one address already have rows, the most
-- recently seen one stays.
DELETE FROM "demo_lead" a USING "demo_lead" b
WHERE a."normalized_email" = b."normalized_email"
  AND (a."last_seen_at", a."email") < (b."last_seen_at", b."email");--> statement-breakpoint
ALTER TABLE "demo_lead" ALTER COLUMN "normalized_email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_lead" ADD CONSTRAINT "demo_lead_normalized_email_unique" UNIQUE("normalized_email");
