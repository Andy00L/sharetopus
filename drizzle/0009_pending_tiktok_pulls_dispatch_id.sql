-- Generated from src/db/schema.ts on 2026-11-21, then edited by hand: the
-- lock timeout is not expressible in schema.ts.
--
-- dispatch_id links a TikTok pull to the post-now dispatch that made it, so a
-- TikTok rejection fails that dispatch and no other. Nullable with no
-- default, so the column is added without rewriting rows; every existing row
-- holds null, so the foreign key validates without a lookup. ON DELETE SET
-- NULL, as the pull's other two links.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "pending_tiktok_pulls" ADD COLUMN "dispatch_id" text;--> statement-breakpoint
ALTER TABLE "pending_tiktok_pulls" ADD CONSTRAINT "pending_tiktok_pulls_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "public"."pending_direct_posts"("event_id") ON DELETE set null ON UPDATE no action;
