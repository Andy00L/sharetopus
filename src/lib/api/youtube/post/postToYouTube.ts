import "server-only";

import { z } from "zod";

import {
  PLATFORM_API_TIMEOUT_MS,
  YOUTUBE_MEDIA_UPLOAD_TIMEOUT_MS,
} from "@/lib/api/_shared/platformFetchTimeouts";
import {
  buildHttpFailure,
  buildInputFailure,
  buildNetworkFailure,
  buildUnreadableAnswerFailure,
  type PlatformPostFailure,
} from "@/lib/api/_shared/platformFailure";
import { viewBufferAsFetchBody } from "@/lib/api/_shared/viewBufferAsFetchBody";
import { parseJsonObject } from "@/lib/platforms/providers/_shared/providerFetch";

/** YouTube video titles are capped at 100 characters. sourceRef: videos.insert snippet.title docs. */
export const YOUTUBE_TITLE_MAX_CHARS = 100;

/**
 * Uploaded video resource (only the fields this module reads).
 * sourceRef: https://developers.google.com/youtube/v3/docs/videos/insert
 */
const YouTubeVideoSchema = z.object({
  id: z.string().min(1),
});

export type YouTubePostResult =
  | { success: true; postId: string; postUrl: string; message: string }
  | PlatformPostFailure;

/**
 * Upload one video to YouTube via the resumable upload protocol:
 *   1. POST /upload/youtube/v3/videos?uploadType=resumable with the metadata
 *      JSON; the session URL comes back in the Location header.
 *   2. PUT the video bytes to that session URL.
 *
 * sourceRef: https://developers.google.com/youtube/v3/docs/videos/insert
 * (resumable protocol: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol)
 *
 * Called by: directPostForYouTubeAccounts
 */
export async function postToYouTube({
  accessToken,
  title,
  description,
  buffer,
  mediaType,
  privacyStatus,
}: {
  accessToken: string;
  title: string;
  description: string;
  buffer: Buffer;
  mediaType: string;
  privacyStatus: "public" | "unlisted" | "private";
}): Promise<YouTubePostResult> {
  if (!accessToken) {
    console.error("[postToYouTube] Missing access token");
    return buildInputFailure("Missing access token");
  }
  if (!buffer || buffer.length === 0) {
    console.error("[postToYouTube] Missing video bytes");
    return buildInputFailure("Missing video file for YouTube upload");
  }

  const boundedTitle = title.slice(0, YOUTUBE_TITLE_MAX_CHARS);

  let sessionUrl: string;
  try {
    const initResponse = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos" +
        "?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mediaType,
          "X-Upload-Content-Length": String(buffer.length),
        },
        body: JSON.stringify({
          snippet: {
            title: boundedTitle,
            description,
          },
          status: {
            privacyStatus,
            selfDeclaredMadeForKids: false,
          },
        }),
        signal: AbortSignal.timeout(PLATFORM_API_TIMEOUT_MS),
      },
    );

    if (!initResponse.ok) {
      const errorText = await initResponse.text();
      console.error(
        `[postToYouTube] Resumable session init failed (${initResponse.status}): ${errorText}`,
      );
      return buildHttpFailure({
        platform: "youtube",
        action: "YouTube upload initiation",
        httpStatus: initResponse.status,
        responseText: errorText,
        isPublishRequest: false,
      });
    }

    const locationHeader = initResponse.headers.get("location");
    if (!locationHeader) {
      console.error(
        "[postToYouTube] Resumable session init returned no Location header",
      );
      return buildUnreadableAnswerFailure({
        action: "YouTube upload initiation",
        isPublishRequest: false,
      });
    }
    sessionUrl = locationHeader;
  } catch (requestError) {
    console.error(
      "[postToYouTube] Resumable session init error:",
      requestError instanceof Error ? requestError.message : requestError,
    );
    return buildNetworkFailure({
      action: "YouTube upload initiation",
      requestError,
      isPublishRequest: false,
    });
  }

  try {
    const uploadResponse = await fetch(sessionUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": mediaType,
        "Content-Length": String(buffer.length),
      },
      body: viewBufferAsFetchBody(buffer),
      signal: AbortSignal.timeout(YOUTUBE_MEDIA_UPLOAD_TIMEOUT_MS),
    });

    const responseText = await uploadResponse.text();

    if (!uploadResponse.ok) {
      console.error(
        `[postToYouTube] Byte upload failed (${uploadResponse.status}): ${responseText}`,
      );
      return buildHttpFailure({
        platform: "youtube",
        action: "YouTube video upload",
        httpStatus: uploadResponse.status,
        responseText,
        isPublishRequest: true,
      });
    }

    const parsed = YouTubeVideoSchema.safeParse(parseJsonObject(responseText));
    if (!parsed.success) {
      console.error(
        "[postToYouTube] Upload response failed validation (missing video id).",
      );
      return buildUnreadableAnswerFailure({
        action: "YouTube video upload",
        isPublishRequest: true,
      });
    }

    const videoId = parsed.data.id;
    console.log(`[postToYouTube] Uploaded video ${videoId}`);

    return {
      success: true,
      postId: videoId,
      postUrl: `https://www.youtube.com/watch?v=${videoId}`,
      message: "Successfully uploaded video to YouTube",
    };
  } catch (requestError) {
    console.error(
      "[postToYouTube] Byte upload error:",
      requestError instanceof Error ? requestError.message : requestError,
    );
    return buildNetworkFailure({
      action: "YouTube video upload",
      requestError,
      isPublishRequest: true,
    });
  }
}
