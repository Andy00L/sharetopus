import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";

/**
 * Cancels scheduled posts without authCheck. Principal already verified
 * by the MCP route handler.
 *
 * Mirrors src/actions/server/scheduleActions/cancelScheduledPost.ts
 * Tables touched: scheduled_posts (read + update)
 * Called by: src/lib/mcp/tools/cancelScheduledPosts.ts
 */
export async function cancelScheduledPostBatchInternal(
  postIds: string[],
  principalId: string
): Promise<{
  success: boolean;
  message: string;
  details?: { total: number; succeeded: number; failed: number };
}> {
  try {
    if (!postIds || postIds.length === 0) {
      return { success: false, message: "No post IDs provided." };
    }

    const { data: posts, error: fetchError } = await adminSupabase
      .from("scheduled_posts")
      .select("id, principal_id, status, platform")
      .in("id", postIds);

    if (fetchError || !posts || posts.length === 0) {
      return { success: false, message: "No posts found with the provided IDs." };
    }

    // Ownership check
    const unauthorized = posts.filter((p) => p.principal_id !== principalId);
    if (unauthorized.length > 0) {
      return { success: false, message: "You do not own some of these posts." };
    }

    const cancellable = posts.filter((p) => p.status === "scheduled");
    if (cancellable.length === 0) {
      return {
        success: false,
        message: "None of the selected posts can be cancelled.",
      };
    }

    const ids = cancellable.map((p) => p.id);
    const { error: updateError } = await adminSupabase
      .from("scheduled_posts")
      .update({ status: "cancelled" })
      .in("id", ids);

    if (updateError) {
      return { success: false, message: "Database error cancelling posts." };
    }

    return {
      success: true,
      message: `Cancelled ${cancellable.length} post(s).`,
      details: {
        total: postIds.length,
        succeeded: cancellable.length,
        failed: postIds.length - cancellable.length,
      },
    };
  } catch (err) {
    console.error(
      `[cancelScheduledPostBatchInternal] Error:`,
      err instanceof Error ? err.message : err
    );
    return { success: false, message: "Unexpected error cancelling posts." };
  }
}
