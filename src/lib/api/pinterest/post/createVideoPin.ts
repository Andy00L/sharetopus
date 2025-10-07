import "server-only";
import { getSupabaseVideoFile } from "@/actions/server/data/getSupabaseVideoFile";
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
 * Create a video pin using the 3-step process:
 * 1. Register media upload
 * 2. Upload video file
 * 3. Wait for processing
 * 4. Create pin
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
    // Get video buffer from Supabase
    const bufferRes = await getSupabaseVideoFile(mediaPath, userId);
    if (!bufferRes.success || !bufferRes.buffer) {
      return {
        success: false,
        error: bufferRes.message || "Failed to retrieve video file",
      };
    }

    // Step 1: Register media upload
    const registrationResult = await registerMediaUpload(accessToken);
    if (!registrationResult.success) {
      return registrationResult;
    }

    const { media_id, upload_url, upload_parameters } = registrationResult;

    // Step 2: Upload video file
    const uploadResult = await uploadVideoFile({
      uploadUrl: upload_url,
      uploadParameters: upload_parameters,
      buffer: bufferRes.buffer,
      mediaType,
      fileName,
    });
    if (!uploadResult.success) {
      return uploadResult;
    }

    // Step 3: Wait for video processing
    const processingResult = await waitForVideoProcessing(
      accessToken,
      media_id
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
  accessToken: string
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
 * Step 2: Upload video file to Pinterest's S3
 */
async function uploadVideoFile({
  uploadUrl,
  uploadParameters,
  buffer,
  mediaType,
  fileName,
}: {
  uploadUrl: string;
  uploadParameters: Record<string, string>;
  buffer: Buffer;
  mediaType: string;
  fileName: string;
}): Promise<PinterestPostResult> {
  try {
    const formData = new FormData();

    // Add all upload parameters from Pinterest
    Object.entries(uploadParameters).forEach(([key, value]) => {
      formData.append(key, value);
    });

    // Add the video file
    formData.append("file", new Blob([buffer], { type: mediaType }), fileName);

    const response = await fetch(uploadUrl, {
      method: "POST",
      body: formData,
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

    console.log("[Pinterest PostVideo] Video uploaded successfully");
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
  mediaId: string
): Promise<PinterestPostResult> {
  const MAX_TIMEOUT = 40000; // 40 seconds
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
      }/${MAX_ATTEMPTS})`
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
  mediaId: string
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
      }
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
