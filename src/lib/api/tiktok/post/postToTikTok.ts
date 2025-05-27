// lib/api/tiktok/post/postToTikTok.ts
import { adminSupabase } from "@/actions/api/adminSupabase";
import { PrivacyLevel, TikTokOptions } from "@/lib/types/dbTypes";
import fetch from "node-fetch";
import "server-only";

// Define return type for TikTok posts
export interface TikTokPostResult {
  success: boolean;
  publishId?: string;
  postId?: string;
  postUrl?: string;
  data?: Record<string, unknown>;
  error?: string;
  details?: Record<string, unknown>;
  message?: string;
  status?: string;
  content_id?: string;
}

// Interfaces for API responses
interface CreatorInfoResponse {
  data: {
    creator_avatar_url: string;
    creator_username: string;
    creator_nickname: string;
    privacy_level_options: PrivacyLevel[];
    comment_disabled: boolean;
    duet_disabled: boolean;
    stitch_disabled: boolean;
    max_video_post_duration_sec: number;
  };
  error: {
    code: string;
    message: string;
    log_id: string;
  };
}

interface PostInitResponse {
  data: {
    publish_id: string;
    upload_url?: string;
  };
  error: {
    code: string;
    message: string;
    log_id: string;
  };
}

/**
 * Posts content directly to TikTok using their Content Posting API
 * Main function that handles authentication and routes to specific handlers
 */
export async function postToTikTok({
  accessToken,
  title,
  description,
  tikTokOptions,
  mediaPath,
  postType,
  coverTimestamp,
  mediaType,
  userId,
  buffer,
  autoAddMusic = true,
}: {
  accessToken: string;
  title?: string;
  description?: string;
  tikTokOptions?: TikTokOptions;
  buffer?: Buffer;
  coverTimestamp: number;
  postType: "image" | "video" | "text";
  mediaPath: string;
  mediaType: string;
  userId: string;
  autoAddMusic?: boolean;
}): Promise<TikTokPostResult> {
  try {
    if (!buffer) {
      return {
        success: false,
        error: "Buffer is required for video uploads to Pinterest",
      };
    }
    // Verify required parameters
    if (!accessToken || !mediaPath) {
      console.log("[Tiktok Post Function] Missing required parameters");

      return {
        success: false,
        error:
          "Missing required parameters (accessToken and mediaPath are required)",
      };
    }

    // STEP 1: Query Creator Info - needed for both image and video posts
    const creatorInfoResponse = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
      }
    );

    if (!creatorInfoResponse.ok) {
      const errorData = await creatorInfoResponse.json();
      console.error(
        "[Tiktok Post Function] Media registration error:",
        errorData
      );

      return {
        success: false,
        error: "Failed to query creator info",
        details: errorData as Record<string, unknown>,
      };
    }

    const creatorInfo =
      (await creatorInfoResponse.json()) as CreatorInfoResponse;

    // Call the appropriate handler based on media type
    if (postType === "image") {
      return await handleImagePost({
        accessToken,
        title,
        description,
        tikTokOptions,
        mediaPath,
        creatorInfo,
        autoAddMusic,
      });
    } else {
      // For videos, we'll use FILE_UPLOAD as specified
      return await handleVideoPost({
        accessToken,
        description,
        buffer,
        tikTokOptions,
        mediaPath,
        coverTimestamp,
        mediaType,
        userId,
        creatorInfo,
      });
    }
  } catch (error) {
    console.error("[Tiktok Post Function] Unexpected error:", error);

    return {
      success: false,
      error: "Failed to post to TikTok",
      message: "Unexpected error",
    };
  }
}

/**
 * Handles video posting to TikTok using FILE_UPLOAD method
 */
