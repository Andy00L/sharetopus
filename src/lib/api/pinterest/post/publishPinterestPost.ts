// lib/api/pinterest/publishPinterestPost.ts

import { getSupabaseVideoFile } from "@/actions/server/scheduleActions/getSupabaseVideoFile";
import { createPinterestPinFromBase64 } from "./createPinterestPin";

interface PinterestPostOptions {
  board: string;
  privacyLevel: string;
  link?: string;
}

/**
 * Publishes a scheduled Pinterest post
 *
 * @param accessToken Pinterest access token
 * @param mediaPath Path to the media in Supabase storage
 * @param caption Post caption/title
 * @param options Pinterest-specific posting options
 * @param userId User ID for Supabase access
 * @returns Object with success status and published post information
 */
export async function publishPinterestPost(
  accessToken: string,
  mediaPath: string,
  caption: string,
  options: PinterestPostOptions,
  userId: string
): Promise<{ success: boolean; postId?: string; error?: string }> {
  try {
    console.log(`[Pinterest] Publishing scheduled post from ${mediaPath}`);

    if (!options.board) {
      throw new Error("Board ID is required for Pinterest posts");
    }

    // 1. Get the image file from Supabase storage
    const mediaBuffer = await getSupabaseVideoFile(mediaPath, userId);

    // 2. Convert Buffer to base64
    const base64Data = mediaBuffer.toString("base64");

    // 3. Determine content type based on file extension
    const contentType = mediaPath.toLowerCase().endsWith(".png")
      ? "image/png"
      : "image/jpeg";

    // 4. Create the Pinterest pin
    const pinResponse = await createPinterestPinFromBase64(
      accessToken,
      options.board,
      base64Data,
      contentType,
      {
        title: caption,
        description: caption,
        link: options.link,
      }
    );

    return {
      success: true,
      postId: pinResponse.id,
    };
  } catch (error) {
    console.error("[Pinterest] Error publishing post:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}
