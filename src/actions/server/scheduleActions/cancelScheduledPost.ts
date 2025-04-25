"use server";

import { adminSupabase } from "@/actions/api/supabase-client";

/**
 * Cancel a scheduled post
 *
 * @param postId ID of the scheduled post to cancel
 * @returns Object with success status and message
 */
export async function cancelScheduledPost(
  postId: string,
  userId: string | null
): Promise<{ success: boolean; message: string }> {
  if (!userId) {
    return { success: false, message: "User not authenticated." };
  }

  try {
    // First, get the post to check ownership and get the media path
    const { data: post, error: fetchError } = await adminSupabase
      .from("scheduled_posts")
      .select("user_id, media_storage_path, status")
      .eq("id", postId)
      .single();

    if (fetchError || !post) {
      console.error("[Cancel Scheduled Post] Fetch error:", fetchError);
      return {
        success: false,
        message: "Failed to find the scheduled post.",
      };
    }

    // Security check: ensure the post belongs to this user
    if (post.user_id !== userId) {
      console.warn(
        `[Cancel Scheduled Post] User ${userId} attempted to cancel post ${postId} owned by ${post.user_id}`
      );
      return {
        success: false,
        message: "You are not authorized to cancel this post.",
      };
    }

    // Only allow cancellation if the post is still in "scheduled" status
    if (post.status !== "scheduled") {
      return {
        success: false,
        message: `This post cannot be cancelled because it is already in "${post.status}" status.`,
      };
    }

    // Update the post status to "cancelled"
    const { error: updateError } = await adminSupabase
      .from("scheduled_posts")
      .update({ status: "cancelled" })
      .eq("id", postId);

    if (updateError) {
      console.error("[Cancel Scheduled Post] Update error:", updateError);
      return {
        success: false,
        message: `Failed to cancel the post.`,
      };
    }

    // No longer delete the media file - we keep it for potential reuse

    return {
      success: true,
      message: "Post cancelled successfully.",
    };
  } catch (err) {
    console.error("[Cancel Scheduled Post] Unexpected error:", err);
    return {
      success: false,
      message: "An unexpected error occurred.",
    };
  }
}
