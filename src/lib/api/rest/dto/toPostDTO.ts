import type { scheduled_posts } from "@/db/schema";
import type { PostDTO } from "@/lib/api/rest/openapi/responseSchemas";

type ScheduledPostRow = typeof scheduled_posts.$inferSelect;

/**
 * Public DTO for a post; its shape is PostDTOSchema (responseSchemas.ts),
 * the same schema the OpenAPI spec renders. Only fields part of the
 * external contract. Internal fields (retry counters, internal flags,
 * cancelled_by_sub_at, raw error_message) intentionally NOT exposed.
 *
 * Adding a column to scheduled_posts MUST NOT auto-leak via this function:
 * explicit field-by-field copying is the safety net.
 *
 * Column mapping: DB uses post_title/post_description/media_type
 * but the API exposes title/description/post_type for readability.
 */
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
