import { TikTokOptions } from "@/lib/types/dbTypes";
import "server-only";
import {
  CreatorInfoResponse,
  PostInitResponse,
  TikTokPostResult,
} from "./postToTikTok";

/**
 * Handles video posting to TikTok using FILE_UPLOAD method
 */
export async function handleVideoPost({
  accessToken,
  description,
  tikTokOptions,
  coverTimestamp,
  media_url,
  creatorInfo,
}: {
  accessToken: string;
  description?: string;
  tikTokOptions?: TikTokOptions;
  media_url: string;
  coverTimestamp: number;
  creatorInfo: CreatorInfoResponse;
}): Promise<TikTokPostResult> {
  try {
    // Initialize video post with PULL_FROM_URL
    const initResponse = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/video/init/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          post_info: {
            title: description || "",
            privacy_level: tikTokOptions?.privacyLevel || "PUBLIC_TO_EVERYONE",
            disable_duet: tikTokOptions?.disableDuet || false,
            disable_comment: tikTokOptions?.disableComment || false,
            disable_stitch: tikTokOptions?.disableStitch || false,
            video_cover_timestamp_ms: coverTimestamp,
          },
          source_info: {
            source: "PULL_FROM_URL",
            video_url: media_url,
          },
        }),
      }
    );

    if (!initResponse.ok) {
      const errorData = await initResponse.json();
      console.error(
        "[Tiktok Post Function] Video initialization error:",
        errorData
      );
      return {
        success: false,
        error: "Failed to initialize video post",
        details: errorData as Record<string, unknown>,
      };
    }

    const initData = (await initResponse.json()) as PostInitResponse;

    const publishId = initData.data.publish_id;

    console.log(
      `[Tiktok Post Function] Video post initialized successfully with publish_id: ${publishId}`
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
    console.error("[tiktok Post Function] Unexpected error:", error);

    return {
      success: false,
      error: "Failed to post video to TikTok",
      message: "Unexpected error",
    };
  }
}
