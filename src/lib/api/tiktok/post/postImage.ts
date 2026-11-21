import { TikTokOptions } from "@/lib/types/dbTypes";
import {
  buildHttpFailure,
  buildNetworkFailure,
  buildUnreadableAnswerFailure,
} from "@/lib/api/_shared/platformFailure";
import { PLATFORM_PUBLISH_TIMEOUT_MS } from "@/lib/api/_shared/platformFetchTimeouts";
import { parseJsonObject } from "@/lib/platforms/providers/_shared/providerFetch";
import "server-only";
import { z } from "zod";
import type { TikTokPostResult } from "./postToTikTok";
import { resolveTikTokPrivacyLevel } from "./tikTokPrivacy";

/**
 * Direct Post init answer (photo and video): the publish_id the status
 * poll tracks. Also read by handleVideoPost.
 * sourceRef: developers.tiktok.com/doc/content-posting-api-reference-direct-post
 */
export const TikTokPostInitSchema = z.object({
  data: z.object({ publish_id: z.string() }),
});

/** Starts a TikTok photo Direct Post that TikTok pulls from media_url. */
export async function handleImagePost({
  accessToken,
  title,
  description,
  tikTokOptions,
  media_url,
  creatorUsername,
  autoAddMusic,
}: {
  accessToken: string;
  title?: string;
  description?: string;
  tikTokOptions?: TikTokOptions;
  media_url: string;
  creatorUsername: string;
  autoAddMusic: boolean;
}): Promise<TikTokPostResult> {
  try {
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
            privacy_level: resolveTikTokPrivacyLevel(tikTokOptions),
            disable_comment: tikTokOptions?.disableComment || false,
            auto_add_music: autoAddMusic,
            brand_content_toggle: tikTokOptions?.brandedContent === true,
            brand_organic_toggle: tikTokOptions?.yourBrand === true,
          },
          source_info: {
            source: "PULL_FROM_URL",
            photo_images: [media_url],
            photo_cover_index: 0,
          },
          post_mode: "DIRECT_POST",
          media_type: "PHOTO",
        }),
        signal: AbortSignal.timeout(PLATFORM_PUBLISH_TIMEOUT_MS),
      }
    );
    const initText = await initResponse.text();

    if (!initResponse.ok) {
      console.error(
        `[handleImagePost] Image initialization failed (${initResponse.status}): ${initText}`
      );
      return buildHttpFailure({
        platform: "tiktok",
        action: "TikTok image post initialization",
        httpStatus: initResponse.status,
        responseText: initText,
        isPublishRequest: true,
      });
    }

    const initData = TikTokPostInitSchema.safeParse(parseJsonObject(initText));
    if (!initData.success) {
      console.error("[handleImagePost] Image initialization returned no publish_id");
      return buildUnreadableAnswerFailure({
        action: "TikTok image post initialization",
        isPublishRequest: true,
      });
    }
    const publishId = initData.data.data.publish_id;
    console.log(
      `[handleImagePost] Image post initialized successfully with publish_id: ${publishId}`
    );

    return {
      success: true,
      publishId,
      postUrl: `https://www.tiktok.com/@${creatorUsername}`,
      data: { status: "PUBLISH_COMPLETE" },
      message: "Image submitted to TikTok for processing",
      status: "posted",
      content_id: publishId,
      creator_username: creatorUsername,
    };
  } catch (requestError) {
    const failure = buildNetworkFailure({
      action: "TikTok image post initialization",
      requestError,
      isPublishRequest: true,
    });
    console.error("[handleImagePost]", failure.error);
    return failure;
  }
}
