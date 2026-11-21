import { z } from "zod";

import { PostCreateInputSchema } from "./schemas";

export const PostPatchInputSchema = z.object({
  scheduled_at: z
    .string()
    .datetime({ offset: true })
    .refine(
      (value) => {
        const parsed = Date.parse(value);
        return !Number.isNaN(parsed) && parsed > Date.now();
      },
      { message: "scheduled_at must be a future ISO 8601 timestamp" },
    ),
});

export type PostPatchInput = z.infer<typeof PostPatchInputSchema>;

export const PostBulkInputSchema = z.object({
  posts: z.array(PostCreateInputSchema).min(1).max(30),
});

export type PostBulkInput = z.infer<typeof PostBulkInputSchema>;

export const PostDeleteQuerySchema = z.object({
  hard: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export type PostDeleteQuery = z.infer<typeof PostDeleteQuerySchema>;
