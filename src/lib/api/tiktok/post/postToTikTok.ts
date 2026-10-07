// lib/api/tiktok/post/postToTikTok.ts
import type { MediaType } from "@/db/schema";
import { TikTokOptions } from "@/lib/types/dbTypes";
import { toJsonObject } from "@/lib/utils/jsonObject";
import fetch from "node-fetch";
import "server-only";
import { z } from "zod";
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
  creator_username?: string;
}

/**
 * creator_info answer; only the username is read here (for the profile URL).
 * sourceRef: developers.tiktok.com/doc/content-posting-api-reference-query-creator-info
 */
const CreatorInfoResponseSchema = z.object({
  data: z.object({ creator_username: z.string() }),
});

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
  postType: MediaType;
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
      },
    );

    if (!creatorInfoResponse.ok) {
      const errorData = await creatorInfoResponse.json();
      console.error(
        "[Tiktok Post Function] Media registration error:",
        errorData,
      );

      return {
        success: false,
        error: "Failed to query creator info",
        details: toJsonObject(errorData) ?? undefined,
      };
    }

    const creatorInfo = CreatorInfoResponseSchema.safeParse(
      await creatorInfoResponse.json(),
    );
    if (!creatorInfo.success) {
      console.error(
        "[Tiktok Post Function] Creator info response had no creator_username",
      );
      return { success: false, error: "Failed to query creator info" };
    }
    const creatorUsername = creatorInfo.data.data.creator_username;

    // Call the appropriate handler based on media type
    if (postType === "image") {
      return await handleImagePost({
        accessToken,
        title,
        description,
        tikTokOptions,
        creatorUsername,
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
        creatorUsername,
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
