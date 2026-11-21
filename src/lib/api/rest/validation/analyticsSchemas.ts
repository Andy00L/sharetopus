import { z } from "zod";

import {
  ADAPTER_PLATFORMS,
  SCHEDULABLE_PLATFORMS,
} from "@/lib/platforms/capabilities";
import {
  CreatedAtCursorSchema,
  MetricDateCursorSchema,
} from "@/lib/api/rest/pagination";

const AnalyticsPlatformEnum = z.enum(ADAPTER_PLATFORMS);

export const AnalyticsQuerySchema = z.object({
  platform: AnalyticsPlatformEnum.optional(),
  content_id: z.string().optional(),
  days: z.coerce.number().int().min(1).max(90).default(30),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: MetricDateCursorSchema.optional(),
});

export type AnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>;

const ContentHistoryPlatformEnum = z.enum(SCHEDULABLE_PLATFORMS);

export const ContentHistoryQuerySchema = z.object({
  platform: ContentHistoryPlatformEnum.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: CreatedAtCursorSchema.optional(),
});

export type ContentHistoryQuery = z.infer<typeof ContentHistoryQuerySchema>;
