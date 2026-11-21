import * as z from "zod/mini";

/**
 * Shared response types for GET /api/posts/status.
 *
 * Imported by the route handler (server) and the client polling util
 * to keep the response contract in one place.
 *
 * The public API exposes "pending" | "success" | "failed".
 * The DB column (pending_direct_posts.status) stores
 * "processing" | "completed" | "failed". The route maps at the
 * boundary; see mapDbStatusToPublic in route.ts.
 */

const PostStatusJobSchema = z.object({
  event_id: z.string(),
  status: z.enum(["pending", "success", "failed"]),
  platform: z.string(),
  error_message: z.nullable(z.string()),
});

export const PostStatusResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    jobs: z.array(PostStatusJobSchema),
    allTerminal: z.boolean(),
  }),
  z.object({ success: z.literal(false), message: z.string() }),
]);

export type PostStatusJob = z.infer<typeof PostStatusJobSchema>;

export type PostStatusJobStatus = PostStatusJob["status"];

export type PostStatusResponse = z.infer<typeof PostStatusResponseSchema>;

/**
 * True if the status has reached a terminal state.
 */
export function isJobTerminal(status: PostStatusJobStatus): boolean {
  return status === "success" || status === "failed";
}
