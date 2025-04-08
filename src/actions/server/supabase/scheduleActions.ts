// actions/server/supabase/scheduleActions.ts
"use server";
import { adminSupabase } from "@/actions/api/supabase-client";
import { Provider } from "@/lib/types/provider";
import { TikTokPrivacyLevel } from "@/lib/types/TikTokPrivacyLevel ";

// Define the structure of the data expected by this action
export interface SchedulePostData {
  socialAccountId: string;
  platform: Provider | string;
  scheduledAt: string | Date; // ISO string or Date object
  title: string | null;
  mediaType: "video" | "image"; // Extend as needed
  mediaStoragePath: string; // Path from Supabase Storage
  postOptions: {
    // Platform-specific options
    privacyLevel?: TikTokPrivacyLevel;
    disableComment?: boolean;
    disableDuet?: boolean;
    disableStitch?: boolean;
    // Add other platform options here as needed
  } | null;
}

/**
 * Schedule a post for publishing at a later time
 *
 * @param data SchedulePostData object containing necessary information for scheduling
 * @returns Object with success status, message, and optionally the scheduled post ID
 */
export async function schedulePost(
  data: SchedulePostData,
  userId: string | null
): Promise<{ success: boolean; message: string; scheduleId?: string }> {
  if (!userId) {
    return { success: false, message: "User not authenticated." };
  }

  // Basic validation
  if (
    !data.socialAccountId ||
    !data.platform ||
    !data.scheduledAt ||
    !data.mediaType ||
    !data.mediaStoragePath
  ) {
    return {
      success: false,
      message: "Missing required scheduling information.",
    };
  }

  try {
    console.log(`[Schedule Action] Scheduling post for user ${userId}`, data);

    // Validate the social account belongs to this user
    const { data: accountData, error: accountError } = await adminSupabase
      .from("social_accounts")
      .select("id")
      .eq("id", data.socialAccountId)
      .eq("user_id", userId)
      .single();

    if (accountError || !accountData) {
      console.error(
        "[Schedule Action] Account validation error:",
        accountError
      );
      return {
        success: false,
        message:
          "The selected social account is invalid or doesn't belong to you.",
      };
    }

    // Prepare data for insertion
    const insertData = {
      user_id: userId,
      social_account_id: data.socialAccountId,
      platform: data.platform,
      status: "scheduled", // Default status
      scheduled_at: new Date(data.scheduledAt).toISOString(), // Ensure it's ISO string
      post_title: data.title,
      post_options: data.postOptions, // Store the JSONB options
      media_type: data.mediaType,
      media_storage_path: data.mediaStoragePath,
    };

    // Insert the record into the scheduled_posts table
    const { data: newSchedule, error } = await adminSupabase
      .from("scheduled_posts")
      .insert(insertData)
      .select("id") // Select the ID of the newly created row
      .single(); // Expect only one row back

    if (error) {
      console.error("[Schedule Action] Supabase insert error:", error);
      return { success: false, message: `Database error: ${error.message}` };
    }

    if (!newSchedule || !newSchedule.id) {
      console.error("[Schedule Action] Insert succeeded but no ID returned.");
      return {
        success: false,
        message: "Failed to confirm schedule creation.",
      };
    }

    console.log(
      `[Schedule Action] Post scheduled successfully with ID: ${newSchedule.id}`
    );

    // Add platform-specific success messages
    let platformMessage = "";
    if (data.platform === "tiktok") {
      platformMessage =
        " Your TikTok video will be published at the scheduled time.";
    } else if (data.platform === "instagram") {
      platformMessage =
        " Your Instagram post will be published at the scheduled time.";
    } else if (data.platform === "facebook") {
      platformMessage =
        " Your Facebook post will be published at the scheduled time.";
    }

    return {
      success: true,
      message: `Post scheduled successfully!${platformMessage}`,
      scheduleId: newSchedule.id,
    };
  } catch (err) {
    console.error("[Schedule Action] Unexpected error:", err);
    return {
      success: false,
      message:
        err instanceof Error ? err.message : "An unexpected error occurred.",
    };
  }
}

/**
 * Delete a file from Supabase Storage
 *
 * @param filePath Path to the file in Supabase Storage
 * @returns Object with success status and message
 */
