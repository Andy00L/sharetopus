import "server-only";

import { z } from "zod";

import { StoredPostOptionsSchema } from "@/inngest/events/postOptions";
import { PLATFORM_LABELS, platformSupportsMediaType } from "@/lib/platforms/capabilities";
import { X402_PLATFORMS, type X402Platform } from "@/lib/x402/config";

export const PostBodyBaseSchema = z.object({
  social_account_id: z.string().uuid(),
  platform: z.enum(X402_PLATFORMS),
  post_type: z.enum(["text", "image", "video"]),
  description: z.string().nullable(),
  media_storage_path: z.string().optional(),
  title: z.string().nullable().optional(),
  cover_timestamp: z.number().optional(),
  pinterest_board_id: z.string().optional(),
  pinterest_board_name: z.string().optional(),
  pinterest_link: z.string().optional(),
  idempotency_key: z.string().optional(),
});

export const SchedulePostOptionsSchema = StoredPostOptionsSchema.omit({ privacyLevel: true })
  .extend({
    link: z.string().url().max(2048).optional(),
    board: z.string().max(128).optional(),
    boardName: z.string().max(200).optional(),
    visibility: z.string().max(32).optional(),
  })
  .transform((options) => ({
    ...options,
    disableComment: options.disableComment ?? undefined,
    disableDuet: options.disableDuet ?? undefined,
    disableStitch: options.disableStitch ?? undefined,
    brandContentToggle: options.brandContentToggle ?? undefined,
    yourBrand: options.yourBrand ?? undefined,
    brandedContent: options.brandedContent ?? undefined,
    isAigc: options.isAigc ?? undefined,
    privacyStatus: options.privacyStatus ?? undefined,
  }));

export function withPostTypeRules<
  TSchema extends z.ZodType<{
    platform: X402Platform;
    post_type: "text" | "image" | "video";
    media_storage_path?: string;
  }>,
>(schema: TSchema) {
  return schema.superRefine((body, ctx) => {
    if (!platformSupportsMediaType(body.platform, body.post_type)) {
      ctx.addIssue({
        code: "custom",
        path: ["post_type"],
        message: `${PLATFORM_LABELS[body.platform]} does not accept ${body.post_type} posts.`,
      });
    }
    if (
      body.post_type !== "text" &&
      (!body.media_storage_path || body.media_storage_path.length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["media_storage_path"],
        message: "media_storage_path is required for image and video posts.",
      });
    }
  });
}
