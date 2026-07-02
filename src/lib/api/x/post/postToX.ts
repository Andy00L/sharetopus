import "server-only";

import { z } from "zod";

/** Small JSON calls (initialize, finalize, tweet create) are bounded to 15s. */
const API_TIMEOUT_MS = 15_000;
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

export interface XPostResult {
  success: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
  details?: Record<string, unknown>;
  message?: string;
}

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
    return { success: false, error: "Missing access token" };
  }
  if (postType === "text" && text.trim().length === 0) {
    console.error("[postToX] Text post with empty text");
    return { success: false, error: "Tweet text is required for text posts" };
  }

  let mediaId: string | null = null;

  if (postType !== "text") {
    if (!buffer || buffer.length === 0 || !mediaType) {
      console.error("[postToX] Media post without buffer or media type");
      return {
        success: false,
        error: "Media file is required for image and video tweets",
      };
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

  // Create the tweet.
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
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(
        `[postToX] Tweet create failed (${response.status}): ${responseText}`,
      );
      return {
        success: false,
        error: `X tweet creation failed (${response.status})`,
        details: parseErrorDetails(responseText),
      };
    }

    const parsed = XTweetSchema.safeParse(JSON.parse(responseText));
    if (!parsed.success) {
      console.error("[postToX] Tweet response failed validation.");
      return {
        success: false,
        error: "X tweet response had an unexpected shape",
      };
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
  } catch (error) {
    console.error(
      "[postToX] Tweet create error:",
      error instanceof Error ? error.message : error,
    );
    return { success: false, error: "X tweet creation request failed" };
  }
}

// ---------------------------------------------------------------------------
// Chunked media upload
// ---------------------------------------------------------------------------

type MediaUploadOutcome =
  | { success: true; mediaId: string }
  | (XPostResult & { success: false });

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

  // 1. initialize
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
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      },
    );

    const initText = await initResponse.text();
    if (!initResponse.ok) {
      console.error(
        `[postToX] Media initialize failed (${initResponse.status}): ${initText}`,
      );
      return {
        success: false,
        error: `X media upload initialization failed (${initResponse.status})`,
        details: parseErrorDetails(initText),
      };
    }

    const parsed = XMediaSchema.safeParse(JSON.parse(initText));
    if (!parsed.success) {
      console.error("[postToX] Media initialize response failed validation.");
      return {
        success: false,
        error: "X media initialize response had an unexpected shape",
      };
    }
    mediaId = parsed.data.data.id;
  } catch (error) {
    console.error(
      "[postToX] Media initialize error:",
      error instanceof Error ? error.message : error,
    );
    return { success: false, error: "X media initialize request failed" };
  }

  // 2. append, 4 MB segments
  const segmentCount = Math.ceil(buffer.length / UPLOAD_CHUNK_BYTES);
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
    const chunkStart = segmentIndex * UPLOAD_CHUNK_BYTES;
    const chunk = buffer.subarray(chunkStart, chunkStart + UPLOAD_CHUNK_BYTES);

    try {
      const formData = new FormData();
      formData.append("segment_index", String(segmentIndex));
      formData.append("media", new Blob([new Uint8Array(chunk)]));

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
        return {
          success: false,
          error: `X media upload failed at segment ${segmentIndex} (${appendResponse.status})`,
          details: parseErrorDetails(appendText),
        };
      }
    } catch (error) {
      console.error(
        `[postToX] Media append segment ${segmentIndex} error:`,
        error instanceof Error ? error.message : error,
      );
      return { success: false, error: "X media append request failed" };
    }
  }

  // 3. finalize
  let processingState: "pending" | "in_progress" | "succeeded" | "failed" =
    "succeeded";
  let waitSeconds = DEFAULT_POLL_WAIT_SECONDS;
  try {
    const finalizeResponse = await fetch(
      `https://api.x.com/2/media/upload/${mediaId}/finalize`,
      {
        method: "POST",
        headers: authHeader,
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      },
    );

    const finalizeText = await finalizeResponse.text();
    if (!finalizeResponse.ok) {
      console.error(
        `[postToX] Media finalize failed (${finalizeResponse.status}): ${finalizeText}`,
      );
      return {
        success: false,
        error: `X media finalize failed (${finalizeResponse.status})`,
        details: parseErrorDetails(finalizeText),
      };
    }

    const parsed = XMediaSchema.safeParse(JSON.parse(finalizeText));
    if (parsed.success && parsed.data.data.processing_info) {
      processingState = parsed.data.data.processing_info.state;
      waitSeconds =
        parsed.data.data.processing_info.check_after_secs ??
        DEFAULT_POLL_WAIT_SECONDS;
    }
  } catch (error) {
    console.error(
      "[postToX] Media finalize error:",
      error instanceof Error ? error.message : error,
    );
    return { success: false, error: "X media finalize request failed" };
  }

  // 4. STATUS polling while X transcodes video. Images finish synchronously.
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
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        },
      );

      const statusText = await statusResponse.text();
      if (!statusResponse.ok) {
        console.error(
          `[postToX] Media status poll failed (${statusResponse.status}): ${statusText}`,
        );
        return {
          success: false,
          error: `X media status check failed (${statusResponse.status})`,
          details: parseErrorDetails(statusText),
        };
      }

      const parsed = XMediaSchema.safeParse(JSON.parse(statusText));
      if (!parsed.success) {
        console.error("[postToX] Media status response failed validation.");
        return {
          success: false,
          error: "X media status response had an unexpected shape",
        };
      }

      processingState = parsed.data.data.processing_info?.state ?? "succeeded";
      waitSeconds =
        parsed.data.data.processing_info?.check_after_secs ??
        DEFAULT_POLL_WAIT_SECONDS;
    } catch (error) {
      console.error(
        "[postToX] Media status poll error:",
        error instanceof Error ? error.message : error,
      );
      return { success: false, error: "X media status request failed" };
    }
  }

  if (processingState === "failed") {
    return { success: false, error: "X rejected the media during processing" };
  }
  if (processingState !== "succeeded") {
    return {
      success: false,
      error: `X media processing did not finish after ${MAX_PROCESSING_POLLS} status checks`,
    };
  }

  return { success: true, mediaId };
}

function sleepSeconds(seconds: number): Promise<void> {
  return new Promise((resolveSleep) =>
    setTimeout(resolveSleep, seconds * 1000),
  );
}

/** Best-effort JSON parse of a provider error body for the details field. */
function parseErrorDetails(errorText: string): Record<string, unknown> {
  try {
    const parsedBody = JSON.parse(errorText) as unknown;
    if (parsedBody !== null && typeof parsedBody === "object") {
      return parsedBody as Record<string, unknown>;
    }
    return { rawError: errorText };
  } catch {
    return { rawError: errorText };
  }
}
