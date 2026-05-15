import { z } from "zod";

/**
 * Zod schemas mirroring DTO shapes for OpenAPI documentation.
 * These are NOT used for runtime validation; they exist so
 * zod-openapi can generate response schemas in the spec.
 *
 * Each schema matches the corresponding toXxxDTO function output
 * in src/lib/api/rest/dto/.
 */

export const PostDTOSchema = z.object({
  id: z.string(),
  status: z.string(),
  platform: z.string(),
  post_type: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  scheduled_at: z.string(),
  posted_at: z.string().nullable(),
  social_account_id: z.string(),
  media_storage_path: z.string(),
  batch_id: z.string().nullable(),
  created_at: z.string(),
}).meta({ id: "PostDTO" });

export const ConnectionDTOSchema = z.object({
  id: z.string(),
  platform: z.string(),
  account_identifier: z.string(),
  display_name: z.string().nullable(),
  username: z.string().nullable(),
  avatar_url: z.string().nullable(),
  is_verified: z.boolean().nullable(),
  follower_count: z.number().nullable(),
  is_available: z.boolean(),
  token_expires_at: z.string().nullable(),
  created_at: z.string(),
}).meta({ id: "ConnectionDTO" });

export const ContentHistoryDTOSchema = z.object({
  id: z.string(),
  platform: z.string(),
  content_id: z.string(),
  scheduled_post_id: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  media_url: z.string().nullable(),
  media_type: z.string().nullable(),
  status: z.string().nullable(),
  batch_id: z.string().nullable(),
  created_via: z.string(),
  created_at: z.string(),
}).meta({ id: "ContentHistoryDTO" });

export const AnalyticsDTOSchema = z.object({
  id: z.string(),
  platform: z.string(),
  content_id: z.string().nullable(),
  metric_date: z.string(),
  views: z.number(),
  comments: z.number(),
  likes: z.number(),
  shares: z.number(),
  subscribers: z.number(),
  created_at: z.string(),
}).meta({ id: "AnalyticsDTO" });

export const PinterestBoardDTOSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  privacy: z.string().nullable(),
  pin_count: z.number().nullable(),
}).meta({ id: "PinterestBoardDTO" });

export const UsageDTOSchema = z.object({
  plan: z.string().nullable(),
  status: z.string(),
  current_period_end: z.string().nullable(),
  period: z.string(),
  actions: z.record(z.string(), z.number()),
  storage: z.object({
    used_bytes: z.number(),
    cap_bytes: z.number(),
    used_human: z.string(),
    cap_human: z.string(),
  }),
}).meta({ id: "UsageDTO" });

export const WebhookSubscriptionDTOSchema = z.object({
  id: z.string(),
  url: z.string(),
  events: z.array(z.string()),
  active: z.boolean(),
  failure_count: z.number(),
  last_delivery_at: z.string().nullable(),
  last_disabled_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}).meta({ id: "WebhookSubscriptionDTO" });

export const WebhookDeliveryDTOSchema = z.object({
  id: z.string(),
  event_type: z.string(),
  event_id: z.string(),
  status_code: z.number().nullable(),
  attempt: z.number(),
  latency_ms: z.number().nullable(),
  delivered_at: z.string().nullable(),
  failed_at: z.string().nullable(),
  error_message: z.string().nullable(),
  created_at: z.string(),
}).meta({ id: "WebhookDeliveryDTO" });

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
  request_id: z.string(),
}).meta({ id: "ErrorResponse" });

export const PaginatedPostsSchema = z.object({
  data: z.array(PostDTOSchema),
  next_cursor: z.string().nullable(),
}).meta({ id: "PaginatedPosts" });

export const PaginatedConnectionsSchema = z.object({
  data: z.array(ConnectionDTOSchema),
  next_cursor: z.string().nullable(),
}).meta({ id: "PaginatedConnections" });

export const PaginatedContentHistorySchema = z.object({
  data: z.array(ContentHistoryDTOSchema),
  next_cursor: z.string().nullable(),
}).meta({ id: "PaginatedContentHistory" });

export const PaginatedAnalyticsSchema = z.object({
  data: z.array(AnalyticsDTOSchema),
  next_cursor: z.string().nullable(),
}).meta({ id: "PaginatedAnalytics" });

export const PaginatedDeliveriesSchema = z.object({
  data: z.array(WebhookDeliveryDTOSchema),
  next_cursor: z.string().nullable(),
}).meta({ id: "PaginatedDeliveries" });
