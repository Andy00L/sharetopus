import type { scheduled_posts } from "@/db/schema";
import type { PostDTO } from "@/lib/api/rest/openapi/responseSchemas";

type ScheduledPostRow = typeof scheduled_posts.$inferSelect;

export function toPostDTO(row: ScheduledPostRow): PostDTO {
  return {
    id: row.id,
    status: row.status,
    platform: row.platform,
    post_type: row.media_type,
    title: row.post_title ?? null,
    description: row.post_description,
    scheduled_at: row.scheduled_at,
    posted_at: row.posted_at,
    social_account_id: row.social_account_id,
    media_storage_path: row.media_storage_path,
    batch_id: row.batch_id,
    created_at: row.created_at,
  };
}
