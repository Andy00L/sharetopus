import "server-only";

import { z } from "zod";

import { POSTING_PLATFORMS } from "@/lib/platforms/capabilities";

/**
 * Shared request-body schema for the two posting endpoints (post-now and
 * schedule). Keeping the field list here means the routes cannot drift on
 * what a post body looks like.
 *
 * media_storage_path is required for image/video posts and may be absent or
 * empty for text posts. A plain `.min(1).default("")` cannot express that
 * (Zod 4 defaults bypass inner validation entirely), so the rule lives in
 * withMediaPathRule, applied AFTER any .extend() because refinements do not
 * survive extension.
 *
 * Called by: /api/x402/post-now, /api/x402/schedule
 */
export const PostBodyBaseSchema = z.object({
  social_account_id: z.string().uuid(),
  platform: z.enum(POSTING_PLATFORMS),
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

/** Enforces media_storage_path presence for image/video post types. */
export function withMediaPathRule<
  TSchema extends z.ZodType<{
    post_type: "text" | "image" | "video";
    media_storage_path?: string;
  }>,
>(schema: TSchema) {
  return schema.superRefine((body, ctx) => {
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
