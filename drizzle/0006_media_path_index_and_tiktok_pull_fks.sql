-- Generated from src/db/schema.ts on 2026-11-19, then edited by hand: the
-- lock timeout is not expressible in schema.ts.
--
-- The media index becomes a full index because the "file still in use"
-- check now covers four statuses and the orphan sweep reads every row. The
-- two pending_tiktok_pulls foreign keys get ON DELETE SET NULL, so deleting a
-- scheduled post or history row that TikTok already pulled no longer fails
-- with 23503.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "pending_tiktok_pulls" DROP CONSTRAINT "pending_tiktok_pulls_content_history_id_fkey";
--> statement-breakpoint
ALTER TABLE "pending_tiktok_pulls" DROP CONSTRAINT "pending_tiktok_pulls_scheduled_post_id_fkey";
--> statement-breakpoint
DROP INDEX "idx_scheduled_posts_media_storage_path_active";--> statement-breakpoint
ALTER TABLE "pending_tiktok_pulls" ADD CONSTRAINT "pending_tiktok_pulls_content_history_id_fkey" FOREIGN KEY ("content_history_id") REFERENCES "public"."content_history"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_tiktok_pulls" ADD CONSTRAINT "pending_tiktok_pulls_scheduled_post_id_fkey" FOREIGN KEY ("scheduled_post_id") REFERENCES "public"."scheduled_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_scheduled_posts_media_storage_path" ON "scheduled_posts" USING btree ("media_storage_path");