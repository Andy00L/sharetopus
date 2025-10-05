import { TikTokOptions } from "@/lib/types/dbTypes";
import "server-only";
import {
  CreatorInfoResponse,
  PostInitResponse,
  TikTokPostResult,
} from "./postToTikTok";

/**
 * Handles image posting to TikTok using PULL_FROM_URL method
 */
export async function handleImagePost({
  accessToken,
  title,
  description,
  tikTokOptions,
  media_url,
  creatorInfo,
  autoAddMusic,
}: {
  accessToken: string;
  title?: string;
  description?: string;
  tikTokOptions?: TikTokOptions;
  media_url: string;
  creatorInfo: CreatorInfoResponse;
  autoAddMusic: boolean;
}): Promise<TikTokPostResult> {
  try {
    // STEP 1: Initialize the image post
    const initResponse = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/content/init/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          post_info: {
            title: title || "",
            description: description || "",
            privacy_level: tikTokOptions?.privacyLevel || "PUBLIC_TO_EVERYONE",
            disable_comment: tikTokOptions?.disableComment || false,
            auto_add_music: autoAddMusic,
          },
          source_info: {
            source: "PULL_FROM_URL",
            photo_images: [media_url], // Array for multiple images
            photo_cover_index: 0,
          },
          post_mode: "DIRECT_POST",
          media_type: "PHOTO",
        }),
      }
    );

    if (!initResponse.ok) {
      const errorData = await initResponse.json();
      console.error(
        "[Tiktok Post Function] Image initialization error:",
        errorData
      );
      return {
        success: false,
        error: "Failed to initialize image post",
        details: errorData as Record<string, unknown>,
      };
    }

    const initData = (await initResponse.json()) as PostInitResponse;
    const publishId = initData.data.publish_id;
    console.log(
      `[Tiktok Post Function] Image post initialized successfully with publish_id: ${publishId}`
    );

    return {
      success: true,
      publishId,
      postUrl: `https://www.tiktok.com/@${creatorInfo.data.creator_username}`,
      data: { status: "PUBLISH_COMPLETE" }, // Simulate completed status
      message: `Video submitted to TikTok and marked as posted`,
      status: "posted",
      content_id: publishId,
    };
  } catch (error) {
    console.error("[Tiktok Post Function] Image post error:", error);
    return {
      success: false,
      error: "Failed to post image to TikTok",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
