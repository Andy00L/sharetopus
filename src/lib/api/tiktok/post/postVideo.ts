import { TikTokOptions } from "@/lib/types/dbTypes";
import "server-only";
import {
  CreatorInfoResponse,
  PostInitResponse,
  TikTokPostResult,
} from "./postToTikTok";

const TIKTOK_MIN_COVER_TIMESTAMP_MS = 1000;

/**
 * Resolves the cover timestamp value sent to TikTok's video init endpoint.
 * TikTok requires a positive integer in milliseconds. We clamp the value
 * to >= 1000ms (1 second) and floor to an integer to defend against
 * upstream regressions (UI races, null DB fallbacks, float arithmetic).
 *
 * If the input is non-finite (NaN, Infinity, undefined coerced to NaN),
 * returns the minimum value as a safe default.
 */
function resolveTikTokVideoCoverTimestampMs(
  input: number | null | undefined
): number {
  if (input === null || input === undefined || !Number.isFinite(input)) {
    return TIKTOK_MIN_COVER_TIMESTAMP_MS;
  }
  return Math.max(Math.floor(input), TIKTOK_MIN_COVER_TIMESTAMP_MS);
}

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
    const resolvedCoverTs = resolveTikTokVideoCoverTimestampMs(coverTimestamp);
    console.log("[handleVideoPost] Resolved video_cover_timestamp_ms:", {
      input: coverTimestamp,
      resolved: resolvedCoverTs,
    });

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
            video_cover_timestamp_ms: resolvedCoverTs,
            brand_content_toggle: tikTokOptions?.brandedContent === true,
            brand_organic_toggle: tikTokOptions?.yourBrand === true,
            is_aigc: tikTokOptions?.isAigc === true,
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
      data: { status: "PUBLISH_COMPLETE" },
      message: "Video submitted to TikTok for processing",
      status: "posted",
      content_id: publishId,
      creator_username: creatorInfo.data.creator_username,
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
