import { TikTokOptions } from "@/lib/types/dbTypes";
import {
  buildHttpFailure,
  buildNetworkFailure,
  buildUnreadableAnswerFailure,
} from "@/lib/api/_shared/platformFailure";
import { PLATFORM_PUBLISH_TIMEOUT_MS } from "@/lib/api/_shared/platformFetchTimeouts";
import { parseJsonObject } from "@/lib/platforms/providers/_shared/providerFetch";
import "server-only";
import { TikTokPostInitSchema } from "./postImage";
import type { TikTokPostResult } from "./postToTikTok";
import { resolveTikTokPrivacyLevel } from "./tikTokPrivacy";

/** TikTok rejects a cover timestamp under 1 s. */
const TIKTOK_MIN_COVER_TIMESTAMP_MS = 1000;

/** Cover timestamp as a whole number of ms, at least 1 s; non-finite input gets the minimum. */
function resolveTikTokVideoCoverTimestampMs(
  input: number | null | undefined
): number {
  if (input === null || input === undefined || !Number.isFinite(input)) {
    return TIKTOK_MIN_COVER_TIMESTAMP_MS;
  }
  return Math.max(Math.floor(input), TIKTOK_MIN_COVER_TIMESTAMP_MS);
}

/** Starts a TikTok video Direct Post that TikTok pulls from media_url. */
export async function handleVideoPost({
  accessToken,
  description,
  tikTokOptions,
  coverTimestamp,
  media_url,
  creatorUsername,
}: {
  accessToken: string;
  description?: string;
  tikTokOptions?: TikTokOptions;
  media_url: string;
  coverTimestamp: number;
  creatorUsername: string;
}): Promise<TikTokPostResult> {
  try {
    const resolvedCoverTs = resolveTikTokVideoCoverTimestampMs(coverTimestamp);
    console.log("[handleVideoPost] Resolved video_cover_timestamp_ms:", {
      input: coverTimestamp,
      resolved: resolvedCoverTs,
    });

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
            privacy_level: resolveTikTokPrivacyLevel(tikTokOptions),
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
        signal: AbortSignal.timeout(PLATFORM_PUBLISH_TIMEOUT_MS),
      }
    );
    const initText = await initResponse.text();

    if (!initResponse.ok) {
      console.error(
        `[handleVideoPost] Video initialization failed (${initResponse.status}): ${initText}`
      );
      return buildHttpFailure({
        platform: "tiktok",
        action: "TikTok video post initialization",
        httpStatus: initResponse.status,
        responseText: initText,
        isPublishRequest: true,
      });
    }

    const initData = TikTokPostInitSchema.safeParse(parseJsonObject(initText));
    if (!initData.success) {
      console.error("[handleVideoPost] Video initialization returned no publish_id");
      return buildUnreadableAnswerFailure({
        action: "TikTok video post initialization",
        isPublishRequest: true,
      });
    }

    const publishId = initData.data.data.publish_id;

    console.log(
      `[handleVideoPost] Video post initialized successfully with publish_id: ${publishId}`
    );
    return {
      success: true,
      publishId,
      postUrl: `https://www.tiktok.com/@${creatorUsername}`,
      data: { status: "PUBLISH_COMPLETE" },
      message: "Video submitted to TikTok for processing",
      status: "posted",
      content_id: publishId,
      creator_username: creatorUsername,
    };
  } catch (requestError) {
    const failure = buildNetworkFailure({
      action: "TikTok video post initialization",
      requestError,
      isPublishRequest: true,
    });
    console.error("[handleVideoPost]", failure.error);
    return failure;
  }
}
