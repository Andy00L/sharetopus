import type { Database } from "@/lib/types/database.types";

type ScheduledPostRow =
  Database["public"]["Tables"]["scheduled_posts"]["Row"];

/**
 * Public DTO for a post. Only fields part of the external contract.
 * Internal fields (retry counters, internal flags, cancelled_by_sub_at,
 * raw error_message) intentionally NOT exposed.
 *
 * Single source of truth for what REST returns. Adding a column to
 * scheduled_posts MUST NOT auto-leak via this function: explicit
 * field-by-field copying is the safety net.
 *
 * Column mapping: DB uses post_title/post_description/media_type
 * but the API exposes title/description/post_type for readability.
 */
export type PostDTO = {
  id: string;
  status: string;
  platform: string;
  post_type: string;
  title: string | null;
  description: string | null;
  scheduled_at: string;
  posted_at: string | null;
  social_account_id: string;
  media_storage_path: string;
  batch_id: string | null;
  created_at: string;
};

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
