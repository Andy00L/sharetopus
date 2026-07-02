import "server-only";

import { z } from "zod";

/** Resumable-session initiation is a small JSON call; 15s is generous. */
const INIT_TIMEOUT_MS = 15_000;
/** The byte upload moves the whole video in one PUT; 4 minutes covers 250 MB on a slow link. */
const UPLOAD_TIMEOUT_MS = 240_000;
/** YouTube video titles are capped at 100 characters. sourceRef: videos.insert snippet.title docs. */
const YOUTUBE_TITLE_MAX_CHARS = 100;

/**
 * Uploaded video resource (only the fields this module reads).
 * sourceRef: https://developers.google.com/youtube/v3/docs/videos/insert
 */
const YouTubeVideoSchema = z.object({
  id: z.string().min(1),
});

export interface YouTubePostResult {
  success: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
  details?: Record<string, unknown>;
  message?: string;
}

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
    return { success: false, error: "Missing access token" };
  }
  if (!buffer || buffer.length === 0) {
    console.error("[postToYouTube] Missing video bytes");
    return { success: false, error: "Missing video file for YouTube upload" };
  }

  const boundedTitle = title.slice(0, YOUTUBE_TITLE_MAX_CHARS);

  // Step 1: open the resumable upload session with the video metadata.
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
        signal: AbortSignal.timeout(INIT_TIMEOUT_MS),
      },
    );

    if (!initResponse.ok) {
      const errorText = await initResponse.text();
      console.error(
        `[postToYouTube] Resumable session init failed (${initResponse.status}): ${errorText}`,
      );
      return {
        success: false,
        error: `YouTube upload initiation failed (${initResponse.status})`,
        details: parseErrorDetails(errorText),
      };
    }

    const locationHeader = initResponse.headers.get("location");
    if (!locationHeader) {
      console.error(
        "[postToYouTube] Resumable session init returned no Location header",
      );
      return {
        success: false,
        error: "YouTube did not return an upload session URL",
      };
    }
    sessionUrl = locationHeader;
  } catch (error) {
    console.error(
      "[postToYouTube] Resumable session init error:",
      error instanceof Error ? error.message : error,
    );
    return { success: false, error: "YouTube upload initiation request failed" };
  }

  // Step 2: upload the video bytes in a single PUT.
  try {
    // Copy into a plain Uint8Array: Buffer's ArrayBufferLike backing is not
    // assignable to fetch's BodyInit without a type suppression.
    const uploadResponse = await fetch(sessionUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": mediaType,
        "Content-Length": String(buffer.length),
      },
      body: new Uint8Array(buffer),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });

    const responseText = await uploadResponse.text();

    if (!uploadResponse.ok) {
      console.error(
        `[postToYouTube] Byte upload failed (${uploadResponse.status}): ${responseText}`,
      );
      return {
        success: false,
        error: `YouTube video upload failed (${uploadResponse.status})`,
        details: parseErrorDetails(responseText),
      };
    }

    const parsed = YouTubeVideoSchema.safeParse(JSON.parse(responseText));
    if (!parsed.success) {
      console.error(
        "[postToYouTube] Upload response failed validation (missing video id).",
      );
      return {
        success: false,
        error: "YouTube upload response had an unexpected shape",
      };
    }

    const videoId = parsed.data.id;
    console.log(`[postToYouTube] Uploaded video ${videoId}`);

    return {
      success: true,
      postId: videoId,
      postUrl: `https://www.youtube.com/watch?v=${videoId}`,
      message: "Successfully uploaded video to YouTube",
    };
  } catch (error) {
    console.error(
      "[postToYouTube] Byte upload error:",
      error instanceof Error ? error.message : error,
    );
    return { success: false, error: "YouTube video upload request failed" };
  }
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
