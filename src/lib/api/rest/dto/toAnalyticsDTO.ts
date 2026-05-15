import type { Database } from "@/lib/types/database.types";

type AnalyticsMetricsRow =
  Database["public"]["Tables"]["analytics_metrics"]["Row"];

/**
 * Public DTO for an analytics metrics row. Excludes internal
 * `extra` jsonb and `updated_at`. Explicit field-by-field copy
 * prevents new columns from auto-leaking.
 */
export type AnalyticsDTO = {
  id: string;
  platform: string;
  content_id: string | null;
  metric_date: string;
  views: number;
  comments: number;
  likes: number;
  shares: number;
  subscribers: number;
  created_at: string;
};

export function toAnalyticsDTO(row: AnalyticsMetricsRow): AnalyticsDTO {
  return {
    id: row.id,
    platform: row.platform,
    content_id: row.content_id,
    metric_date: row.metric_date,
    views: row.views,
    comments: row.comments,
    likes: row.likes,
    shares: row.shares,
    subscribers: row.subscribers,
    created_at: row.created_at,
  };
}
