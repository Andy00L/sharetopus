import { adminSupabase } from "@/actions/api/adminSupabase";
import { buildStreamingMultipartFormDataBody } from "@/lib/api/_shared/buildStreamingMultipartFormDataBody";
import "server-only";
import {
  PinterestMediaRegistrationResponse,
  PinterestMediaStatusResponse,
  PinterestPostResult,
} from "./postToPinterest";

type MediaUploadResult =
  | {
      success: true;
      media_id: string;
      upload_url: string;
      upload_parameters: Record<string, string>;
    }
  | {
      success: false;
      error: string;
      message?: string;
    };

/**
 * Create a video pin using the 4-step process:
 * 1. Register media upload with Pinterest
 * 2. Stream the video file from Supabase to Pinterest's S3
 * 3. Wait for Pinterest to process the video
 * 4. Create pin with the processed video
 *
 * Step 2 streams the file chunk-by-chunk via a ReadableStream so
 * memory peaks at the chunk size (~64KB), not the full file size.
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
  userId,
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
  userId: string;
  coverTimestamp: number;
}): Promise<PinterestPostResult> {
  try {
    // Step 1: Register media upload
    const registrationResult = await registerMediaUpload(accessToken);
    if (!registrationResult.success) {
      return registrationResult;
    }

    const { media_id, upload_url, upload_parameters } = registrationResult;

    // Step 2: Stream video file from Supabase to Pinterest's S3
    const uploadResult = await uploadVideoFileStreaming({
      uploadUrl: upload_url,
      uploadParameters: upload_parameters,
      mediaPath,
      userId,
      mediaType,
      fileName,
    });
    if (!uploadResult.success) {
      return uploadResult;
    }

    // Step 3: Wait for video processing
    const processingResult = await waitForVideoProcessing(
      accessToken,
      media_id,
    );
    if (!processingResult.success) {
      return processingResult;
    }

    // Step 4: Create pin with processed video
    return await createPinWithVideo({
      accessToken,
      boardId,
      title,
      description,
      link,
      mediaId: media_id,
      coverTimestamp,
    });
  } catch (error) {
    console.error("[Pinterest PostVideo] Unexpected error:", error);
    return {
      success: false,
      error: "Failed to create video pin",
      message: error instanceof Error ? error.message : "Unexpected error",
    };
  }
}

/**
 * Step 1: Register media upload with Pinterest
 */
async function registerMediaUpload(
  accessToken: string,
): Promise<MediaUploadResult> {
  try {
    const response = await fetch("https://api.pinterest.com/v5/media", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ media_type: "video" }),
    });

    const data = (await response.json()) as PinterestMediaRegistrationResponse;

    if (!response.ok) {
      console.error("[Pinterest PostVideo] Media registration failed:", data);
      return {
        success: false,
        error: "Failed to register media upload",
        message: `Registration failed with status: ${response.status}`,
      };
    }

    console.log("[Pinterest PostVideo] Media registered successfully");
    return {
      success: true,
      media_id: data.media_id,
      upload_url: data.upload_url,
      upload_parameters: data.upload_parameters,
    };
  } catch (error) {
    console.error("[Pinterest PostVideo] Media registration error:", error);
    return {
      success: false,
      error: "Failed to register media upload",
      message: error instanceof Error ? error.message : "Unexpected error",
    };
  }
}

/**
 * Step 2: Stream the video file from Supabase to Pinterest's S3.
 *
 * Mints a Supabase signed URL, fetches it for a ReadableStream,
 * reads Content-Length from the response headers, then builds a
 * streaming multipart/form-data body via buildStreamingMultipartFormDataBody.
 * Memory peaks at chunk size (~64KB), not file size.
 */
async function uploadVideoFileStreaming({
  uploadUrl,
  uploadParameters,
  mediaPath,
  userId,
  mediaType,
  fileName,
}: {
  uploadUrl: string;
  uploadParameters: Record<string, string>;
  mediaPath: string;
  userId: string;
  mediaType: string;
  fileName: string;
}): Promise<PinterestPostResult> {
  try {
    // Mint a Supabase signed URL (10-minute expiry for upload window)
    const { data: signedData, error: signedError } = await adminSupabase.storage
      .from("scheduled-videos")
      .createSignedUrl(mediaPath, 600);

    if (signedError || !signedData?.signedUrl) {
      console.error(
        "[Pinterest PostVideo] Failed to mint signed URL:",
        signedError,
      );
      return {
        success: false,
        error: "Failed to mint Supabase signed URL for video",
        message: signedError?.message ?? "No signed URL returned",
      };
    }

    // Fetch the signed URL for the file stream and Content-Length
    const supabaseResponse = await fetch(signedData.signedUrl);

    if (!supabaseResponse.ok) {
      console.error(
        `[Pinterest PostVideo] Supabase fetch returned ${supabaseResponse.status}`,
      );
      return {
        success: false,
        error: "Failed to fetch video from storage",
        message: `Storage returned status ${supabaseResponse.status}`,
      };
    }

    if (!supabaseResponse.body) {
      console.error("[Pinterest PostVideo] Supabase response has no body");
      return {
        success: false,
        error: "Storage returned empty body for video",
      };
    }

    const contentLengthHeader = supabaseResponse.headers.get("content-length");
    if (!contentLengthHeader) {
      console.error(
        "[Pinterest PostVideo] Missing Content-Length from storage",
      );
      return {
        success: false,
        error: "Storage did not return Content-Length for video",
        message:
          "Cannot stream without known file size (S3 requires Content-Length)",
      };
    }

    const fileByteLength = Number(contentLengthHeader);
    if (!Number.isFinite(fileByteLength) || fileByteLength <= 0) {
      console.error(
        "[Pinterest PostVideo] Invalid Content-Length:",
        contentLengthHeader,
      );
      return {
        success: false,
        error: "Storage returned invalid Content-Length for video",
      };
    }

    console.log(
      `[Pinterest PostVideo] Streaming ${fileByteLength} bytes to Pinterest S3`,
    );

    // Build the streaming multipart body
    const { body: streamingBody, headers: streamingHeaders } =
      buildStreamingMultipartFormDataBody({
        fields: uploadParameters,
        fileFieldName: "file",
        fileName,
        fileContentType: mediaType,
        fileByteLength,
        fileStream: supabaseResponse.body,
      });

    // POST to Pinterest's S3 upload endpoint
    const response = await fetch(uploadUrl, {
      method: "POST",
      body: streamingBody,
      headers: streamingHeaders,
      // @ts-expect-error duplex: "half" required by Node 18+ when body is a ReadableStream;
      // not yet in lib.dom.d.ts. See https://nodejs.org/api/globals.html#fetch.
      duplex: "half",
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Pinterest PostVideo] Video upload failed:", errorText);
      return {
        success: false,
        error: "Failed to upload media",
        message: `Upload failed with status: ${response.status}`,
      };
    }

    console.log("[Pinterest PostVideo] Video uploaded successfully (streamed)");
    return { success: true };
  } catch (error) {
    console.error("[Pinterest PostVideo] Video upload error:", error);
    return {
      success: false,
      error: "Failed to upload video",
      message: error instanceof Error ? error.message : "Unexpected error",
    };
  }
}

