import { z } from "zod";

import { PostCreateInputSchema } from "./schemas";

/**
 * Body schema for PATCH /v1/posts/[id].
 *
 * Only `scheduled_at` is patchable for now. The internal
 * updateScheduledTimeBatch enforces the future-time constraint,
 * but we reject obviously invalid values at the edge.
 */
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

/**
 * Body schema for POST /v1/posts/bulk.
 *
 * Each item reuses PostCreateInputSchema (same validation as single
 * POST /v1/posts). Array length capped at 30 to match MCP bulk_schedule.
 */
export const PostBulkInputSchema = z.object({
  posts: z.array(PostCreateInputSchema).min(1).max(30),
});

export type PostBulkInput = z.infer<typeof PostBulkInputSchema>;

/**
 * Query schema for DELETE /v1/posts/[id].
 *
 * `hard=true` triggers permanent deletion with media cleanup.
 * Default (absent or false) is soft-cancel (status -> cancelled).
 */
export const PostDeleteQuerySchema = z.object({
  hard: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export type PostDeleteQuery = z.infer<typeof PostDeleteQuerySchema>;
