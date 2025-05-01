// lib/api/tiktok/post/postToTikTok.ts
import { getSupabaseVideoFile } from "@/actions/server/data/getSupabaseVideoFile";
import { adminSupabase } from "@/actions/api/supabase-client";
import { auth } from "@clerk/nextjs/server";
import fetch from "node-fetch";
import { PrivacyLevel } from "@/lib/types/dbTypes";

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
}

export type PostMode = "DIRECT_POST" | "MEDIA_UPLOAD";

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

interface PostStatusResponse {
  data: {
    status: string;
    fail_reason?: string;
    publicaly_available_post_id?: string[];
    uploaded_bytes?: number;
  };
  error: {
    code: string;
    message: string;
    log_id: string;
  };
}

/**
 * Posts content directly to TikTok using their Content Posting API
 * Handles both images and videos with proper chunking for large files
 */
export async function postToTikTok({
  accessToken,
  title,
  description,
  privacyLevel = "PUBLIC_TO_EVERYONE",
  disableComment = false,
  disableDuet = false,
  disableStitch = false,
  mediaPath,
  mediaType,
  fileName,
  userId,
  supabaseBucket = "scheduled-videos",
  postMode = "DIRECT_POST",
  autoAddMusic = true,
  usePullFromUrl = false,
}: {
  accessToken: string;
  title?: string;
  description?: string;
  privacyLevel?: PrivacyLevel;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  mediaPath: string;
  mediaType: string;
  fileName: string;
  userId: string;
  supabaseBucket?: string;
  postMode?: PostMode;
  autoAddMusic?: boolean;
  usePullFromUrl?: boolean;
}): Promise<TikTokPostResult> {
  try {
    // Authenticate the user
    const { userId: clerkUserId } = await auth();

    if (!clerkUserId || clerkUserId !== userId) {
      return {
        success: false,
        error: "Unauthorized - Authentication required",
      };
    }

    // Log the received parameters (truncating sensitive data)
    console.log("[TikTok Post Function] Received parameters:");
    console.log("[TikTok Post Function] title:", title);
    console.log("[TikTok Post Function] description:", description);
    console.log("[TikTok Post Function] privacyLevel:", privacyLevel);
    console.log("[TikTok Post Function] mediaType:", mediaType);
    console.log("[TikTok Post Function] fileName:", fileName);
    console.log("[TikTok Post Function] postMode:", postMode);
    console.log(
      "[TikTok Post Function] accessToken:",
      accessToken ? `${accessToken.substring(0, 6)}...` : "missing"
    );

    // Verify required parameters
    if (!accessToken || !mediaPath) {
      console.log("[TikTok Post Function] Missing required parameters");
      return {
        success: false,
        error:
          "Missing required parameters (accessToken and mediaPath are required)",
      };
    }

    // Determine if we're posting image or video
    const isImage = mediaType.startsWith("image/");
    const isVideo = mediaType.startsWith("video/");

    if (!isVideo && !isImage) {
      console.log("[TikTok Post Function] Unsupported media type:", mediaType);
      return {
        success: false,
        error: "Unsupported media type. Must be image or video.",
      };
    }

    // STEP 1: Query Creator Info
    console.log("[TikTok Post Function] Querying creator info");

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
        "[TikTok Post Function] Creator info query error:",
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
    console.log("[TikTok Post Function] Creator info retrieved successfully");

    // For DIRECT_POST, verify the requested privacy level is available for this user
    if (
      postMode === "DIRECT_POST" &&
      !creatorInfo.data.privacy_level_options.includes(privacyLevel)
    ) {
      console.log(
        "[TikTok Post Function] Requested privacy level not available for this user:",
        privacyLevel,
        "Available options:",
        creatorInfo.data.privacy_level_options
      );
      return {
        success: false,
        error: `Requested privacy level '${privacyLevel}' not available for this user`,
        details: { availableOptions: creatorInfo.data.privacy_level_options },
      };
    }

    // STEP 2: Determine if we can use PULL_FROM_URL (if we have verified domains)
    // If usePullFromUrl is true, we'll try to generate a signed URL for TikTok
    let mediaUrl = "";
    let useDirectUpload = !usePullFromUrl;

    if (usePullFromUrl) {
      try {
        // Create a signed URL with reasonable expiration time (2 hours)
        const signedUrlResponse = await adminSupabase.storage
          .from(supabaseBucket)
          .createSignedUrl(mediaPath, 7200);

        if (signedUrlResponse.error) {
          throw new Error(
            `Failed to create signed URL: ${signedUrlResponse.error.message}`
          );
        }

        mediaUrl = signedUrlResponse.data.signedUrl;
        console.log(
          "[TikTok Post Function] Created signed URL for PULL_FROM_URL method"
        );
      } catch (urlError) {
        console.log(
          "[TikTok Post Function] Couldn't create signed URL, falling back to direct upload:",
          urlError
        );
        useDirectUpload = true;
      }
    }

    // For images, we must use PULL_FROM_URL
    if (isImage && useDirectUpload) {
      try {
        // Try harder to create a signed URL for images
        const signedUrlResponse = await adminSupabase.storage
          .from(supabaseBucket)
          .createSignedUrl(mediaPath, 7200);

        if (signedUrlResponse.error) {
          throw new Error(
            `Failed to create signed URL: ${signedUrlResponse.error.message}`
          );
        }

        mediaUrl = signedUrlResponse.data.signedUrl;
        useDirectUpload = false;
        console.log(
          "[TikTok Post Function] Created signed URL for image upload"
        );
      } catch (urlError) {
        console.log("[PostToTiktok] fail to create the signed url: ", urlError);
        return {
          success: false,
          error:
            "Image uploads to TikTok require publicly accessible URLs. Could not create signed URL.",
          message:
            "For image posting, please verify your domain with TikTok or contact support.",
        };
      }
    }

    // STEP 3: Initialize the post based on media type and upload method
    let requestBody: Record<string, unknown> = {};
    let postEndpoint: string;
    let buffer: Buffer | null = null;
    let fileSize = 0;

    if (isImage) {
      console.log(
        "[TikTok Post Function] Creating signed URL for image with extended expiration"
      );

      // Images must use the content endpoint and PULL_FROM_URL
      postEndpoint =
        "https://open.tiktokapis.com/v2/post/publish/content/init/";

      requestBody = {
        post_info: {
          title: title || "",
          description: description || "",
          privacy_level: privacyLevel,
          disable_comment: disableComment,
          auto_add_music: autoAddMusic,
        },
        source_info: {
          source: "PULL_FROM_URL",
          photo_images: [mediaUrl], // Array for multiple images
          photo_cover_index: 0,
        },
        post_mode: postMode,
        media_type: "PHOTO",
      };
    } else {
      // Videos use the video endpoint
      postEndpoint = "https://open.tiktokapis.com/v2/post/publish/video/init/";

      if (!useDirectUpload) {
        // Video post initialization with PULL_FROM_URL
        requestBody = {
          post_info: {
            title: title || "",
            privacy_level: privacyLevel,
            disable_duet: disableDuet,
            disable_comment: disableComment,
            disable_stitch: disableStitch,
          },
          source_info: {
            source: "PULL_FROM_URL",
            video_url: mediaUrl,
          },
        };
      } else {
        // For direct upload, download the file first to get size and prepare for chunking
        console.log(
          "[TikTok Post Function] Downloading file for direct upload"
        );

        buffer = await getSupabaseVideoFile(mediaPath, userId);
        fileSize = buffer.length;

        // Calculate optimal chunk size for chunked upload
        const MIN_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
        const MAX_CHUNK_SIZE = 64 * 1024 * 1024; // 64MB

        let chunkSize: number;

        if (fileSize <= MIN_CHUNK_SIZE) {
          // Small file, upload as a single chunk
          chunkSize = fileSize;
        } else if (fileSize <= MAX_CHUNK_SIZE) {
          // Medium file, upload as a single chunk
          chunkSize = fileSize;
        } else {
          // Large file, use the maximum chunk size
          chunkSize = MAX_CHUNK_SIZE;
        }

        const totalChunkCount = Math.ceil(fileSize / chunkSize);

        console.log(
          `[TikTok Post Function] Using FILE_UPLOAD with ${totalChunkCount} chunks of ${chunkSize} bytes each`
        );

        requestBody = {
          post_info: {
            title: title || "",
            privacy_level: privacyLevel,
            disable_duet: disableDuet,
            disable_comment: disableComment,
            disable_stitch: disableStitch,
          },
          source_info: {
            source: "FILE_UPLOAD",
            video_size: fileSize,
            chunk_size: chunkSize,
            total_chunk_count: totalChunkCount,
          },
        };
      }
    }

    console.log(
      "[TikTok Post Function] Initializing post with endpoint:",
      postEndpoint
    );
    console.log(
      "[TikTok Post Function] Request body:",
      JSON.stringify(requestBody, null, 2)
    );

    const initResponse = await fetch(postEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(requestBody),
    });

    if (!initResponse.ok) {
      const errorData = await initResponse.json();
      console.error(
        "[TikTok Post Function] Post initialization error:",
        errorData
      );
      return {
        success: false,
        error: "Failed to initialize post",
        details: errorData as Record<string, unknown>,
      };
    }

    const initData = (await initResponse.json()) as PostInitResponse;
    console.log("[TikTok Post Function] Post initialization successful");

    const publishId = initData.data.publish_id;
    const uploadUrl = initData.data.upload_url;

    // STEP 4: Upload the video file in chunks if using FILE_UPLOAD method
    if (isVideo && useDirectUpload && uploadUrl && buffer) {
      console.log("[TikTok Post Function] Uploading video to provided URL");
      const sourceInfo = requestBody.source_info as Record<string, unknown>;
      if (
        !sourceInfo ||
        typeof sourceInfo.chunk_size !== "number" ||
        typeof sourceInfo.total_chunk_count !== "number"
      ) {
        return {
          success: false,
          error: "Invalid request body structure",
        };
      }
      const chunkSize = sourceInfo.chunk_size as number;
      const totalChunks = sourceInfo.total_chunk_count as number;

      // For files that need chunking
      if (totalChunks > 1) {
        for (let i = 0; i < totalChunks; i++) {
          const start = i * chunkSize;
          const end = Math.min(start + chunkSize - 1, fileSize - 1);
          const chunkLength = end - start + 1;

          // Extract the chunk from the buffer
          const chunk = buffer.slice(start, end + 1);

          console.log(
            `[TikTok Post Function] Uploading chunk ${
              i + 1
            }/${totalChunks}: bytes ${start}-${end}/${fileSize}`
          );

          const uploadResponse = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
              "Content-Type": mediaType,
              "Content-Length": chunkLength.toString(),
              "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            },
            body: chunk,
          });

          // For chunked uploads, we should get 206 Partial Content for all chunks except the last one
          const expectedStatus = i < totalChunks - 1 ? 206 : 201;

          if (uploadResponse.status !== expectedStatus) {
            console.error(
              `[TikTok Post Function] Chunk upload error (chunk ${
                i + 1
              }/${totalChunks}):`,
              await uploadResponse.text()
            );
            return {
              success: false,
              error: `Failed to upload video chunk ${i + 1}/${totalChunks}`,
              message: `Upload failed with status: ${uploadResponse.status}, expected: ${expectedStatus}`,
            };
          }

          console.log(
            `[TikTok Post Function] Chunk ${
              i + 1
            }/${totalChunks} uploaded successfully`
          );
        }
      } else {
        // For small files that can be uploaded in one go
        console.log(`[TikTok Post Function] Uploading video as a single chunk`);

        const uploadResponse = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": mediaType,
            "Content-Length": fileSize.toString(),
            "Content-Range": `bytes 0-${fileSize - 1}/${fileSize}`,
          },
          body: buffer,
        });

        if (uploadResponse.status !== 201) {
          console.error(
            "[TikTok Post Function] Video upload error:",
            await uploadResponse.text()
          );
          return {
            success: false,
            error: "Failed to upload video",
            message: `Upload failed with status: ${uploadResponse.status}, expected: 201`,
          };
        }
      }

      console.log("[TikTok Post Function] Video upload completed successfully");
    }

    // STEP 5: Poll for post status
    let maxRetries = 15;
    let isCompleted = false;
    let statusData: PostStatusResponse | null = null;

    console.log("[TikTok Post Function] Polling for post status");

    while (maxRetries > 0 && !isCompleted) {
      // Wait 2 seconds between status checks
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const statusResponse = await fetch(
        "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json; charset=UTF-8",
          },
          body: JSON.stringify({ publish_id: publishId }),
        }
      );

      if (!statusResponse.ok) {
        maxRetries--;
        console.log(
          "[TikTok Post Function] Status check failed, retries left:",
          maxRetries
        );
        continue;
      }

      statusData = (await statusResponse.json()) as PostStatusResponse;
      console.log(
        "[TikTok Post Function] Status check response:",
        statusData.data.status
      );

      // Check if posting is complete or failed
      if (
        statusData.data.status === "PUBLISH_COMPLETE" ||
        statusData.data.status === "FAILED" ||
        (postMode === "MEDIA_UPLOAD" &&
          statusData.data.status === "SEND_TO_USER_INBOX")
      ) {
        isCompleted = true;
      } else {
        maxRetries--;
        console.log(
          "[TikTok Post Function] Still processing, retries left:",
          maxRetries
        );
      }
    }

    // Check the final status
    if (!statusData) {
      return {
        success: false,
        error: "Failed to get post status after multiple attempts",
      };
    }

    if (statusData.data.status === "FAILED") {
      return {
        success: false,
        error: `Post failed: ${
          statusData.data.fail_reason || "unknown reason"
        }`,
        details: statusData.data,
      };
    }

    // Handle successful states based on post mode
    if (statusData.data.status === "PUBLISH_COMPLETE") {
      // Get post ID if available
      const postId = statusData.data.publicaly_available_post_id?.[0] || "";
      const postUrl = postId
        ? `https://www.tiktok.com/@${creatorInfo.data.creator_username}/video/${postId}`
        : "";

      return {
        success: true,
        publishId,
        postId,
        postUrl,
        data: statusData.data,
        message: `Successfully posted ${isImage ? "image" : "video"} to TikTok`,
      };
    } else if (
      postMode === "MEDIA_UPLOAD" &&
      statusData.data.status === "SEND_TO_USER_INBOX"
    ) {
      // For upload mode, this is the expected successful state
      return {
        success: true,
        publishId,
        message: `Media successfully uploaded to TikTok. User needs to complete the post via TikTok app notification.`,
        data: statusData.data,
      };
    }

    // If we reach here, the process is still ongoing
    return {
      success: true,
      publishId,
      message: `Post initiated successfully but still processing (status: ${statusData.data.status})`,
      data: statusData.data,
    };
  } catch (error) {
    console.error("[TikTok Post Function] Unexpected error:", error);

    return {
      success: false,
      error: "Failed to post to TikTok",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
