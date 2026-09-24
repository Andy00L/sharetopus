import "server-only";

import { inArray } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { scheduled_posts } from "@/db/schema";
import type { CreatedVia } from "@/db/schema";
import { checkRateLimit } from "../../rateLimit/checkRateLimit";

/**
 * Cancels scheduled posts in batch. Sets status='cancelled' on rows
 * currently in 'scheduled' status that belong to `principalId`, and clears
 * cancelled_by_sub_at: only a subscription lapse sets that tag, and the
 * 7-day grace cleanup deletes the posts that carry it.
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
  requestId?: string | null,
): Promise<{
  success: boolean;
  message: string;
  resetIn?: number;
  details?: { total: number; succeeded: number; failed: number };
}> {
  console.log(
    `[cancelScheduledPostBatch] [req=${requestId ?? "?"}] Starting from source="${source}" for principal=${principalId}, ${postIds?.length ?? 0} post(s) requested`,
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
        message: rateCheck.message,
        resetIn: rateCheck.resetIn,
      };
    }

    // Step 2: fetch posts and verify ownership
    const { data: posts, error: fetchError } = await runQuery(
      db
        .select({
          id: scheduled_posts.id,
          principal_id: scheduled_posts.principal_id,
          status: scheduled_posts.status,
        })
        .from(scheduled_posts)
        .where(inArray(scheduled_posts.id, postIds)),
    );

    if (fetchError) {
      console.error(
        `[cancelScheduledPostBatch] [req=${requestId ?? "?"}] Fetch error:`,
        fetchError.message,
      );
      return {
        success: false,
        message: "Could not load your posts. Please try again.",
      };
    }
    if (posts.length === 0) {
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
        `[cancelScheduledPostBatch] [req=${requestId ?? "?"}] Ownership violation: ${principalId} tried to cancel ${unauthorizedPosts.length} post(s) they don't own`,
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
    const { error: updateError } = await runQuery(
      db
        .update(scheduled_posts)
        .set({ status: "cancelled", cancelled_by_sub_at: null })
        .where(inArray(scheduled_posts.id, cancellableIds)),
    );

    if (updateError) {
      console.error(
        `[cancelScheduledPostBatch] [req=${requestId ?? "?"}] Update error:`,
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
      `[cancelScheduledPostBatch] [req=${requestId ?? "?"}] Unexpected error:`,
      err instanceof Error ? err.message : err,
    );
    return {
      success: false,
      message: "Unexpected error cancelling posts.",
    };
  }
}
