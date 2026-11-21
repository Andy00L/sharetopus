import { z } from "zod";

import { CreatedAtCursorSchema } from "@/lib/api/rest/pagination";
import { SCHEDULABLE_PLATFORMS } from "@/lib/platforms/capabilities";
import {
  REGISTRY_POST_OPTION_FIELDS,
  refinePostTarget,
} from "@/lib/platforms/postTargetOptions";

export const SocialPlatformEnum = z.enum(SCHEDULABLE_PLATFORMS);

export const PostTypeEnum = z.enum(["text", "image", "video"]);

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

    pinterest_board_id: z.string().optional(),
    pinterest_board_name: z.string().optional(),
    pinterest_link: z.string().url().max(2048).optional(),

    ...REGISTRY_POST_OPTION_FIELDS,
  })
  .superRefine((data, ctx) => {
    refinePostTarget(data, ctx);
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

    if (data.media_storage_path && !data.media_storage_path.includes("/")) {
      ctx.addIssue({
        code: "custom",
        path: ["media_storage_path"],
        message:
          "media_storage_path must include a principal prefix (format: {principal_id}/filename)",
      });
    }
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
