import { z } from "zod";

import { TIER_RANK } from "@/lib/types/plans";
import { POST_REJECTION_CODES } from "@/lib/types/postBatch";

/**
 * The REST API's success bodies, one schema each. They are not used for
 * runtime validation. They feed the OpenAPI spec (buildOpenApiDocument)
 * and the types at the bottom of this file: the DTO factories in
 * src/lib/api/rest/dto/ return those types, and every route that builds
 * its body inline checks it with `satisfies`. A response that drifts from
 * its schema fails the type check instead of shipping a wrong spec.
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

/** DELETE /v1/posts/{id}: the action taken and the batch counts. */
export const PostDeleteResultSchema = z.object({
  id: z.string(),
  action: z.enum(["cancelled", "deleted"]),
  details: z.object({
    total: z.number(),
    succeeded: z.number(),
    failed: z.number(),
    // Only on hard=true: stored media files removed with the post.
    mediaDeleted: z.number().optional(),
  }),
}).meta({ id: "PostDeleteResult" });

/** One refused post (src/lib/types/postBatch.ts, PostRejection). */
export const PostRejectionSchema = z.object({
  socialAccountId: z.string(),
  code: z.enum(POST_REJECTION_CODES),
  reason: z.string(),
}).meta({ id: "PostRejection" });

/** POST /v1/posts/bulk. */
export const PostBulkResultSchema = z.object({
  success: z.literal(true),
  batch_id: z.string(),
  total: z.number(),
  inserted: z.number(),
  duplicates: z.number(),
  rejected: z.array(PostRejectionSchema),
  posts: z.array(PostDTOSchema),
}).meta({ id: "PostBulkResult" });

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

/** POST /v1/connections/initiate. */
export const ConnectionInitiateResultSchema = z.object({
  connect_url: z.string(),
  state: z.string(),
  expires_at: z.string(),
  connection_id: z.string(),
}).meta({ id: "ConnectionInitiateResult" });

/** POST /v1/connections/{id}/reauth. */
export const ConnectionReauthResultSchema = z.object({
  reauth_url: z.string(),
  account: ConnectionDTOSchema,
}).meta({ id: "ConnectionReauthResult" });

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

/** GET /v1/posts/{id}/analytics. */
export const PostAnalyticsResultSchema = z.object({
  post_id: z.string(),
  content_id: z.string(),
  metrics: z.array(AnalyticsDTOSchema),
}).meta({ id: "PostAnalyticsResult" });

export const PinterestBoardDTOSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  privacy: z.string().nullable(),
  pin_count: z.number().nullable(),
}).meta({ id: "PinterestBoardDTO" });

/** GET /v1/connections/{id}/boards: one page; bookmark fetches the next. */
export const PinterestBoardPageSchema = z.object({
  data: z.array(PinterestBoardDTOSchema),
  bookmark: z.string().nullable(),
}).meta({ id: "PinterestBoardPage" });

/** POST /v1/media/upload-url. */
export const MediaUploadUrlSchema = z.object({
  upload_url: z.string(),
  storage_path: z.string(),
  token: z.string(),
  expires_in_seconds: z.number(),
}).meta({ id: "MediaUploadUrl" });

/** POST /v1/media/attach-from-url. */
export const MediaAttachResultSchema = z.object({
  success: z.literal(true),
  storage_path: z.string(),
  content_type: z.string(),
  size_bytes: z.number(),
}).meta({ id: "MediaAttachResult" });

/** GET /v1/media/{path}. */
export const MediaViewUrlSchema = z.object({
  view_url: z.string(),
  expires_in_seconds: z.number(),
}).meta({ id: "MediaViewUrl" });

/** DELETE /v1/media/{path}: deleted is false when another post still uses the file. */
export const MediaDeleteResultSchema = z.object({
  storage_path: z.string(),
  deleted: z.boolean(),
}).meta({ id: "MediaDeleteResult" });

export const UsageDTOSchema = z.object({
  plan: z.enum(TIER_RANK).nullable(),
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

/** POST /v1/webhooks: the only response that carries the signing secret. */
export const WebhookSubscriptionCreatedSchema = WebhookSubscriptionDTOSchema.extend({
  secret: z.string(),
}).meta({ id: "WebhookSubscriptionCreated" });

/** GET /v1/webhooks: every subscription, not paginated. */
export const WebhookSubscriptionListSchema = z.object({
  data: z.array(WebhookSubscriptionDTOSchema),
}).meta({ id: "WebhookSubscriptionList" });

/** DELETE /v1/webhooks/{id}. */
export const WebhookDeleteResultSchema = z.object({
  id: z.string(),
  deleted: z.literal(true),
}).meta({ id: "WebhookDeleteResult" });

/** POST /v1/webhooks/{id}/test: the synchronous delivery's outcome. */
export const WebhookTestResultSchema = z.object({
  delivery_id: z.string(),
  subscription_id: z.string(),
  status_code: z.number().nullable(),
  latency_ms: z.number(),
  delivered_at: z.string().nullable(),
  error_message: z.string().nullable(),
}).meta({ id: "WebhookTestResult" });

/** POST /v1/webhooks/{id}/deliveries/{delivery_id}/replay. */
export const WebhookReplayResultSchema = z.object({
  subscription_id: z.string(),
  original_delivery_id: z.string(),
  event_type: z.string(),
  message: z.string(),
}).meta({ id: "WebhookReplayResult" });

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

// The body types the DTO factories return and the routes check against.
export type PostDTO = z.infer<typeof PostDTOSchema>;
export type PostDeleteResult = z.infer<typeof PostDeleteResultSchema>;
export type PostBulkResult = z.infer<typeof PostBulkResultSchema>;
export type PostAnalyticsResult = z.infer<typeof PostAnalyticsResultSchema>;
export type ConnectionDTO = z.infer<typeof ConnectionDTOSchema>;
export type ConnectionInitiateResult = z.infer<typeof ConnectionInitiateResultSchema>;
export type ConnectionReauthResult = z.infer<typeof ConnectionReauthResultSchema>;
export type ContentHistoryDTO = z.infer<typeof ContentHistoryDTOSchema>;
export type AnalyticsDTO = z.infer<typeof AnalyticsDTOSchema>;
export type PinterestBoardDTO = z.infer<typeof PinterestBoardDTOSchema>;
export type PinterestBoardPage = z.infer<typeof PinterestBoardPageSchema>;
export type MediaUploadUrl = z.infer<typeof MediaUploadUrlSchema>;
export type MediaAttachResult = z.infer<typeof MediaAttachResultSchema>;
export type MediaViewUrl = z.infer<typeof MediaViewUrlSchema>;
export type MediaDeleteResult = z.infer<typeof MediaDeleteResultSchema>;
export type UsageDTO = z.infer<typeof UsageDTOSchema>;
export type WebhookSubscriptionDTO = z.infer<typeof WebhookSubscriptionDTOSchema>;
export type WebhookSubscriptionCreated = z.infer<typeof WebhookSubscriptionCreatedSchema>;
export type WebhookSubscriptionList = z.infer<typeof WebhookSubscriptionListSchema>;
export type WebhookDeleteResult = z.infer<typeof WebhookDeleteResultSchema>;
export type WebhookTestResult = z.infer<typeof WebhookTestResultSchema>;
export type WebhookReplayResult = z.infer<typeof WebhookReplayResultSchema>;
export type WebhookDeliveryDTO = z.infer<typeof WebhookDeliveryDTOSchema>;
