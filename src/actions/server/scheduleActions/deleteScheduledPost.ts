"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { deleteSupabaseFileAction } from "../data/deleteSupabaseFileAction";
import { authCheck } from "@/actions/authCheck";

/**
 * Completely delete a scheduled post and its associated media (if no longer used)
 *
 * @param postId ID of the scheduled post to delete
 * @param userId ID of the authenticated user
 * @returns Object with success status and message
 */
export async function deleteScheduledPost(
  postId: string,
  userId: string | null
): Promise<{ success: boolean; message: string }> {
  // Verify user is properly authenticated
  const authResult = await authCheck(userId);
  if (!authResult) {
    console.error(
      `[fetchSocialAccounts]: Authentication check failed for user ID: ${userId}`
    );
    return {
      success: false,
      message: "Authentication validation failed. Please sign in again.",
    };
  }

  try {
    console.log(`[Delete Scheduled Post] Processing post: ${postId}`);

    // First, get the post to check ownership and get the media path
    const { data: post, error: fetchError } = await adminSupabase
      .from("scheduled_posts")
      .select("user_id, media_storage_path, status")
      .eq("id", postId)
      .single();

    if (fetchError || !post) {
      console.error("[Delete Scheduled Post] Fetch error:", fetchError);
      return {
        success: false,
        message: "Failed to find the scheduled post.",
      };
    }

    // Security check: ensure the post belongs to this user
    if (post.user_id !== userId) {
      console.warn(
        `[Delete Scheduled Post] User ${userId} attempted to delete post ${postId} owned by ${post.user_id}`
      );
      return {
        success: false,
        message: "You are not authorized to delete this post.",
      };
    }

    // First delete the post record from the database
    // This ensures that our reference check won't count this post
    const { error: deleteError } = await adminSupabase
      .from("scheduled_posts")
      .delete()
      .eq("id", postId);

    if (deleteError) {
      console.error("[Delete Scheduled Post] Delete error:", deleteError);
      return {
        success: false,
        message: `Failed to delete the post.`,
      };
    }

    console.log(`[Delete Scheduled Post] Post record deleted: ${postId}`);

    // Now try to delete the media file if it exists
    // The deleteSupabaseFileAction function will automatically check for references
    if (post.media_storage_path) {
      try {
        console.log(
          `[Delete Scheduled Post] Checking if media can be deleted: ${post.media_storage_path}`
        );
        const deleteFileResult = await deleteSupabaseFileAction(
          userId,
          post.media_storage_path
        );

        console.log(
          `[Delete Scheduled Post] File deletion result:`,
          deleteFileResult
        );
      } catch (deleteError) {
        console.error(
          "[Delete Scheduled Post] File deletion error:",
          deleteError
        );
        // We continue regardless of file deletion success
      }
    }

    return {
      success: true,
      message: "Post deleted successfully.",
    };
  } catch (err) {
    console.error("[Delete Scheduled Post] Unexpected error:", err);
    return {
      success: false,
      message: "An unexpected error occurred.",
    };
  }
}
