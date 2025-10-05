// lib/api/tiktok/post/postToTikTok.ts
import { PrivacyLevel, TikTokOptions } from "@/lib/types/dbTypes";
import fetch from "node-fetch";
import "server-only";
import { handleImagePost } from "./postImage";
import { handleVideoPost } from "./postVideo";

// Define return type for TikTok posts
export interface TikTokPostResult {
  success: boolean;
  publishId?: string;
  postId?: string;
  postUrl?: string;
  data?: Record<string, unknown>;
  error?: string;
  details?: Record<string, unknown>;
  message?: string;
  status?: string;
  content_id?: string;
}

// Interfaces for API responses
export interface CreatorInfoResponse {
  data: {
    creator_avatar_url: string;
    creator_username: string;
    creator_nickname: string;
    privacy_level_options: PrivacyLevel[];
    comment_disabled: boolean;
    duet_disabled: boolean;
    stitch_disabled: boolean;
    max_video_post_duration_sec: number;
  };
  error: {
    code: string;
    message: string;
    log_id: string;
  };
}

export interface PostInitResponse {
  data: {
    publish_id: string;
    upload_url?: string;
  };
  error: {
    code: string;
    message: string;
    log_id: string;
  };
}

/**
 * Posts content directly to TikTok using their Content Posting API
 * Main function that handles authentication and routes to specific handlers
 */
export async function postToTikTok({
  accessToken,
  title,
  description,
  tikTokOptions,
  postType,
  coverTimestamp,
  media_url,
  autoAddMusic = true,
}: {
  accessToken: string;
  title?: string;
  description?: string;
  tikTokOptions?: TikTokOptions;
  coverTimestamp: number;
  postType: "image" | "video" | "text";
  mediaType: string;
  media_url: string;
  autoAddMusic?: boolean;
}): Promise<TikTokPostResult> {
  try {
    // Verify required parameters
    if (!accessToken) {
      console.log("[Tiktok Post Function] Missing required parameters");

      return {
        success: false,
        error: "Missing required parameters (accessToken are required)",
      };
    }

    // STEP 1: Query Creator Info - needed for both image and video posts
    const creatorInfoResponse = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
      }
    );

    if (!creatorInfoResponse.ok) {
      const errorData = await creatorInfoResponse.json();
      console.error(
        "[Tiktok Post Function] Media registration error:",
        errorData
      );

      return {
        success: false,
        error: "Failed to query creator info",
        details: errorData as Record<string, unknown>,
      };
    }

    const creatorInfo =
      (await creatorInfoResponse.json()) as CreatorInfoResponse;

    // Call the appropriate handler based on media type
    if (postType === "image") {
      return await handleImagePost({
        accessToken,
        title,
        description,
        tikTokOptions,
        creatorInfo,
        autoAddMusic,
        media_url,
      });
    } else {
      // For videos, we'll use FILE_UPLOAD as specified
      return await handleVideoPost({
        accessToken,
        description,
        tikTokOptions,
        coverTimestamp,
        creatorInfo,
        media_url,
      });
    }
  } catch (error) {
    console.error("[Tiktok Post Function] Unexpected error:", error);

    return {
      success: false,
      error: "Failed to post to TikTok",
      message: "Unexpected error",
    };
  }
}
