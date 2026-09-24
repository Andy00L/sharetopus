import { z } from "zod";

import {
  SCHEDULABLE_PLATFORMS,
  platformSupportsMediaType,
} from "@/lib/platforms/capabilities";

/**
 * Supported social platforms for REST API. Sourced from the shared
 * capability registry (src/lib/platforms/capabilities.ts): the seven
 * legacy adapters plus every registry provider, all of which the worker
 * can now publish to. The media-type superRefine below answers from the
 * same registry rules.
 */
export const SocialPlatformEnum = z.enum(SCHEDULABLE_PLATFORMS);

export const PostTypeEnum = z.enum(["text", "image", "video"]);

/**
 * Body schema for POST /v1/posts.
 *
 * Flat structure: every platform-specific field at the top level with
 * a platform_* prefix. Mirrors MCP schedule_post exactly.
 *
 * scheduled_at omitted -> directPostBatch (immediate publish).
 * scheduled_at provided -> schedulePostBatch (publishes at given time).
 */
export const PostCreateInputSchema = z
  .object({
    social_account_id: z.guid(),
    platform: SocialPlatformEnum,
    post_type: PostTypeEnum,
    title: z.string().max(500).optional(),
    description: z.string().max(10000).nullable(),
    media_storage_path: z.string().optional(),
    scheduled_at: z.string().datetime({ offset: true }).optional(),
    idempotency_key: z.string().min(1).max(200).optional(),
    batch_id: z.string().optional(),

    // Pinterest-specific (meaningful when platform === "pinterest").
    pinterest_board_id: z.string().optional(),
    pinterest_board_name: z.string().optional(),
    pinterest_link: z.string().url().max(2048).optional(),

    // Registry-provider options. Each is meaningful only for its platform;
    // the superRefine below enforces the ones that are mandatory there.
    subreddit: z.string().min(2).max(50).optional(),
    flair_id: z.string().max(100).optional(),
    community_id: z.number().int().positive().optional(),
    publication_id: z.string().max(100).optional(),
    blog: z.string().max(100).optional(),
    location_name: z
      .string()
      .regex(/^locations\/[0-9]+$/, 'shaped "locations/<id>"')
      .optional(),
    organization_id: z.string().max(50).optional(),
    canonical_url: z.string().url().max(2048).optional(),
    tags: z.array(z.string().min(1).max(50)).max(4).optional(),
  })
  .superRefine((data, ctx) => {
    // Pinterest requires pinterest_board_id.
    if (data.platform === "pinterest" && !data.pinterest_board_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pinterest_board_id"],
        message: "pinterest_board_id is required when platform is pinterest",
      });
    }
    // Registry platforms whose publish cannot run without a target.
    if (data.platform === "reddit" && !data.subreddit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subreddit"],
        message: "subreddit is required when platform is reddit",
      });
    }
    if (data.platform === "lemmy" && !data.community_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["community_id"],
        message: "community_id is required when platform is lemmy",
      });
    }
    if (data.platform === "gmb" && !data.location_name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["location_name"],
        message: "location_name is required when platform is gmb",
      });
    }
    // Media-type support per platform comes from the shared capability map
    // (rejects text on pinterest/tiktok/instagram, image/text on youtube).
    if (!platformSupportsMediaType(data.platform, data.post_type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["post_type"],
        message: `${data.post_type} posts are not supported on ${data.platform}`,
      });
    }
    // Image / video posts require media_storage_path.
    if (
      (data.post_type === "image" || data.post_type === "video") &&
      !data.media_storage_path
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["media_storage_path"],
        message: "media_storage_path is required for image and video posts",
      });
    }

    // Vuln 1 fix: basic format guard. Server-side enforces principal ownership.
    if (data.media_storage_path && !data.media_storage_path.includes("/")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["media_storage_path"],
        message:
          "media_storage_path must include a principal prefix (format: {principal_id}/filename)",
      });
    }
    // scheduled_at, if provided, must be a future timestamp.
    if (data.scheduled_at) {
      const scheduledTime = Date.parse(data.scheduled_at);
      if (Number.isNaN(scheduledTime) || scheduledTime <= Date.now()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scheduled_at"],
          message: "scheduled_at must be a future ISO 8601 timestamp",
        });
      }
    }
  });

export type PostCreateInput = z.infer<typeof PostCreateInputSchema>;

/**
 * `cursor` of the list endpoints paginated on created_at: the next_cursor a
 * previous page returned, the last row's created_at as a timestamptz string
 * (e.g. 2026-09-23T12:34:56.123456+00:00, so the "+" must be URL-encoded).
 * Parsing it here makes a malformed cursor a 400. Unparsed, it reached
 * Postgres and the failed timestamp cast came back as a 500.
 */
export const CreatedAtCursorSchema = z.iso.datetime({
  offset: true,
  error: "cursor must be a next_cursor value from a previous page, URL-encoded",
});

/**
 * Query schema for GET /v1/posts.
 * Cursor pagination on created_at. Cursor value is the last item's created_at.
 */
export const PostListQuerySchema = z.object({
  status: z
    .enum([
      "scheduled",
      "queued",
      "processing",
      "posted",
      "failed",
      "cancelled",
    ])
    .optional(),
  platform: SocialPlatformEnum.optional(),
  batch_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: CreatedAtCursorSchema.optional(),
});

export type PostListQuery = z.infer<typeof PostListQuerySchema>;
