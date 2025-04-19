// actions/server/pinterest/publishScheduledPinterestPost.ts
"use server";

import { adminSupabase } from "@/actions/api/supabase-client";
import { getSupabaseVideoFile } from "@/actions/server/scheduleActions/getSupabaseVideoFile";
import { createPinterestPinFromBase64 } from "@/lib/api/pinterest/post/createPinterestPin";

/**
 * Server action to publish a scheduled Pinterest post
 *
 * @param postId ID of the scheduled post to publish
 * @param userId ID of the authenticated user
 * @returns Object with success status, message, and optional pin ID
 */
export async function publishScheduledPinterestPost(
  postId: string,
  userId: string | null
): Promise<{ success: boolean; message: string; pinId?: string }> {
  if (!userId) {
    return { success: false, message: "User not authenticated." };
  }

  try {
    // 1. Get the scheduled post data
    const { data: post, error: fetchError } = await adminSupabase
      .from("scheduled_posts")
      .select("*, social_accounts(*)")
      .eq("id", postId)
      .eq("user_id", userId)
      .single();

    if (fetchError || !post) {
      console.error("[Pinterest] Fetch error:", fetchError);
      return {
        success: false,
        message: "Failed to find the scheduled post.",
      };
    }

    // 2. Verify the post belongs to this user and is for Pinterest
    if (post.user_id !== userId) {
      console.warn(
        `[Pinterest] User ${userId} attempted to publish post ${postId} owned by ${post.user_id}`
      );
      return {
        success: false,
        message: "You are not authorized to publish this post.",
      };
    }

    if (post.platform !== "pinterest") {
      return {
        success: false,
        message: "This is not a Pinterest post.",
      };
    }

    // 3. Get the access token from the social account
    const accessToken = post.social_accounts.access_token;
    if (!accessToken) {
      return {
        success: false,
        message: "Pinterest access token not found.",
      };
    }

    // 4. Get and parse post options
    const postOptions = post.post_options || {};
    if (!postOptions.board) {
      return {
        success: false,
        message: "Board ID is required for Pinterest posts.",
      };
    }

    // 5. Get media file from Supabase
    try {
      // Get the media file
      const mediaBuffer = await getSupabaseVideoFile(
        post.media_storage_path,
        userId
      );

      // Convert to base64
      const base64Data = mediaBuffer.toString("base64");

      // Determine content type (assuming we're dealing with an image)
      const contentType = post.media_storage_path.toLowerCase().endsWith(".png")
        ? "image/png"
        : "image/jpeg";

      // 6. Create the pin on Pinterest
      const pinResponse = await createPinterestPinFromBase64(
        accessToken,
        postOptions.board,
        base64Data,
        contentType,
        {
          title: post.post_title ?? undefined,
          description: post.post_title ?? undefined,
          link: postOptions.link,
        }
      );

      // 7. Update the post status to posted
      const { error: updateError } = await adminSupabase
        .from("scheduled_posts")
        .update({
          status: "posted",
          posted_at: new Date().toISOString(),
        })
        .eq("id", postId);

      if (updateError) {
        console.error("[Pinterest] Update error:", updateError);
        // Even if we have an error here, the pin was created so we can return success
      }

      return {
        success: true,
        message: "Pin published successfully to Pinterest!",
        pinId: pinResponse.id,
      };
    } catch (mediaError) {
      console.error("[Pinterest] Media processing error:", mediaError);

      // Update post with error
      await adminSupabase
        .from("scheduled_posts")
        .update({
          status: "failed",
          error_message:
            mediaError instanceof Error
              ? mediaError.message
              : "Media processing failed",
        })
        .eq("id", postId);

      return {
        success: false,
        message:
          "Failed to process media for Pinterest: " +
          (mediaError instanceof Error ? mediaError.message : "Unknown error"),
      };
    }
  } catch (err) {
    console.error("[Pinterest] Publishing error:", err);

    // Update post with error
    try {
      await adminSupabase
        .from("scheduled_posts")
        .update({
          status: "failed",
          error_message:
            err instanceof Error ? err.message : "Unknown error occurred",
        })
        .eq("id", postId);
    } catch {
      // Ignore errors in error handling
    }

    return {
      success: false,
      message:
        err instanceof Error ? err.message : "An unexpected error occurred.",
    };
  }
}
