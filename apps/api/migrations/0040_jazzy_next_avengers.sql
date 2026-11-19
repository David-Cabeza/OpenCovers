ALTER TABLE "events" ADD COLUMN "channel" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "actor" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_channel" CHECK ("events"."channel" IS NULL OR "events"."channel" IN ('widget', 'staff', 'api', 'mcp'));