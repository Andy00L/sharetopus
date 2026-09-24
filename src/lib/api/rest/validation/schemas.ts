import { z } from "zod";

import { CreatedAtCursorSchema } from "@/lib/api/rest/pagination";
import { SCHEDULABLE_PLATFORMS } from "@/lib/platforms/capabilities";
import {
  REGISTRY_POST_OPTION_FIELDS,
  refinePostTarget,
} from "@/lib/platforms/postTargetOptions";

/**
 * Supported social platforms for REST API. Sourced from the shared
 * capability registry (src/lib/platforms/capabilities.ts): the seven
 * legacy adapters plus every registry provider, all of which the worker
 * can now publish to.
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

    // Registry-provider options, shared with the MCP posting tools.
    ...REGISTRY_POST_OPTION_FIELDS,
  })
  .superRefine((data, ctx) => {
    // Media type, required title, and required targets (Pinterest board,
    // subreddit, Lemmy community, Google Business location): the same
    // checks the MCP posting tools run.
    refinePostTarget(data, ctx);
    // Image / video posts require media_storage_path.
    if (
      (data.post_type === "image" || data.post_type === "video") &&
      !data.media_storage_path
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["media_storage_path"],
        message: "media_storage_path is required for image and video posts",
      });
    }

    // Vuln 1 fix: basic format guard. Server-side enforces principal ownership.
    if (data.media_storage_path && !data.media_storage_path.includes("/")) {
      ctx.addIssue({
        code: "custom",
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
          code: "custom",
          path: ["scheduled_at"],
          message: "scheduled_at must be a future ISO 8601 timestamp",
        });
      }
    }
  });

export type PostCreateInput = z.infer<typeof PostCreateInputSchema>;

/**
 * Query schema for GET /v1/posts.
 * Keyset pagination on (created_at, id); see src/lib/api/rest/pagination.ts.
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
