import { z } from "zod";

/**
 * Supported social platforms for REST API. Subset of the full Platform
 * union in database.types.ts; only platforms with active posting
 * support are exposed.
 */
export const SocialPlatformEnum = z.enum([
  "linkedin",
  "tiktok",
  "pinterest",
  "instagram",
]);

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
    social_account_id: z.string().uuid(),
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
  })
  .superRefine((data, ctx) => {
    // Pinterest requires pinterest_board_id.
    if (data.platform === "pinterest" && !data.pinterest_board_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pinterest_board_id"],
        message:
          "pinterest_board_id is required when platform is pinterest",
      });
    }
    // Text posts: LinkedIn only.
    if (data.post_type === "text" && data.platform !== "linkedin") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["post_type"],
        message: "text posts are only supported on linkedin",
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
        message:
          "media_storage_path is required for image and video posts",
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
  cursor: z.string().optional(),
});

export type PostListQuery = z.infer<typeof PostListQuerySchema>;
