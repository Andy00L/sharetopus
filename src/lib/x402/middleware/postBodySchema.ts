import "server-only";

import { z } from "zod";

import { X402_PLATFORMS } from "@/lib/x402/config";

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
