"use server";

import { adminSupabase } from "@/actions/api/supabase-client";
import { deleteSupabaseFileAction } from "./deleteSupabaseFileAction";

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
