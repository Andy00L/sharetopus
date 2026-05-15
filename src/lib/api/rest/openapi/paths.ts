import {
  PostCreateInputSchema,
  PostListQuerySchema,
} from "../validation/schemas";
import {
  PostPatchInputSchema,
  PostBulkInputSchema,
} from "../validation/postPatchSchemas";
import {
  ConnectionInitiateInputSchema,
  ConnectionListQuerySchema,
  PinterestBoardsQuerySchema,
} from "../validation/connectionSchemas";
import {
  UploadUrlInputSchema,
  AttachFromUrlInputSchema,
} from "../validation/mediaSchemas";
import { AnalyticsQuerySchema, ContentHistoryQuerySchema } from "../validation/analyticsSchemas";
import {
  WebhookCreateInputSchema,
  WebhookPatchInputSchema,
  WebhookTestInputSchema,
  WebhookDeliveryListQuerySchema,
} from "../validation/webhookSchemas";
import {
  PostDTOSchema,
  ConnectionDTOSchema,
  ContentHistoryDTOSchema,
  AnalyticsDTOSchema,
  PinterestBoardDTOSchema,
  UsageDTOSchema,
  WebhookSubscriptionDTOSchema,
  WebhookDeliveryDTOSchema,
  ErrorResponseSchema,
  PaginatedPostsSchema,
  PaginatedConnectionsSchema,
  PaginatedContentHistorySchema,
  PaginatedAnalyticsSchema,
  PaginatedDeliveriesSchema,
} from "./responseSchemas";

/**
 * Helper to build a standard JSON request body spec.
 */
function jsonBody(schema: unknown) {
  return {
    content: { "application/json": { schema } },
    required: true as const,
  };
}

/**
 * Helper to build a standard JSON response spec.
 */
function jsonResponse(description: string, schema: unknown) {
  return {
    description,
    content: { "application/json": { schema } },
  };
}

const errorResponses = {
  "400": jsonResponse("Validation error", ErrorResponseSchema),
  "401": jsonResponse("Unauthorized", ErrorResponseSchema),
  "403": jsonResponse("Forbidden", ErrorResponseSchema),
  "404": jsonResponse("Not found", ErrorResponseSchema),
  "429": jsonResponse("Rate limited", ErrorResponseSchema),
  "500": jsonResponse("Internal error", ErrorResponseSchema),
};

/**
 * OpenAPI path definitions for all v1 endpoints. Each entry references
 * the SAME Zod schemas used for runtime validation. No drift possible
 * between docs and actual behavior.
 */
