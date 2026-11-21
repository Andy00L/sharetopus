import "server-only";

import { z } from "zod";

import {
  PLATFORM_API_TIMEOUT_MS,
  PLATFORM_PUBLISH_TIMEOUT_MS,
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

/** One chunk APPEND moves at most 4 MB; 60s covers it on a slow link. */
const APPEND_TIMEOUT_MS = 60_000;
/** Chunk size in bytes. X accepts 1 MB to 4 MB per APPEND segment. sourceRef: docs.x.com chunked media upload quickstart. */
const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
/** Max STATUS polls while X processes a video before giving up. */
const MAX_PROCESSING_POLLS = 10;
/** Fallback wait between STATUS polls when X omits check_after_secs, in seconds. */
const DEFAULT_POLL_WAIT_SECONDS = 3;

/**
 * Media id envelope shared by initialize/finalize/status responses.
 * sourceRef: https://docs.x.com/x-api/media/quickstart/media-upload-chunked
 */
const XMediaSchema = z.object({
  data: z.object({
    id: z.string().min(1),
    processing_info: z
      .object({
        state: z.enum(["pending", "in_progress", "succeeded", "failed"]),
        check_after_secs: z.number().optional(),
      })
      .optional(),
  }),
});

/**
 * Tweet create response. sourceRef: https://docs.x.com POST /2/tweets
 */
const XTweetSchema = z.object({
  data: z.object({
    id: z.string().min(1),
    text: z.string().optional(),
  }),
});

export type XPostResult =
  | { success: true; postId: string; postUrl: string; message: string }
  | PlatformPostFailure;

/**
 * Publish one tweet, optionally with one image or video.
 *
 * Media uses the v2 chunked upload flow (the dedicated endpoints that
 * replaced command-style /2/media/upload in May 2025):
 *   1. POST /2/media/upload/initialize (JSON)
 *   2. POST /2/media/upload/{id}/append (multipart, 4 MB segments)
 *   3. POST /2/media/upload/{id}/finalize
 *   4. GET  /2/media/upload?command=STATUS while X processes video
 * then POST /2/tweets with media.media_ids.
 *
 * sourceRef: https://docs.x.com/x-api/media/quickstart/media-upload-chunked
 * Requires the media.write scope on the user token for media uploads.
 *
 * Called by: directPostForXAccounts
 */
export async function postToX({
  accessToken,
  text,
  buffer,
  mediaType,
  postType,
  username,
}: {
  accessToken: string;
  text: string;
  buffer?: Buffer;
  mediaType?: string;
  postType: "text" | "image" | "video";
  /** Handle used to build the public post URL; falls back to /i/status. */
  username?: string;
}): Promise<XPostResult> {
  if (!accessToken) {
    console.error("[postToX] Missing access token");
    return buildInputFailure("Missing access token");
  }
  if (postType === "text" && text.trim().length === 0) {
    console.error("[postToX] Text post with empty text");
    return buildInputFailure("Tweet text is required for text posts");
  }

  let mediaId: string | null = null;

  if (postType !== "text") {
    if (!buffer || buffer.length === 0 || !mediaType) {
      console.error("[postToX] Media post without buffer or media type");
      return buildInputFailure("Media file is required for image and video tweets");
    }

    const uploadResult = await uploadMediaChunked({
      accessToken,
      buffer,
      mediaType,
      mediaCategory: postType === "video" ? "tweet_video" : "tweet_image",
    });
    if (!uploadResult.success) {
      return uploadResult;
    }
    mediaId = uploadResult.mediaId;
  }

  try {
    const tweetBody: {
      text: string;
      media?: { media_ids: string[] };
    } = { text };
    if (mediaId) {
      tweetBody.media = { media_ids: [mediaId] };
    }

    const response = await fetch("https://api.x.com/2/tweets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(tweetBody),
      signal: AbortSignal.timeout(PLATFORM_PUBLISH_TIMEOUT_MS),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(
        `[postToX] Tweet create failed (${response.status}): ${responseText}`,
      );
      return buildHttpFailure({
        platform: "x",
        action: "X tweet creation",
        httpStatus: response.status,
        responseText,
        isPublishRequest: true,
      });
    }

    const parsed = XTweetSchema.safeParse(parseJsonObject(responseText));
    if (!parsed.success) {
      console.error("[postToX] Tweet response failed validation.");
      return buildUnreadableAnswerFailure({
        action: "X tweet creation",
        isPublishRequest: true,
      });
    }

    const tweetId = parsed.data.data.id;
    console.log(`[postToX] Created tweet ${tweetId}`);

    return {
      success: true,
      postId: tweetId,
      postUrl: username
        ? `https://x.com/${username}/status/${tweetId}`
        : `https://x.com/i/status/${tweetId}`,
      message: `Successfully created ${postType} post on X`,
    };
  } catch (requestError) {
    console.error(
      "[postToX] Tweet create error:",
      requestError instanceof Error ? requestError.message : requestError,
    );
    return buildNetworkFailure({
      action: "X tweet creation",
      requestError,
      isPublishRequest: true,
    });
  }
}

type MediaUploadOutcome =
  | { success: true; mediaId: string }
  | PlatformPostFailure;

async function uploadMediaChunked({
  accessToken,
  buffer,
  mediaType,
  mediaCategory,
}: {
  accessToken: string;
  buffer: Buffer;
  mediaType: string;
  mediaCategory: "tweet_image" | "tweet_video";
}): Promise<MediaUploadOutcome> {
  const authHeader = { Authorization: `Bearer ${accessToken}` };

  let mediaId: string;
  try {
    const initResponse = await fetch(
      "https://api.x.com/2/media/upload/initialize",
      {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          media_type: mediaType,
          total_bytes: buffer.length,
          media_category: mediaCategory,
        }),
        signal: AbortSignal.timeout(PLATFORM_API_TIMEOUT_MS),
      },
    );

    const initText = await initResponse.text();
    if (!initResponse.ok) {
      console.error(
        `[postToX] Media initialize failed (${initResponse.status}): ${initText}`,
      );
      return buildHttpFailure({
        platform: "x",
        action: "X media upload initialization",
        httpStatus: initResponse.status,
        responseText: initText,
        isPublishRequest: false,
      });
    }

    const parsed = XMediaSchema.safeParse(parseJsonObject(initText));
    if (!parsed.success) {
      console.error("[postToX] Media initialize response failed validation.");
      return buildUnreadableAnswerFailure({
        action: "X media upload initialization",
        isPublishRequest: false,
      });
    }
    mediaId = parsed.data.data.id;
  } catch (requestError) {
    console.error(
      "[postToX] Media initialize error:",
      requestError instanceof Error ? requestError.message : requestError,
    );
    return buildNetworkFailure({
      action: "X media upload initialization",
      requestError,
      isPublishRequest: false,
    });
  }

  const segmentCount = Math.ceil(buffer.length / UPLOAD_CHUNK_BYTES);
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
    const chunkStart = segmentIndex * UPLOAD_CHUNK_BYTES;
    const chunk = buffer.subarray(chunkStart, chunkStart + UPLOAD_CHUNK_BYTES);

    try {
      const formData = new FormData();
      formData.append("segment_index", String(segmentIndex));
      formData.append("media", new Blob([viewBufferAsFetchBody(chunk)]));

      const appendResponse = await fetch(
        `https://api.x.com/2/media/upload/${mediaId}/append`,
        {
          method: "POST",
          headers: authHeader,
          body: formData,
          signal: AbortSignal.timeout(APPEND_TIMEOUT_MS),
        },
      );

      if (!appendResponse.ok) {
        const appendText = await appendResponse.text();
        console.error(
          `[postToX] Media append segment ${segmentIndex} failed (${appendResponse.status}): ${appendText}`,
        );
        return buildHttpFailure({
          platform: "x",
          action: `X media upload segment ${segmentIndex}`,
          httpStatus: appendResponse.status,
          responseText: appendText,
          isPublishRequest: false,
        });
      }
    } catch (requestError) {
      console.error(
        `[postToX] Media append segment ${segmentIndex} error:`,
        requestError instanceof Error ? requestError.message : requestError,
      );
      return buildNetworkFailure({
        action: `X media upload segment ${segmentIndex}`,
        requestError,
        isPublishRequest: false,
      });
    }
  }

  let processingState: "pending" | "in_progress" | "succeeded" | "failed" =
    "succeeded";
  let waitSeconds = DEFAULT_POLL_WAIT_SECONDS;
  try {
    const finalizeResponse = await fetch(
      `https://api.x.com/2/media/upload/${mediaId}/finalize`,
      {
        method: "POST",
        headers: authHeader,
        signal: AbortSignal.timeout(PLATFORM_API_TIMEOUT_MS),
      },
    );

    const finalizeText = await finalizeResponse.text();
    if (!finalizeResponse.ok) {
      console.error(
        `[postToX] Media finalize failed (${finalizeResponse.status}): ${finalizeText}`,
      );
      return buildHttpFailure({
        platform: "x",
        action: "X media finalize",
        httpStatus: finalizeResponse.status,
        responseText: finalizeText,
        isPublishRequest: false,
      });
    }

    const parsed = XMediaSchema.safeParse(parseJsonObject(finalizeText));
    if (parsed.success && parsed.data.data.processing_info) {
      processingState = parsed.data.data.processing_info.state;
      waitSeconds =
        parsed.data.data.processing_info.check_after_secs ??
        DEFAULT_POLL_WAIT_SECONDS;
    }
  } catch (requestError) {
    console.error(
      "[postToX] Media finalize error:",
      requestError instanceof Error ? requestError.message : requestError,
    );
    return buildNetworkFailure({
      action: "X media finalize",
      requestError,
      isPublishRequest: false,
    });
  }

  let pollCount = 0;
  while (
    (processingState === "pending" || processingState === "in_progress") &&
    pollCount < MAX_PROCESSING_POLLS
  ) {
    await sleepSeconds(waitSeconds);
    pollCount++;

    try {
      const statusResponse = await fetch(
        `https://api.x.com/2/media/upload?command=STATUS&media_id=${mediaId}`,
        {
          method: "GET",
          headers: authHeader,
          signal: AbortSignal.timeout(PLATFORM_API_TIMEOUT_MS),
        },
      );

      const statusText = await statusResponse.text();
      if (!statusResponse.ok) {
        console.error(
          `[postToX] Media status poll failed (${statusResponse.status}): ${statusText}`,
        );
        return buildHttpFailure({
          platform: "x",
          action: "X media status check",
          httpStatus: statusResponse.status,
          responseText: statusText,
          isPublishRequest: false,
        });
      }

      const parsed = XMediaSchema.safeParse(parseJsonObject(statusText));
      if (!parsed.success) {
        console.error("[postToX] Media status response failed validation.");
        return buildUnreadableAnswerFailure({
          action: "X media status check",
          isPublishRequest: false,
        });
      }

      processingState = parsed.data.data.processing_info?.state ?? "succeeded";
      waitSeconds =
        parsed.data.data.processing_info?.check_after_secs ??
        DEFAULT_POLL_WAIT_SECONDS;
    } catch (requestError) {
      console.error(
        "[postToX] Media status poll error:",
        requestError instanceof Error ? requestError.message : requestError,
      );
      return buildNetworkFailure({
        action: "X media status check",
        requestError,
        isPublishRequest: false,
      });
    }
  }

  if (processingState === "failed") {
    return buildInputFailure("X rejected the media during processing");
  }
  if (processingState !== "succeeded") {
    return {
      success: false,
      error: `X media processing did not finish after ${MAX_PROCESSING_POLLS} status checks`,
      failure: { reason: "transient", mayHavePublished: false },
    };
  }

  return { success: true, mediaId };
}

function sleepSeconds(seconds: number): Promise<void> {
  return new Promise((resolveSleep) =>
    setTimeout(resolveSleep, seconds * 1000),
  );
}
