import "server-only";

import { z } from "zod";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { buildStreamingMultipartFormDataBody } from "@/lib/api/_shared/buildStreamingMultipartFormDataBody";
import {
  buildHttpFailure,
  buildNetworkFailure,
  buildUnreadableAnswerFailure,
  type PlatformPostFailure,
} from "@/lib/api/_shared/platformFailure";
import {
  PLATFORM_API_TIMEOUT_MS,
  PLATFORM_MEDIA_UPLOAD_TIMEOUT_MS,
} from "@/lib/api/_shared/platformFetchTimeouts";
import { describeNetworkError } from "@/lib/net/describeNetworkError";
import { parseJsonObject } from "@/lib/platforms/providers/_shared/providerFetch";
import { MEDIA_BUCKET } from "@/lib/storage/mediaBucket";
import { createPin } from "./postImage";
import type { PinterestPostResult } from "./postToPinterest";

const SIGNED_URL_EXPIRY_SECONDS = 600;
const PROCESSING_DEADLINE_MS = 200_000;
const PROCESSING_POLL_INITIAL_INTERVAL_MS = 2_000;
const PROCESSING_POLL_MAX_INTERVAL_MS = 8_000;

/**
 * POST /v5/media answer: where and how to upload the video bytes.
 * sourceRef: https://developers.pinterest.com/docs/api/v5/media-create
 */
const MediaRegistrationSchema = z.object({
  media_id: z.string().min(1),
  upload_url: z.string().min(1),
  upload_parameters: z.record(z.string(), z.string()),
});

/**
 * GET /v5/media/{id} answer. status is registered, processing, succeeded or failed.
 * sourceRef: https://developers.pinterest.com/docs/api/v5/media-get
 */
const MediaStatusSchema = z.object({ status: z.string() });

type MediaRegistration = z.infer<typeof MediaRegistrationSchema>;

type StepOutcome = { success: true } | PlatformPostFailure;

function buildStorageFailure(error: string): PlatformPostFailure {
  return {
    success: false,
    error,
    failure: { reason: "transient", mayHavePublished: false },
  };
}

/**
 * Creates a video pin: register a media upload, stream the file from
 * storage to Pinterest's upload URL, wait for processing, create the pin.
 * The upload streams chunk by chunk, so memory holds one chunk, not the file.
 */
export async function createVideoPin({
  accessToken,
  boardId,
  title,
  description,
  link,
  mediaPath,
  mediaType,
  fileName,
  coverTimestamp,
}: {
  accessToken: string;
  boardId: string;
  title: string;
  description: string;
  link: string;
  mediaPath: string;
  mediaType: string;
  fileName: string;
  coverTimestamp: number;
}): Promise<PinterestPostResult> {
  const registration = await registerMediaUpload(accessToken);
  if (!registration.success) return registration;

  const upload = await uploadVideoFileStreaming({
    registration: registration.registration,
    mediaPath,
    mediaType,
    fileName,
  });
  if (!upload.success) return upload;

  const processing = await waitForVideoProcessing(
    accessToken,
    registration.registration.media_id,
  );
  if (!processing.success) return processing;

  return createPin({
    accessToken,
    pinBody: {
      board_id: boardId,
      media_source: {
        media_id: registration.registration.media_id,
        source_type: "video_id",
        cover_image_key_frame_time: Math.floor(coverTimestamp / 1000),
      },
      title,
      description,
      link,
    },
    action: "Pinterest video pin creation",
    pinLabel: "video",
  });
}

async function registerMediaUpload(
  accessToken: string,
): Promise<{ success: true; registration: MediaRegistration } | PlatformPostFailure> {
  const action = "Pinterest video upload registration";
  try {
    const response = await fetch("https://api.pinterest.com/v5/media", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ media_type: "video" }),
      signal: AbortSignal.timeout(PLATFORM_API_TIMEOUT_MS),
    });
    const responseText = await response.text();

    if (!response.ok) {
      console.error(
        `[registerMediaUpload] Registration failed (${response.status}): ${responseText}`,
      );
      return buildHttpFailure({
        platform: "pinterest",
        action,
        httpStatus: response.status,
        responseText,
        isPublishRequest: false,
      });
    }

    const registration = MediaRegistrationSchema.safeParse(parseJsonObject(responseText));
    if (!registration.success) {
      console.error("[registerMediaUpload] Registration answer had an unexpected shape");
      return buildUnreadableAnswerFailure({ action, isPublishRequest: false });
    }
    return { success: true, registration: registration.data };
  } catch (requestError) {
    return buildNetworkFailure({ action, requestError, isPublishRequest: false });
  }
}

/**
 * Streams the stored file into Pinterest's upload URL as multipart/form-data.
 * The upload URL is an S3 POST endpoint whose policy requires Content-Length,
 * so the file size comes from the storage answer's header. One deadline
 * covers both the storage download and the upload, since they run as one stream.
 */
