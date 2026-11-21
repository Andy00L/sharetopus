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
  PINTEREST_VIDEO_UPLOAD_AND_PROCESSING_TIMEOUT_MS,
  PLATFORM_API_TIMEOUT_MS,
} from "@/lib/api/_shared/platformFetchTimeouts";
import { describeNetworkError } from "@/lib/net/describeNetworkError";
import { parseJsonObject } from "@/lib/platforms/providers/_shared/providerFetch";
import { MEDIA_BUCKET } from "@/lib/storage/mediaBucket";
import { createPin } from "./postImage";
import type { PinterestPostResult } from "./postToPinterest";

const SIGNED_URL_EXPIRY_SECONDS = 600;
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

  const mediaDeadlineMs = Date.now() + PINTEREST_VIDEO_UPLOAD_AND_PROCESSING_TIMEOUT_MS;
  const upload = await uploadVideoFileStreaming({
    registration: registration.registration,
    mediaPath,
    mediaType,
    fileName,
    deadlineMs: mediaDeadlineMs,
  });
  if (!upload.success) return upload;

  const processing = await waitForVideoProcessing({
    accessToken,
    mediaId: registration.registration.media_id,
    deadlineMs: mediaDeadlineMs,
  });
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

// The upload URL is an S3 POST endpoint whose policy requires Content-Length,
// so the file size comes from the storage answer's header:
// https://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectPOST.html
async function uploadVideoFileStreaming({
  registration,
  mediaPath,
  mediaType,
  fileName,
  deadlineMs,
}: {
  registration: MediaRegistration;
  mediaPath: string;
  mediaType: string;
  fileName: string;
  deadlineMs: number;
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

  const streamDeadline = AbortSignal.timeout(Math.max(0, deadlineMs - Date.now()));

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

  // The Fetch standard's Request constructor throws a TypeError for a stream
  // body without init.duplex, and TypeScript 5.9's lib.dom.d.ts RequestInit
  // does not declare duplex: https://fetch.spec.whatwg.org/#dom-request
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

async function waitForVideoProcessing({
  accessToken,
  mediaId,
  deadlineMs,
}: {
  accessToken: string;
  mediaId: string;
  deadlineMs: number;
}): Promise<StepOutcome> {
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
    `[waitForVideoProcessing] Media ${mediaId} still ${lastStatus} at the ${PINTEREST_VIDEO_UPLOAD_AND_PROCESSING_TIMEOUT_MS / 1000} s upload and processing deadline`,
  );
  return {
    success: false,
    error:
      "Pinterest video processing timeout: your video is taking longer than expected to process. Please try again or use a smaller video file.",
    failure: { reason: "transient", mayHavePublished: false },
  };
}
