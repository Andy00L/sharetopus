"use server";

import { adminSupabase } from "@/actions/api/supabase-client";

/**
 * Resume a previously cancelled post
 *
 * @param postId ID of the post to resume
 * @param userId ID of the authenticated user
 * @returns Object with success status and message
 */
export async function resumeScheduledPost(
  postId: string,
  userId: string | null
): Promise<{ success: boolean; message: string }> {
  if (!userId) {
    return { success: false, message: "User not authenticated." };
  }

  try {
    // First, get the post to check ownership and current status
    const { data: post, error: fetchError } = await adminSupabase
      .from("scheduled_posts")
      .select("user_id, status, scheduled_at")
      .eq("id", postId)
      .single();

    if (fetchError || !post) {
      console.error("[Resume Post] Fetch error:", fetchError);
      return {
        success: false,
        message: "Failed to find the scheduled post.",
      };
    }

    // Security check: ensure the post belongs to this user
    if (post.user_id !== userId) {
      console.warn(
        `[Resume Post] User ${userId} attempted to resume post ${postId} owned by ${post.user_id}`
      );
      return {
        success: false,
        message: "You are not authorized to resume this post.",
      };
    }

    // Only allow resuming if the post is in "cancelled" status
    if (post.status !== "cancelled") {
      return {
        success: false,
        message: `This post cannot be resumed because it is in "${post.status}" status.`,
      };
    }

    // Make sure the scheduled time is in the future
    const scheduledAt = new Date(post.scheduled_at);
    const now = new Date();

    if (scheduledAt <= now) {
      // If the scheduled time is in the past, we need to set a new time in the future
      // Let's set it to 1 hour from now as a default
      scheduledAt.setTime(now.getTime() + 60 * 60 * 1000);
    }

    // Update the post status to "scheduled" and update the scheduled_at if needed
    const { error: updateError } = await adminSupabase
      .from("scheduled_posts")
      .update({
        status: "scheduled",
        scheduled_at: scheduledAt.toISOString(),
      })
      .eq("id", postId);

    if (updateError) {
      console.error("[Resume Post] Update error:", updateError);
      return {
        success: false,
        message: `Failed to resume the post: ${updateError.message}`,
      };
    }

    return {
      success: true,
      message:
        "Post resumed successfully. It will be published at the scheduled time.",
    };
  } catch (err) {
    console.error("[Resume Post] Unexpected error:", err);
    return {
      success: false,
      message:
        err instanceof Error ? err.message : "An unexpected error occurred.",
    };
  }
}