async function uploadVideoFileStreaming({
  registration,
  mediaPath,
  mediaType,
  fileName,
}: {
  registration: MediaRegistration;
  mediaPath: string;
  mediaType: string;
  fileName: string;
}): Promise<StepOutcome> {
  const { data: signedData, error: signedError } = await adminSupabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(mediaPath, SIGNED_URL_EXPIRY_SECONDS);
  if (signedError || !signedData?.signedUrl) {
    console.error(
      "[uploadVideoFileStreaming] Failed to mint signed URL:",
      signedError?.message ?? "no signed URL returned",
    );
    return buildStorageFailure("Failed to mint a storage URL for the video");
  }

  const streamDeadline = AbortSignal.timeout(PLATFORM_MEDIA_UPLOAD_TIMEOUT_MS);

  let storageResponse: Response;
  try {
    storageResponse = await fetch(signedData.signedUrl, { signal: streamDeadline });
  } catch (requestError) {
    const message = describeNetworkError(requestError);
    console.error("[uploadVideoFileStreaming] Storage download failed:", message);
    return buildStorageFailure(`Failed to fetch video from storage: ${message}`);
  }

  if (!storageResponse.ok || !storageResponse.body) {
    await storageResponse.body?.cancel();
    console.error(
      `[uploadVideoFileStreaming] Storage answered ${storageResponse.status} without a usable body`,
    );
    return buildStorageFailure(
      `Failed to fetch video from storage (status ${storageResponse.status})`,
    );
  }

  const fileByteLength = Number(storageResponse.headers.get("content-length"));
  if (!Number.isFinite(fileByteLength) || fileByteLength <= 0) {
    await storageResponse.body.cancel();
    console.error("[uploadVideoFileStreaming] Storage answer had no usable Content-Length");
    return buildStorageFailure("Storage did not return the video size");
  }

  console.log(`[uploadVideoFileStreaming] Streaming ${fileByteLength} bytes to Pinterest`);

  const { body: streamingBody, headers: streamingHeaders } =
    buildStreamingMultipartFormDataBody({
      fields: registration.upload_parameters,
      fileFieldName: "file",
      fileName,
      fileContentType: mediaType,
      fileByteLength,
      fileStream: storageResponse.body,
    });

  // Node's fetch requires duplex: "half" for a ReadableStream body, and
  // lib.dom's RequestInit does not declare it yet.
  // sourceRef: https://nodejs.org/api/globals.html#fetch
  const streamingUploadInit: RequestInit & { duplex: "half" } = {
    method: "POST",
    body: streamingBody,
    headers: streamingHeaders,
    duplex: "half",
    signal: streamDeadline,
  };

  const action = "Pinterest video upload";
  try {
    const uploadResponse = await fetch(registration.upload_url, streamingUploadInit);
    if (!uploadResponse.ok) {
      const uploadText = await uploadResponse.text();
      console.error(
        `[uploadVideoFileStreaming] Upload failed (${uploadResponse.status}): ${uploadText}`,
      );
      return buildHttpFailure({
        platform: "pinterest",
        action,
        httpStatus: uploadResponse.status,
        responseText: uploadText,
        isPublishRequest: false,
      });
    }
    await uploadResponse.body?.cancel();
  } catch (requestError) {
    return buildNetworkFailure({ action, requestError, isPublishRequest: false });
  }

  return { success: true };
}

async function readMediaStatus(
  accessToken: string,
  mediaId: string,
): Promise<{ success: true; status: string } | PlatformPostFailure> {
  const action = "Pinterest video status check";
  try {
    const response = await fetch(`https://api.pinterest.com/v5/media/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(PLATFORM_API_TIMEOUT_MS),
    });
    const responseText = await response.text();

    if (!response.ok) {
      console.error(
        `[readMediaStatus] Status check failed (${response.status}): ${responseText}`,
      );
      return buildHttpFailure({
        platform: "pinterest",
        action,
        httpStatus: response.status,
        responseText,
        isPublishRequest: false,
      });
    }

    const mediaStatus = MediaStatusSchema.safeParse(parseJsonObject(responseText));
    if (!mediaStatus.success) {
      console.error("[readMediaStatus] Status answer had no status");
      return buildUnreadableAnswerFailure({ action, isPublishRequest: false });
    }
    return { success: true, status: mediaStatus.data.status };
  } catch (requestError) {
    return buildNetworkFailure({ action, requestError, isPublishRequest: false });
  }
}

function waitFor(durationMs: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, durationMs));
}

/** Polls with a growing interval until Pinterest reports the video processed, failed, or the deadline passes. */
async function waitForVideoProcessing(
  accessToken: string,
  mediaId: string,
): Promise<StepOutcome> {
  const deadlineMs = Date.now() + PROCESSING_DEADLINE_MS;
  let pollIndex = 0;
  let lastStatus = "registered";

  for (;;) {
    const statusResult = await readMediaStatus(accessToken, mediaId);
    if (!statusResult.success) return statusResult;
    lastStatus = statusResult.status;

    if (lastStatus === "succeeded") return { success: true };
    if (lastStatus === "failed") {
      return {
        success: false,
        error: "Pinterest couldn't process your video. Try a different format.",
        failure: { reason: "invalid_input", mayHavePublished: false },
      };
    }

    const pollIntervalMs = Math.min(
      PROCESSING_POLL_MAX_INTERVAL_MS,
      PROCESSING_POLL_INITIAL_INTERVAL_MS * 2 ** pollIndex,
    );
    if (Date.now() + pollIntervalMs > deadlineMs) break;
    await waitFor(pollIntervalMs);
    pollIndex++;
  }

  console.error(
    `[waitForVideoProcessing] Media ${mediaId} still ${lastStatus} after ${PROCESSING_DEADLINE_MS / 1000} s`,
  );
  return {
    success: false,
    error:
      "Pinterest video processing timeout: your video is taking longer than expected to process. Please try again or use a smaller video file.",
    failure: { reason: "transient", mayHavePublished: false },
  };
}