export async function deleteSupabaseFileAction(
  filePath: string,
  userId: string | null
): Promise<{ success: boolean; message: string }> {
  if (!userId) {
    return { success: false, message: "User not authenticated." };
  }

  // Security Check: Ensure the file path starts with the user's ID
  // This prevents users from potentially deleting others' files if they guess paths
  if (!filePath || !filePath.startsWith(`${userId}/`)) {
    console.warn(
      `[Delete Action] Attempt to delete invalid/unauthorized path by user ${userId}: ${filePath}`
    );
    return { success: false, message: "Invalid file path or unauthorized." };
  }

  try {
    console.log(
      `[Delete Action] Deleting file for user ${userId}: ${filePath}`
    );

    const { error } = await adminSupabase.storage
      .from("scheduled-videos") // Use your bucket name
      .remove([filePath]);

    // Use your bucket name
    if (error) {
      console.error(
        `[Delete Action] Supabase delete error for path ${filePath}:`,
        error
      );
      return {
        success: false,
        message: `Failed to delete file: ${error.message}`,
      };
    }

    console.log(`[Delete Action] File deleted successfully: ${filePath}`);
    return { success: true, message: "File deleted." };
  } catch (err) {
    console.error(
      `[Delete Action] Unexpected error deleting ${filePath}:`,
      err
    );
    return {
      success: false,
      message: "An unexpected error occurred during file deletion.",
    };
  }
}

/**
 * Get all scheduled posts for the authenticated user
 *
 * @returns Array of scheduled posts
 */
export async function getScheduledPosts(userId: string | null) {
  if (!userId) {
    console.log("User not authenticated.");
  }

  try {
    // Join with social_accounts to get account details
    const { data, error } = await adminSupabase
      .from("scheduled_posts")
      .select(
        `
        *,
        social_accounts:social_account_id (
          id,
          platform,
          account_identifier,
          extra
        )
      `
      )
      .eq("user_id", userId)
      .order("scheduled_at", { ascending: true });

    if (error) {
      console.error("[Get Scheduled Posts] Error:", error);
      throw new Error(`Failed to fetch scheduled posts: ${error.message}`);
    }

    return data || [];
  } catch (err) {
    console.error("[Get Scheduled Posts] Unexpected error:", err);
    throw err;
  }
}

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
      console.error("[Cancel Post] Fetch error:", fetchError);
      return {
        success: false,
        message: "Failed to find the scheduled post.",
      };
    }

    // Security check: ensure the post belongs to this user
    if (post.user_id !== userId) {
      console.warn(
        `[Cancel Post] User ${userId} attempted to cancel post ${postId} owned by ${post.user_id}`
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
      console.error("[Cancel Post] Update error:", updateError);
      return {
        success: false,
        message: `Failed to cancel the post: ${updateError.message}`,
      };
    }

    // No longer delete the media file - we keep it for potential reuse

    return {
      success: true,
      message: "Post cancelled successfully.",
    };
  } catch (err) {
    console.error("[Cancel Post] Unexpected error:", err);
    return {
      success: false,
      message:
        err instanceof Error ? err.message : "An unexpected error occurred.",
    };
  }
}
/**
 * Completely delete a scheduled post and its associated media
 *
 * @param postId ID of the scheduled post to delete
 * @param userId ID of the authenticated user
 * @returns Object with success status and message
 */
export async function deleteScheduledPost(
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
      console.error("[Delete Post] Fetch error:", fetchError);
      return {
        success: false,
        message: "Failed to find the scheduled post.",
      };
    }

    // Security check: ensure the post belongs to this user
    if (post.user_id !== userId) {
      console.warn(
        `[Delete Post] User ${userId} attempted to delete post ${postId} owned by ${post.user_id}`
      );
      return {
        success: false,
        message: "You are not authorized to delete this post.",
      };
    }

    // Delete the media file from storage if it exists
    if (post.media_storage_path) {
      try {
        const deleteFileResult = await deleteSupabaseFileAction(
          post.media_storage_path,
          userId
        );
        if (!deleteFileResult.success) {
          console.error(
            "[Delete Post] File deletion error:",
            deleteFileResult.message
          );
          // Continue with post deletion even if file deletion fails
        }
      } catch (deleteError) {
        console.error("[Delete Post] File deletion error:", deleteError);
        // Continue with post deletion even if file deletion fails
      }
    }

    // Delete the post record from the database
    const { error: deleteError } = await adminSupabase
      .from("scheduled_posts")
      .delete()
      .eq("id", postId);

    if (deleteError) {
      console.error("[Delete Post] Delete error:", deleteError);
      return {
        success: false,
        message: `Failed to delete the post: ${deleteError.message}`,
      };
    }

    return {
      success: true,
      message: "Post deleted successfully.",
    };
  } catch (err) {
    console.error("[Delete Post] Unexpected error:", err);
    return {
      success: false,
      message:
        err instanceof Error ? err.message : "An unexpected error occurred.",
    };
  }
}
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
