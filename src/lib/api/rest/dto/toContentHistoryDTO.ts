import type { Database } from "@/lib/types/database.types";

type ContentHistoryRow =
  Database["public"]["Tables"]["content_history"]["Row"];

/**
 * Public DTO for a content history row. Excludes internal `extra`
 * jsonb and `social_account_id`. Explicit field-by-field copy.
 */
export type ContentHistoryDTO = {
  id: string;
  platform: string;
  content_id: string;
  scheduled_post_id: string | null;
  title: string | null;
  description: string | null;
  media_url: string | null;
  media_type: string | null;
  status: string | null;
  batch_id: string | null;
  created_via: string;
  created_at: string;
};

export function toContentHistoryDTO(
  row: ContentHistoryRow,
): ContentHistoryDTO {
  return {
    id: row.id,
    platform: row.platform,
    content_id: row.content_id,
    scheduled_post_id: row.scheduled_post_id,
    title: row.title,
    description: row.description,
    media_url: row.media_url,
    media_type: row.media_type,
    status: row.status,
    batch_id: row.batch_id,
    created_via: row.created_via,
    created_at: row.created_at,
  };
}