/**
 * Step 3: Wait for video processing to complete
 */
async function waitForVideoProcessing(
  accessToken: string,
  mediaId: string,
): Promise<PinterestPostResult> {
  const MAX_TIMEOUT = 200000; // 40 seconds
  const WAIT_TIME = 1000; // 1 second between checks
  const MAX_ATTEMPTS = Math.floor(MAX_TIMEOUT / WAIT_TIME);

  const startTime = Date.now();

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Check timeout
    if (Date.now() - startTime > MAX_TIMEOUT) {
      return {
        success: false,
        error: "Video processing timeout",
        message: "Pinterest is taking too long to process your video",
      };
    }

    // Check processing status
    const statusResult = await checkMediaStatus(accessToken, mediaId);
    if (!statusResult.success) {
      return statusResult;
    }

    const status = statusResult.message!;

    if (status === "succeeded") {
      console.log("[Pinterest] Video processing completed");
      return { success: true };
    }

    if (status === "failed") {
      return {
        success: false,
        error: "Video processing failed",
        message:
          "Pinterest couldn't process your video. Try a different format.",
      };
    }
    console.log(
      `[Pinterest PostVideo] Upload status: ${status} (attempt ${
        attempt + 1
      }/${MAX_ATTEMPTS})`,
    );

    // Wait before next check
    await new Promise((resolve) => setTimeout(resolve, WAIT_TIME));
  }

  return {
    success: false,
    error:
      "Your video is taking longer than expected to process. Please try again or use a smaller video file.",
    message:
      "Pinterest is taking too long to process your video. This may happen with very large files or during high traffic periods.",
  };
}

/**
 * Check media processing status
 */
async function checkMediaStatus(
  accessToken: string,
  mediaId: string,
): Promise<PinterestPostResult> {
  try {
    const response = await fetch(
      `https://api.pinterest.com/v5/media/${mediaId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    const data = (await response.json()) as PinterestMediaStatusResponse;

    if (!response.ok) {
      console.error("[Pinterest PostVideo] Status check failed:", data);
      return {
        success: false,
        error:
          "Unable to verify video upload status with Pinterest. Please try again in a few minutes.",
        message:
          "Pinterest's servers are temporarily unavailable. Please try again later.",
      };
    }
    // Return status in message field for easy access
    return {
      success: true,
      message: data.status,
    };
  } catch (error) {
    console.error("[Pinterest PostVideo] Status check error:", error);
    return {
      success: false,
      error:
        "Unable to verify video upload status with Pinterest. Please try again in a few minutes.",
      message: error instanceof Error ? error.message : "Unexpected error",
    };
  }
}

/**
 * Step 4: Create pin with processed video
 */
async function createPinWithVideo({
  accessToken,
  boardId,
  title,
  description,
  link,
  mediaId,
  coverTimestamp,
}: {
  accessToken: string;
  boardId: string;
  title: string;
  description: string;
  link: string;
  mediaId: string;
  coverTimestamp: number;
}): Promise<PinterestPostResult> {
  try {
    const requestBody = {
      board_id: boardId,
      media_source: {
        media_id: mediaId,
        source_type: "video_id",
        cover_image_key_frame_time: Math.floor(coverTimestamp / 1000),
      },
      title,
      description,
      link,
    };

    const response = await fetch("https://api.pinterest.com/v5/pins", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const data = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      console.error("[Pinterest] Pin creation failed:", data);
      return {
        success: false,
        error: "Failed to create pin",
        message: data.message as string,
      };
    }

    console.log("[Pinterest] Pin created successfully");
    return {
      success: true,
      postId: data.id as string,
      postUrl: `https://www.pinterest.com/pin/${data.id}/`,
      data,
      message: "Successfully created video pin",
    };
  } catch (error) {
    console.error("[Pinterest PostVideo] Pin creation error:", error);
    return {
      success: false,
      error: "Failed to create video pin",
      message: error instanceof Error ? error.message : "Unexpected error",
    };
  }
}
