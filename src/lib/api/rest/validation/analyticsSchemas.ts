import { z } from "zod";

import {
  POSTING_PLATFORMS,
  SCHEDULABLE_PLATFORMS,
} from "@/lib/platforms/capabilities";
import {
  CreatedAtCursorSchema,
  MetricDateCursorSchema,
} from "@/lib/api/rest/pagination";

const AnalyticsPlatformEnum = z.enum(POSTING_PLATFORMS);

/**
 * Query schema for GET /v1/analytics.
 */
export const AnalyticsQuerySchema = z.object({
  platform: AnalyticsPlatformEnum.optional(),
  content_id: z.string().optional(),
  days: z.coerce.number().int().min(1).max(90).default(30),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  // This endpoint pages on (metric_date, id): every row of a day shares its
  // metric_date.
  cursor: MetricDateCursorSchema.optional(),
});

export type AnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>;

/** content_history holds posts from every platform the worker publishes to. */
const ContentHistoryPlatformEnum = z.enum(SCHEDULABLE_PLATFORMS);

/**
 * Query schema for GET /v1/content-history.
 */
export const ContentHistoryQuerySchema = z.object({
  platform: ContentHistoryPlatformEnum.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: CreatedAtCursorSchema.optional(),
});

export type ContentHistoryQuery = z.infer<typeof ContentHistoryQuerySchema>;