export const restPaths = {
  "/api/v1/posts": {
    post: {
      tags: ["Posts"],
      summary: "Create a post",
      description: "Schedule a post for later or publish immediately (omit scheduled_at).",
      operationId: "createPost",
      requestBody: jsonBody(PostCreateInputSchema),
      responses: {
        "200": jsonResponse("Created post", PostDTOSchema),
        ...errorResponses,
      },
    },
    get: {
      tags: ["Posts"],
      summary: "List posts",
      operationId: "listPosts",
      parameters: schemaToQueryParams(PostListQuerySchema),
      responses: {
        "200": jsonResponse("Paginated posts", PaginatedPostsSchema),
        ...errorResponses,
      },
    },
  },
  "/api/v1/posts/bulk": {
    post: {
      tags: ["Posts"],
      summary: "Bulk schedule posts",
      description: "Schedule up to 30 posts in one call.",
      operationId: "bulkSchedulePosts",
      requestBody: jsonBody(PostBulkInputSchema),
      responses: { "200": jsonResponse("Bulk result", PostDTOSchema), ...errorResponses },
    },
  },
  "/api/v1/posts/{id}": {
    get: {
      tags: ["Posts"],
      summary: "Get a post",
      operationId: "getPost",
      parameters: [pathParam("id", "Post UUID")],
      responses: { "200": jsonResponse("Post", PostDTOSchema), ...errorResponses },
    },
    patch: {
      tags: ["Posts"],
      summary: "Reschedule a post",
      operationId: "reschedulePost",
      parameters: [pathParam("id", "Post UUID")],
      requestBody: jsonBody(PostPatchInputSchema),
      responses: { "200": jsonResponse("Updated post", PostDTOSchema), ...errorResponses },
    },
    delete: {
      tags: ["Posts"],
      summary: "Cancel or delete a post",
      description: "Soft-cancel by default. Use ?hard=true for permanent deletion.",
      operationId: "deletePost",
      parameters: [pathParam("id", "Post UUID")],
      responses: { "200": jsonResponse("Delete result", PostDTOSchema), ...errorResponses },
    },
  },
  "/api/v1/posts/{id}/analytics": {
    get: {
      tags: ["Analytics"],
      summary: "Get per-post analytics",
      operationId: "getPostAnalytics",
      parameters: [pathParam("id", "Post UUID")],
      responses: { "200": jsonResponse("Post analytics", AnalyticsDTOSchema), ...errorResponses },
    },
  },
  "/api/v1/connections": {
    get: {
      tags: ["Connections"],
      summary: "List connections",
      operationId: "listConnections",
      parameters: schemaToQueryParams(ConnectionListQuerySchema),
      responses: { "200": jsonResponse("Paginated connections", PaginatedConnectionsSchema), ...errorResponses },
    },
  },
  "/api/v1/connections/initiate": {
    post: {
      tags: ["Connections"],
      summary: "Initiate OAuth connection",
      operationId: "initiateConnection",
      requestBody: jsonBody(ConnectionInitiateInputSchema),
      responses: { "200": jsonResponse("OAuth URL", ConnectionDTOSchema), ...errorResponses },
    },
  },
  "/api/v1/connections/{id}": {
    get: {
      tags: ["Connections"],
      summary: "Get a connection",
      operationId: "getConnection",
      parameters: [pathParam("id", "Connection UUID")],
      responses: { "200": jsonResponse("Connection", ConnectionDTOSchema), ...errorResponses },
    },
  },
  "/api/v1/connections/{id}/reauth": {
    post: {
      tags: ["Connections"],
      summary: "Get reauth URL",
      operationId: "reauthConnection",
      parameters: [pathParam("id", "Connection UUID")],
      responses: { "200": jsonResponse("Reauth URL", ConnectionDTOSchema), ...errorResponses },
    },
  },
  "/api/v1/connections/{id}/boards": {
    get: {
      tags: ["Connections"],
      summary: "List Pinterest boards",
      operationId: "listPinterestBoards",
      parameters: [
        pathParam("id", "Pinterest connection UUID"),
        ...schemaToQueryParams(PinterestBoardsQuerySchema),
      ],
      responses: { "200": jsonResponse("Boards", PinterestBoardDTOSchema), ...errorResponses },
    },
  },
  "/api/v1/media/upload-url": {
    post: {
      tags: ["Media"],
      summary: "Request upload URL",
      operationId: "requestUploadUrl",
      requestBody: jsonBody(UploadUrlInputSchema),
      responses: { "200": jsonResponse("Signed upload URL", PostDTOSchema), ...errorResponses },
    },
  },
  "/api/v1/media/attach-from-url": {
    post: {
      tags: ["Media"],
      summary: "Attach media from URL",
      description: "Download from a public URL and upload to Sharetopus storage. SSRF protected.",
      operationId: "attachMediaFromUrl",
      requestBody: jsonBody(AttachFromUrlInputSchema),
      responses: { "200": jsonResponse("Uploaded media info", PostDTOSchema), ...errorResponses },
    },
  },
  "/api/v1/media/{path}": {
    get: {
      tags: ["Media"],
      summary: "Get signed view URL",
      operationId: "getMediaViewUrl",
      parameters: [pathParam("path", "Storage path (e.g. user_id/filename.jpg)")],
      responses: { "200": jsonResponse("Signed view URL", PostDTOSchema), ...errorResponses },
    },
    delete: {
      tags: ["Media"],
      summary: "Delete media file",
      description: "Reference-aware deletion. Returns deleted:false if file is still in use.",
      operationId: "deleteMedia",
      parameters: [pathParam("path", "Storage path")],
      responses: { "200": jsonResponse("Delete result", PostDTOSchema), ...errorResponses },
    },
  },
  "/api/v1/analytics": {
    get: {
      tags: ["Analytics"],
      summary: "List account analytics",
      operationId: "listAnalytics",
      parameters: schemaToQueryParams(AnalyticsQuerySchema),
      responses: { "200": jsonResponse("Paginated analytics", PaginatedAnalyticsSchema), ...errorResponses },
    },
  },
  "/api/v1/content-history": {
    get: {
      tags: ["Content History"],
      summary: "List content history",
      operationId: "listContentHistory",
      parameters: schemaToQueryParams(ContentHistoryQuerySchema),
      responses: { "200": jsonResponse("Paginated content history", PaginatedContentHistorySchema), ...errorResponses },
    },
  },
  "/api/v1/usage": {
    get: {
      tags: ["Usage"],
      summary: "Get usage and billing",
      operationId: "getUsage",
      responses: { "200": jsonResponse("Usage summary", UsageDTOSchema), ...errorResponses },
    },
  },
  "/api/v1/webhooks": {
    post: {
      tags: ["Webhooks"],
      summary: "Create webhook subscription",
      operationId: "createWebhook",
      requestBody: jsonBody(WebhookCreateInputSchema),
      responses: { "201": jsonResponse("Created subscription (includes secret)", WebhookSubscriptionDTOSchema), ...errorResponses },
    },
    get: {
      tags: ["Webhooks"],
      summary: "List webhook subscriptions",
      operationId: "listWebhooks",
      responses: { "200": jsonResponse("Subscriptions", WebhookSubscriptionDTOSchema), ...errorResponses },
    },
  },
  "/api/v1/webhooks/{id}": {
    get: {
      tags: ["Webhooks"],
      summary: "Get webhook subscription",
      operationId: "getWebhook",
      parameters: [pathParam("id", "Subscription UUID")],
      responses: { "200": jsonResponse("Subscription", WebhookSubscriptionDTOSchema), ...errorResponses },
    },
    patch: {
      tags: ["Webhooks"],
      summary: "Update webhook subscription",
      operationId: "updateWebhook",
      parameters: [pathParam("id", "Subscription UUID")],
      requestBody: jsonBody(WebhookPatchInputSchema),
      responses: { "200": jsonResponse("Updated subscription", WebhookSubscriptionDTOSchema), ...errorResponses },
    },
    delete: {
      tags: ["Webhooks"],
      summary: "Delete webhook subscription",
      operationId: "deleteWebhook",
      parameters: [pathParam("id", "Subscription UUID")],
      responses: { "200": jsonResponse("Deleted", WebhookSubscriptionDTOSchema), ...errorResponses },
    },
  },
  "/api/v1/webhooks/{id}/test": {
    post: {
      tags: ["Webhooks"],
      summary: "Send test event",
      operationId: "testWebhook",
      parameters: [pathParam("id", "Subscription UUID")],
      requestBody: jsonBody(WebhookTestInputSchema),
      responses: { "200": jsonResponse("Test delivery result", WebhookDeliveryDTOSchema), ...errorResponses },
    },
  },
  "/api/v1/webhooks/{id}/deliveries": {
    get: {
      tags: ["Webhooks"],
      summary: "List deliveries",
      operationId: "listWebhookDeliveries",
      parameters: [
        pathParam("id", "Subscription UUID"),
        ...schemaToQueryParams(WebhookDeliveryListQuerySchema),
      ],
      responses: { "200": jsonResponse("Paginated deliveries", PaginatedDeliveriesSchema), ...errorResponses },
    },
  },
  "/api/v1/webhooks/{id}/deliveries/{delivery_id}/replay": {
    post: {
      tags: ["Webhooks"],
      summary: "Replay a delivery",
      operationId: "replayWebhookDelivery",
      parameters: [
        pathParam("id", "Subscription UUID"),
        pathParam("delivery_id", "Original delivery UUID"),
      ],
      responses: { "200": jsonResponse("Replay result", WebhookDeliveryDTOSchema), ...errorResponses },
    },
  },
};

// -- Helpers --

function pathParam(name: string, description: string) {
  return { name, in: "path" as const, required: true, schema: { type: "string" as const }, description };
}

/**
 * Extracts query parameter definitions from a Zod object schema.
 * Reads the shape keys and produces OpenAPI parameter objects.
 */
function schemaToQueryParams(schema: { shape?: Record<string, unknown> }) {
  if (!schema.shape) return [];
  return Object.keys(schema.shape).map((key) => ({
    name: key,
    in: "query" as const,
    required: false,
    schema: { type: "string" as const },
    description: key,
  }));
}
