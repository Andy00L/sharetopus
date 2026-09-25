import type { analytics_metrics } from "@/db/schema";
import type { AnalyticsDTO } from "@/lib/api/rest/openapi/responseSchemas";

type AnalyticsMetricsRow = typeof analytics_metrics.$inferSelect;

/**
 * Public DTO for an analytics metrics row; its shape is AnalyticsDTOSchema
 * (responseSchemas.ts), the same schema the OpenAPI spec renders. Excludes
 * internal `extra` jsonb and `updated_at`. Explicit field-by-field copy
 * prevents new columns from auto-leaking.
 */
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
