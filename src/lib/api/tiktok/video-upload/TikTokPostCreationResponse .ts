// lib/api/tiktok/createTikTokPost.ts

import { TikTokPrivacyLevel } from "@/lib/types/TikTokPrivacyLevel ";

/**
 * Interface for TikTok post creation response
 */
export interface TikTokPostCreationResponse {
  data: {
    post_id: string;
    share_url?: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Create a TikTok post with an uploaded video
 *
 * @param accessToken TikTok API access token
 * @param videoId Video ID from the upload completion response
 * @param caption Post caption/description
 * @param options Additional post options (privacy, comments, etc.)
 * @returns TikTok post creation response
 */
export async function createTikTokPost(
  accessToken: string,
  videoId: string,
  caption: string = "",
  options: {
    privacyLevel?: TikTokPrivacyLevel;
    disableComment?: boolean;
    disableDuet?: boolean;
    disableStitch?: boolean;
  } = {}
): Promise<TikTokPostCreationResponse> {
  try {
    console.log(`[TikTok] Creating post with video_id: ${videoId}`);

    // TikTok API endpoint for creating posts
    const url = "https://open.tiktokapis.com/v2/post/publish/content/";

    // Prepare the request body with all options
    const requestBody: any = {
      video_id: videoId,
      post_info: {
        title: caption,
        privacy_level: options.privacyLevel || "SELF_ONLY",
        disable_comment: options.disableComment || false,
        disable_duet: options.disableDuet || false,
        disable_stitch: options.disableStitch || false,
      },
    };

    // Make the post creation request
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[TikTok] Post creation failed:", errorText);
      throw new Error(`TikTok API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // Check for errors in the response body
    if (data.error) {
      console.error("[TikTok] Post creation error:", data.error);
      throw new Error(
        `TikTok API error: ${data.error.code} - ${data.error.message}`
      );
    }

    console.log("[TikTok] Post creation successful:", data);

    return data;
  } catch (error) {
    console.error("[TikTok] Post creation exception:", error);
    throw error;
  }
}
