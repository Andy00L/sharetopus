import { z } from "zod";

const AnalyticsPlatformEnum = z.enum([
  "linkedin",
  "tiktok",
  "pinterest",
  "instagram",
]);

/**
 * Query schema for GET /v1/analytics.
 */
export const AnalyticsQuerySchema = z.object({
  platform: AnalyticsPlatformEnum.optional(),
  content_id: z.string().optional(),
  days: z.coerce.number().int().min(1).max(90).default(30),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type AnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>;

const ContentHistoryPlatformEnum = z.enum([
  "linkedin",
  "tiktok",
  "pinterest",
  "instagram",
  "facebook",
  "threads",
  "youtube",
  "x",
]);

/**
 * Query schema for GET /v1/content-history.
 */
export const ContentHistoryQuerySchema = z.object({
  platform: ContentHistoryPlatformEnum.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type ContentHistoryQuery = z.infer<typeof ContentHistoryQuerySchema>;
