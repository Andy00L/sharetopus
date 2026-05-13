import { adminSupabase } from "@/actions/api/adminSupabase";
import type { CreatedVia } from "@/lib/types/database.types";
import "server-only";
import { checkRateLimit } from "../../rateLimit/checkRateLimit";

/**
 * Cancels scheduled posts in batch. Sets status='cancelled' on rows
 * currently in 'scheduled' status that belong to `principalId`.
 *
 * **Authentication:** Does not call Clerk. Caller must validate
 * `principalId` (Server Action: `auth()`; MCP: `extractPrincipal`).
 *
 * **Rate limiting:** 30 requests per 60s, scoped per source (e.g.
 * `web_cancel_scheduled_posts`, `mcp_cancel_scheduled_posts`).
 *
 * **Tables:** `scheduled_posts` (read + update).
 *
 * @param postIds - Array of scheduled_posts.id to cancel
 * @param principalId - Owner principal; ownership check enforced
 * @param source - Channel label; drives rate-limit scope
 */
export async function cancelScheduledPostBatch(
  postIds: string[],
  principalId: string,
  source: CreatedVia,
): Promise<{
  success: boolean;
  message: string;
  resetIn?: number;
  details?: { total: number; succeeded: number; failed: number };
}> {
  console.log(
    `[cancelScheduledPostBatch] Starting from source="${source}" for principal=${principalId}, ${postIds?.length ?? 0} post(s) requested`,
  );
  try {
    if (!postIds || postIds.length === 0) {
      return { success: false, message: "No post IDs provided." };
    }

    // Step 1: rate limit
    const rateLimitScope = `${source}_cancel_scheduled_posts`;
    const rateCheck = await checkRateLimit(rateLimitScope, principalId, 30, 60);
    if (!rateCheck.success) {
      return {
        success: false,
        message: "Too many requests. Please try again later.",
        resetIn: rateCheck.resetIn,
      };
    }

    // Step 2: fetch posts and verify ownership
    const { data: posts, error: fetchError } = await adminSupabase
      .from("scheduled_posts")
      .select("id, principal_id, status, platform")
      .in("id", postIds);

    if (fetchError || !posts || posts.length === 0) {
      return {
        success: false,
        message: "No posts found with the provided IDs.",
      };
    }

    const unauthorizedPosts = posts.filter(
      (post) => post.principal_id !== principalId,
    );
    if (unauthorizedPosts.length > 0) {
      console.warn(
        `[cancelScheduledPostBatch] Ownership violation: ${principalId} tried to cancel ${unauthorizedPosts.length} post(s) they don't own`,
      );
      return {
        success: false,
        message: "You do not own some of these posts.",
      };
    }

    // Step 3: filter cancellable posts (only 'scheduled' status)
    const cancellablePosts = posts.filter(
      (post) => post.status === "scheduled",
    );
    if (cancellablePosts.length === 0) {
      return {
        success: false,
        message: "None of the selected posts can be cancelled.",
      };
    }

    // Step 4: batch update to 'cancelled'
    const cancellableIds = cancellablePosts.map((post) => post.id);
    const { error: updateError } = await adminSupabase
      .from("scheduled_posts")
      .update({ status: "cancelled" })
      .in("id", cancellableIds);

    if (updateError) {
      console.error(
        `[cancelScheduledPostBatch] Update error:`,
        updateError.message,
      );
      return { success: false, message: "Database error cancelling posts." };
    }

    return {
      success: true,
      message: `Cancelled ${cancellablePosts.length} post(s).`,
      details: {
        total: postIds.length,
        succeeded: cancellablePosts.length,
        failed: postIds.length - cancellablePosts.length,
      },
    };
  } catch (err) {
    console.error(
      `[cancelScheduledPostBatch] Unexpected error:`,
      err instanceof Error ? err.message : err,
    );
    return {
      success: false,
      message: "Unexpected error cancelling posts.",
    };
  }
}
