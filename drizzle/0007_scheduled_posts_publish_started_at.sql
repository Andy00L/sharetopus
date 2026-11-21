-- Generated from src/db/schema.ts on 2026-11-21, then edited by hand: the
-- lock timeout is not expressible in schema.ts.
--
-- publish_started_at is the claim a post.due run takes right before it calls
-- the platform. A retry that finds it set never calls the platform again.
-- Nullable with no default, so the column is added without rewriting rows.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD COLUMN "publish_started_at" timestamp with time zone;
