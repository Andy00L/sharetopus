import type {
  DocsSection,
  ParamTableData,
} from "@/lib/docs/apiReferenceTypes";

/**
 * Posts resource of the /docs/rest reference. Field lists mirror the zod
 * schemas verbatim (src/lib/api/rest/validation/schemas.ts and
 * postPatchSchemas.ts, read in full); response shapes mirror the DTO
 * factories. Amounts and ids in samples are illustrative.
 */

const POST_DTO_FIELDS: ParamTableData = {
  heading: "Response Fields (PostDTO)",
  rows: [
    { name: "id", type: "string (uuid)", required: true, description: "Post id." },
    {
      name: "status",
      type: "string",
      required: true,
      description: "scheduled, queued, processing, posted, failed, or cancelled.",
    },
    {
      name: "platform",
      type: "string",
      required: true,
      description: "linkedin, tiktok, pinterest, instagram, youtube, x, or facebook.",
    },
    {
      name: "post_type",
      type: "string",
      required: true,
      description: "text, image, or video.",
    },
    { name: "title", type: "string | null", required: true, description: "Title, when set." },
    {
      name: "description",
      type: "string | null",
      required: true,
      description: "Body text, when set.",
    },
    {
      name: "scheduled_at",
      type: "string",
      required: true,
      description: "Publish time, ISO 8601.",
    },
    {
      name: "posted_at",
      type: "string | null",
      required: true,
      description: "Set once the post is published.",
    },
    {
      name: "social_account_id",
      type: "string (uuid)",
      required: true,
      description: "Account the post targets.",
    },
    {
      name: "media_storage_path",
      type: "string",
      required: true,
      description: "Storage path of the attached media; empty for text posts.",
    },
    {
      name: "batch_id",
      type: "string | null",
      required: true,
      description: "Batch the post belongs to, when created in one.",
    },
    {
      name: "created_at",
      type: "string",
      required: true,
      description: "Record creation time, ISO 8601.",
    },
  ],
};

const CREATE_BODY_FIELDS: ParamTableData = {
  heading: "Request Body",
  rows: [
    {
      name: "social_account_id",
      type: "string (uuid)",
      required: true,
      description: "Connected account to post from (see Connections).",
    },
    {
      name: "platform",
      type: "string",
      required: true,
      description:
        "linkedin, tiktok, pinterest, instagram, youtube, x, or facebook. Must match the account.",
    },
    {
      name: "post_type",
      type: "string",
      required: true,
      description:
        "text, image, or video. Media-type support is validated per platform (for example youtube accepts video only).",
    },
    {
      name: "description",
      type: "string | null",
      required: true,
      description:
        "Post body text, max 10000 characters. The key is required; the value may be null.",
    },
    {
      name: "title",
      type: "string",
      required: false,
      description: "Max 500 characters, where the platform supports one.",
    },
    {
      name: "media_storage_path",
      type: "string",
      required: false,
      description:
        "Required for image and video posts. The storage_path returned by the Media endpoints; format {principal_id}/filename.",
    },
    {
      name: "scheduled_at",
      type: "string",
      required: false,
      description:
        "Future ISO 8601 timestamp with offset. Omit to publish immediately.",
    },
    {
      name: "idempotency_key",
      type: "string",
      required: false,
      description: "1 to 200 characters. Client-supplied key to dedupe retries.",
    },
    {
      name: "batch_id",
      type: "string",
      required: false,
      description: "Request-level grouping id.",
    },
    {
      name: "pinterest_board_id",
      type: "string",
      required: false,
      description: "Required when platform is pinterest.",
    },
    {
      name: "pinterest_board_name",
      type: "string",
      required: false,
      description: "Board name, informational.",
    },
    {
      name: "pinterest_link",
      type: "string (url)",
      required: false,
      description: "Outbound link for the pin, max 2048 characters.",
    },
  ],
};