async function handleVideoPost({
  accessToken,
  description,
  tikTokOptions,
  buffer,
  coverTimestamp,
  mediaType,
  creatorInfo,
}: {
  accessToken: string;
  description?: string;
  tikTokOptions?: TikTokOptions;
  mediaPath: string;
  mediaType: string;
  buffer: Buffer;
  coverTimestamp: number;
  userId: string;
  creatorInfo: CreatorInfoResponse;
}): Promise<TikTokPostResult> {
  try {
    const fileSize = buffer?.length;

    // Calculate optimal chunk size based on file size
    let chunkSize: number;
    // Calculate optimal chunk size for chunked upload
    const MAX_CHUNK_SIZE = 250 * 1024 * 1024; // 64MB maximum per TikTok docs
    // Adaptive chunk sizing based on file size
    if (fileSize <= MAX_CHUNK_SIZE) {
      // Small videos: use a single chunk
      chunkSize = fileSize;
      console.log(
        `[TikTok Upload] Small video (${(fileSize / 1024 / 1024).toFixed(
          2
        )}MB): using single chunk upload`
      ); // Medium videos: use 64MB chunks
    } else {
      // Large videos: use 32MB chunks to avoid Vercel timeouts
      chunkSize = MAX_CHUNK_SIZE;
      console.log(
        `[TikTok Upload] Large file (${(fileSize / 1024 / 1024).toFixed(
          2
        )}MB): using ${MAX_CHUNK_SIZE / 1024 / 1024}MB chunks`
      );
    }

    const totalChunkCount = Math.ceil(fileSize / chunkSize);

    // STEP 2: Initialize video post
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
            privacy_level: tikTokOptions?.privacyLevel || "PUBLIC_TO_EVERYONE",
            disable_duet: tikTokOptions?.disableDuet || false,
            disable_comment: tikTokOptions?.disableComment || false,
            disable_stitch: tikTokOptions?.disableStitch || false,
            video_cover_timestamp_ms: coverTimestamp,
          },
          source_info: {
            source: "FILE_UPLOAD",
            video_size: fileSize,
            chunk_size: chunkSize,
            total_chunk_count: totalChunkCount,
          },
        }),
      }
    );

    if (!initResponse.ok) {
      const errorData = await initResponse.json();
      return {
        success: false,
        error: "Failed to initialize video post",
        details: errorData as Record<string, unknown>,
      };
    }

    const initData = (await initResponse.json()) as PostInitResponse;
    console.log(
      "[TikTok Upload] API Response:",
      JSON.stringify(initData, null, 2)
    );

    const publishId = initData.data.publish_id;
    const uploadUrl = initData.data.upload_url;

    if (!uploadUrl) {
      return {
        success: false,
        error: "No upload URL provided in the response",
      };
    }

    // STEP 3: Upload the video file in chunks
    for (let i = 0; i < totalChunkCount; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize - 1, fileSize - 1);
      const chunkLength = end - start + 1;
      const chunk = buffer.subarray(start, end + 1);

      // Retry logic for chunk uploads
      let retryCount = 0;
      const MAX_RETRIES = 3;
      let uploadSuccess = false;

      while (retryCount <= MAX_RETRIES && !uploadSuccess) {
        try {
          // Log upload attempt
          if (retryCount > 0) {
            console.log(
              `[TikTok Upload] Retrying chunk ${
                i + 1
              }/${totalChunkCount} (attempt ${retryCount + 1}/${
                MAX_RETRIES + 1
              })`
            );
          }

          const uploadResponse = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
              "Content-Type": mediaType,
              "Content-Length": chunkLength.toString(),
              "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            },
            body: chunk,
          });

          // Check for the expected status code
          const expectedStatus = i < totalChunkCount - 1 ? 206 : 201;
          if (uploadResponse.status === expectedStatus) {
            uploadSuccess = true;
          } else {
            console.error(
              `[TikTok Upload] Chunk ${i + 1} failed with status: ${
                uploadResponse.status
              }, expected: ${expectedStatus}`
            );
            retryCount++;
          }
        } catch (error) {
          console.error(
            `[TikTok Upload] Error uploading chunk ${i + 1}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          retryCount++;
        }

        // Add a short delay before retry
        if (!uploadSuccess && retryCount <= MAX_RETRIES) {
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * retryCount)
          );
        }
      }

      // If we've exhausted all retries, return error
      if (!uploadSuccess) {
        return {
          success: false,
          error: `Failed to upload video chunk ${
            i + 1
          }/${totalChunkCount} after multiple attempts`,
          status: "failed",
          content_id: publishId,
        };
      }
    }

    return {
      success: true,
      publishId,
      postUrl: `https://www.tiktok.com/@${creatorInfo.data.creator_username}`,
      data: { status: "PUBLISH_COMPLETE" }, // Simulate completed status
      message: `Video submitted to TikTok and marked as posted`,
      status: "posted",
      content_id: publishId,
    };
  } catch (error) {
    console.error("[tiktok Post Function] Unexpected error:", error);

    return {
      success: false,
      error: "Failed to post video to TikTok",
      message: "Unexpected error",
    };
  }
}

/**
 * Handles image posting to TikTok using PULL_FROM_URL method
 */
async function handleImagePost({
  accessToken,
  title,
  description,
  tikTokOptions,
  mediaPath,

  creatorInfo,
  autoAddMusic,
}: {
  accessToken: string;
  title?: string;
  description?: string;
  tikTokOptions?: TikTokOptions;
  mediaPath: string;
  creatorInfo: CreatorInfoResponse;
  autoAddMusic: boolean;
}): Promise<TikTokPostResult> {
  try {
    // For images, we must use PULL_FROM_URL with a signed URL
    const signedUrlResponse = await adminSupabase.storage
      .from("media") // Assuming 'media' is your bucket name
      .createSignedUrl(mediaPath, 7200); // 2 hour expiration

    if (signedUrlResponse.error) {
      return {
        success: false,
        error: "Failed to create signed URL for image",
        message: signedUrlResponse.error.message,
      };
    }

    const mediaUrl = signedUrlResponse.data.signedUrl;

    // STEP 2: Initialize the image post
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
            privacy_level: tikTokOptions?.privacyLevel || "PUBLIC_TO_EVERYONE",
            disable_comment: tikTokOptions?.disableComment || false,
            auto_add_music: autoAddMusic,
          },
          source_info: {
            source: "PULL_FROM_URL",
            photo_images: [mediaUrl], // Array for multiple images
            photo_cover_index: 0,
          },
          post_mode: "DIRECT_POST",
          media_type: "PHOTO",
        }),
      }
    );

    if (!initResponse.ok) {
      const errorData = await initResponse.json();
      return {
        success: false,
        error: "Failed to initialize image post",
        details: errorData as Record<string, unknown>,
      };
    }

    const initData = (await initResponse.json()) as PostInitResponse;
    const publishId = initData.data.publish_id;

    return {
      success: true,
      publishId,
      postUrl: `https://www.tiktok.com/@${creatorInfo.data.creator_username}`,
      data: { status: "PUBLISH_COMPLETE" }, // Simulate completed status
      message: `Video submitted to TikTok and marked as posted`,
      status: "posted",
      content_id: publishId,
    };
  } catch (error) {
    return {
      success: false,
      error: "Failed to post image to TikTok",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
