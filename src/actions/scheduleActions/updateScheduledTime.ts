"use server";
import { adminSupabase } from "@/actions/api/supabase-client";

/**
 * Update the scheduled time of a post
 *
 * @param postId ID of the post to update
 * @param newScheduledTime New scheduled time (ISO string or Date object)
 * @param userId ID of the authenticated user
 * @returns Object with success status and message
 */
export async function updateScheduledTime(
  postId: string,
  newScheduledTime: string | Date,
  userId: string | null
): Promise<{ success: boolean; message: string }> {
  if (!userId) {
    return { success: false, message: "User not authenticated." };
  }

  // Validate new time is in the future
  const scheduledTime = new Date(newScheduledTime);
  const now = new Date();

  if (scheduledTime <= now) {
    return {
      success: false,
      message: "Scheduled time must be in the future.",
    };
  }

  try {
    // First, get the post to check ownership and status
    const { data: post, error: fetchError } = await adminSupabase
      .from("scheduled_posts")
      .select("user_id, status")
      .eq("id", postId)
      .single();

    if (fetchError || !post) {
      console.error("[Update Schedule] Fetch error:", fetchError);
      return {
        success: false,
        message: "Failed to find the scheduled post.",
      };
    }

    // Security check: ensure the post belongs to this user
    if (post.user_id !== userId) {
      console.warn(
        `[Update Schedule] User ${userId} attempted to update post ${postId} owned by ${post.user_id}`
      );
      return {
        success: false,
        message: "You are not authorized to update this post.",
      };
    }

    // Only allow updates if the post is in "scheduled" or "cancelled" status
    if (post.status !== "scheduled" && post.status !== "cancelled") {
      return {
        success: false,
        message: `This post cannot be rescheduled because it is in "${post.status}" status.`,
      };
    }

    // Update the scheduled time
    const { error: updateError } = await adminSupabase
      .from("scheduled_posts")
      .update({
        scheduled_at: scheduledTime.toISOString(),
        // If the post was cancelled, automatically resume it
        status: post.status === "cancelled" ? "scheduled" : post.status,
      })
      .eq("id", postId);

    if (updateError) {
      console.error("[Update Schedule] Update error:", updateError);
      return {
        success: false,
        message: `Failed to update schedule: ${updateError.message}`,
      };
    }

    return {
      success: true,
      message:
        post.status === "cancelled"
          ? "Post rescheduled and resumed successfully."
          : "Post rescheduled successfully.",
    };
  } catch (err) {
    console.error("[Update Schedule] Unexpected error:", err);
    return {
      success: false,
      message:
        err instanceof Error ? err.message : "An unexpected error occurred.",
    };
  }
}