export const REST_POSTS_SECTION: DocsSection = {
  id: "posts",
  navLabel: "Posts",
  title: "Posts",
  summary:
    "Create, list, inspect, reschedule, and cancel posts. Omitting scheduled_at publishes immediately; providing it schedules for that time.",
  sourceRef:
    "src/app/api/v1/posts/route.ts, posts/bulk/route.ts, posts/[id]/route.ts, posts/[id]/analytics/route.ts, src/lib/api/rest/validation/schemas.ts, postPatchSchemas.ts",
  operations: [
    {
      id: "posts-create",
      method: "POST",
      path: "/api/v1/posts",
      title: "Create a post",
      description:
        "Schedules a post (scheduled_at in the future) or publishes immediately (scheduled_at omitted). Validation is platform-aware: unsupported media types and missing Pinterest boards are rejected with 400 validation_error.",
      sourceRef:
        "src/app/api/v1/posts/route.ts (POST), src/lib/api/rest/validation/schemas.ts (PostCreateInputSchema)",
      paramTables: [CREATE_BODY_FIELDS, POST_DTO_FIELDS],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl -X POST "https://sharetopus.com/api/v1/posts" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "social_account_id": "5b1f0c4e-3d2a-4f6b-8c9d-0e1f2a3b4c5d",
    "platform": "tiktok",
    "post_type": "video",
    "description": "Launch day.",
    "media_storage_path": "user_2f6a1c0e.../launch.mp4",
    "scheduled_at": "2026-07-12T16:00:00.000Z"
  }'`,
        },
        {
          label: "Response · 200",
          code: `{
  "id": "c9d8e7f6-a5b4-4c3d-2e1f-0a9b8c7d6e5f",
  "status": "scheduled",
  "platform": "tiktok",
  "post_type": "video",
  "title": null,
  "description": "Launch day.",
  "scheduled_at": "2026-07-12T16:00:00.000Z",
  "posted_at": null,
  "social_account_id": "5b1f0c4e-3d2a-4f6b-8c9d-0e1f2a3b4c5d",
  "media_storage_path": "user_2f6a1c0e.../launch.mp4",
  "batch_id": null,
  "created_at": "2026-07-04T18:00:00.000Z"
}`,
        },
      ],
    },
    {
      id: "posts-list",
      method: "GET",
      path: "/api/v1/posts",
      title: "List posts",
      description: "Cursor-paginated list, newest first.",
      sourceRef:
        "src/app/api/v1/posts/route.ts (GET), src/lib/api/rest/validation/schemas.ts (PostListQuerySchema)",
      paramTables: [
        {
          heading: "Query Parameters",
          rows: [
            {
              name: "status",
              type: "string",
              required: false,
              description:
                "scheduled, queued, processing, posted, failed, or cancelled.",
            },
            {
              name: "platform",
              type: "string",
              required: false,
              description: "Filter by posting platform.",
            },
            {
              name: "batch_id",
              type: "string",
              required: false,
              description: "Filter by batch.",
            },
            {
              name: "limit",
              type: "number",
              required: false,
              description: "1 to 100. Default 20.",
            },
            {
              name: "cursor",
              type: "string",
              required: false,
              description: "next_cursor from the previous page.",
            },
          ],
        },
      ],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl "https://sharetopus.com/api/v1/posts?status=scheduled&limit=20" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY"`,
        },
      ],
    },
    {
      id: "posts-bulk",
      method: "POST",
      path: "/api/v1/posts/bulk",
      title: "Bulk schedule posts",
      description:
        "Schedules 1 to 30 posts in one request; every item takes the same fields as Create a post. All posts share one server-generated batch_id, and each gets the idempotency key batch_id:index unless one is provided. Partial success is possible: rejected items are listed, inserted ones are returned.",
      sourceRef:
        "src/app/api/v1/posts/bulk/route.ts, src/lib/api/rest/validation/postPatchSchemas.ts (PostBulkInputSchema)",
      paramTables: [
        {
          heading: "Request Body",
          rows: [
            {
              name: "posts",
              type: "object[]",
              required: true,
              description:
                "1 to 30 items, each with the Create a post body fields.",
            },
          ],
        },
        {
          heading: "Response Fields",
          rows: [
            {
              name: "success",
              type: "boolean",
              required: true,
              description: "True when the batch was processed.",
            },
            {
              name: "batch_id",
              type: "string (uuid)",
              required: true,
              description: "Shared batch id for every post in the call.",
            },
            {
              name: "total",
              type: "number",
              required: true,
              description: "Items received.",
            },
            {
              name: "inserted",
              type: "number",
              required: true,
              description: "Posts stored.",
            },
            {
              name: "duplicates",
              type: "number",
              required: true,
              description: "Items skipped by idempotency key.",
            },
            {
              name: "rejected",
              type: "object[]",
              required: true,
              description: "Items that failed validation, with reasons.",
            },
            {
              name: "posts",
              type: "PostDTO[]",
              required: true,
              description: "The inserted posts.",
            },
          ],
        },
      ],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl -X POST "https://sharetopus.com/api/v1/posts/bulk" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "posts": [
      { "social_account_id": "5b1f0c4e-...", "platform": "x", "post_type": "text", "description": "Thread 1/3", "scheduled_at": "2026-07-12T16:00:00.000Z" },
      { "social_account_id": "5b1f0c4e-...", "platform": "x", "post_type": "text", "description": "Thread 2/3", "scheduled_at": "2026-07-12T16:05:00.000Z" }
    ]
  }'`,
        },
      ],
    },
    {
      id: "posts-get",
      method: "GET",
      path: "/api/v1/posts/{id}",
      title: "Get a post",
      description:
        "Returns one post by id. Posts owned by another account return 404.",
      sourceRef: "src/app/api/v1/posts/[id]/route.ts (GET)",
      paramTables: [
        {
          heading: "Path Parameters",
          rows: [
            {
              name: "id",
              type: "string (uuid)",
              required: true,
              description: "Post id.",
            },
          ],
        },
      ],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl "https://sharetopus.com/api/v1/posts/c9d8e7f6-a5b4-4c3d-2e1f-0a9b8c7d6e5f" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY"`,
        },
      ],
    },
    {
      id: "posts-patch",
      method: "PATCH",
      path: "/api/v1/posts/{id}",
      title: "Reschedule a post",
      description:
        "Moves a pending post to a new future time. Cancelled posts are automatically resumed by the move. Returns the updated PostDTO.",
      sourceRef:
        "src/app/api/v1/posts/[id]/route.ts (PATCH), src/lib/api/rest/validation/postPatchSchemas.ts (PostPatchInputSchema)",
      paramTables: [
        {
          heading: "Request Body",
          rows: [
            {
              name: "scheduled_at",
              type: "string",
              required: true,
              description: "Future ISO 8601 timestamp with offset.",
            },
          ],
        },
      ],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl -X PATCH "https://sharetopus.com/api/v1/posts/c9d8e7f6-a5b4-4c3d-2e1f-0a9b8c7d6e5f" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "scheduled_at": "2026-07-13T09:00:00.000Z" }'`,
        },
      ],
    },
    {
      id: "posts-delete",
      method: "DELETE",
      path: "/api/v1/posts/{id}",
      title: "Cancel or delete a post",
      description:
        "Default is a soft cancel: the post keeps its row and media, status becomes cancelled. hard=true permanently deletes the post and cleans up its media.",
      sourceRef:
        "src/app/api/v1/posts/[id]/route.ts (DELETE), src/lib/api/rest/validation/postPatchSchemas.ts (PostDeleteQuerySchema)",
      paramTables: [
        {
          heading: "Query Parameters",
          rows: [
            {
              name: "hard",
              type: "boolean",
              required: false,
              description: "true for permanent deletion. Default false (cancel).",
            },
          ],
        },
        {
          heading: "Response Fields",
          rows: [
            {
              name: "id",
              type: "string (uuid)",
              required: true,
              description: "The post acted on.",
            },
            {
              name: "action",
              type: "string",
              required: true,
              description: "cancelled or deleted.",
            },
            {
              name: "details",
              type: "object | null",
              required: true,
              description: "Batch-operation details, when available.",
            },
          ],
        },
      ],
      callouts: [
        {
          tone: "amber",
          text: "hard=true is not reversible and removes stored media that no other post references.",
        },
      ],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl -X DELETE "https://sharetopus.com/api/v1/posts/c9d8e7f6-a5b4-4c3d-2e1f-0a9b8c7d6e5f?hard=true" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY"`,
        },
      ],
    },
    {
      id: "posts-analytics",
      method: "GET",
      path: "/api/v1/posts/{id}/analytics",
      title: "Get post analytics",
      description:
        "Returns the metric rows recorded for a published post. 404 when the post does not exist or has no published content yet.",
      sourceRef: "src/app/api/v1/posts/[id]/analytics/route.ts",
      paramTables: [
        {
          heading: "Response Fields",
          rows: [
            {
              name: "post_id",
              type: "string (uuid)",
              required: true,
              description: "The post.",
            },
            {
              name: "content_id",
              type: "string",
              required: true,
              description: "Platform-side content identifier.",
            },
            {
              name: "metrics",
              type: "object[]",
              required: true,
              description:
                "Metric rows: metric_date, views, likes, comments, shares, subscribers.",
            },
          ],
        },
      ],
      codeSamples: [
        {
          label: "Example Request",
          code: `curl "https://sharetopus.com/api/v1/posts/c9d8e7f6-a5b4-4c3d-2e1f-0a9b8c7d6e5f/analytics" \\
  -H "Authorization: Bearer stp_rest_YOUR_KEY"`,
        },
      ],
    },
  ],
};
