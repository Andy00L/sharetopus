// lib/api/pinterest/post/postToPinterest.ts
import FormData from "form-data";
import fetch from "node-fetch";
import "server-only";

// Define return type for Pinterest posts
export interface PinterestPostResult {
  success: boolean;
  postId?: string;
  postUrl?: string;
  data?: Record<string, unknown>;
  error?: string;
  details?: Record<string, unknown>;
  message?: string;
}
interface PinterestMediaRegistrationResponse {
  media_id: string;
  media_type: string;
  upload_url: string;
  upload_parameters: Record<string, string>;
}

/**
 * Posts content directly to Pinterest using the two-step process:
 * 1. Register media upload and get upload URL
 * 2. Upload media to the provided URL
 * 3. Create a pin with the uploaded media ID
 */
export async function postToPinterest({
  accessToken,
  boardId,
  title,
  description,
  link,
  mediaPath,
  mediaType,
  fileName,
  buffer,
  coverTimestamp,
  postType,
}: {
  accessToken: string;
  boardId: string;
  title?: string;
  description?: string;
  link?: string;
  mediaPath: string;
  mediaType: string;
  fileName: string;
  userId: string;
  buffer?: Buffer;
  coverTimestamp: number;
  postType: "image" | "video" | "text";
}): Promise<PinterestPostResult> {
  try {
    // Verify required parameters
    if (!accessToken || !boardId || !mediaPath) {
      console.log("[Pinterest Post Function] Missing required parameters");
      return {
        success: false,
        error:
          "Missing required parameters (accessToken, boardId, and mediaBuffer are required)",
      };
    }

    if (!buffer) {
      return {
        success: false,
        error: "Buffer is required for video uploads to Pinterest",
      };
    }

    if (postType === "text") {
      return {
        success: false,
        error: "Pinterest doesn't support text-only posts.",
      };
    }

    if (postType === "image") {
      const base64Media = buffer.toString("base64");
      // Create pin with embedded media
      const requestBody = {
        board_id: boardId,
        media_source: {
          source_type: "image_base64",
          content_type: mediaType,
          data: base64Media,
        },
        title: title ?? "",
        description: description ?? "",
        link: link ?? "",
      };

      // Submit the request
      const createPinResponse = await fetch(
        "https://api.pinterest.com/v5/pins",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        }
      );
      const data = (await createPinResponse.json()) as Record<string, unknown>;

      if (!createPinResponse.ok) {
        console.error(
          "[Pinterest Post Function] Media registration error:",
          data
        );
        return {
          success: false,
          error: "Failed to register media upload",
          details: data,
        };
      }

      return {
        success: true,
        postId: data.id as string,
        postUrl: `https://www.pinterest.com/pin/${data.id}/`,
        data,
        message: "Successfully created image pin on Pinterest",
      };
    }

    // STEP 1: Register media upload

    const registerResponse = await fetch("https://api.pinterest.com/v5/media", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        media_type: "video",
      }),
    });

    if (!registerResponse.ok) {
      const errorData = await registerResponse.json();
      console.error(
        "[Pinterest Post Function] Media registration error:",
        errorData
      );
      return {
        success: false,
        error: "Failed to register media upload",
      };
    }

    const registerData = await registerResponse.json();
    console.log("[Pinterest Post Function] Media registration successful");

    const { media_id, upload_url, upload_parameters } =
      registerData as PinterestMediaRegistrationResponse;

    // STEP 2: Upload media to the provided URL

    // Create form data with all required parameters
    const formData = new FormData();

    // Add all upload parameters from Pinterest
    Object.entries(upload_parameters).forEach(([key, value]) => {
      formData.append(key, value);
    });

    // Then use the buffer with FormData
    formData.append("file", buffer, {
      filename: fileName,
      contentType: mediaType,
    });

    const uploadResponse = await fetch(upload_url, {
      method: "POST",
      body: formData,
    });

    if (!uploadResponse.ok) {
      console.error(
        "[Pinterest Post Function] Media upload error:",
        await uploadResponse.text()
      );
      return {
        success: false,
        error: "Failed to upload media",
        message: `Upload failed with status: ${uploadResponse.status}`,
      };
    }

    console.log("[Pinterest Post Function] Media upload successful");

    // STEP 3: Create pin with the uploaded media

    const pinRequestBody = {
      board_id: boardId,
      media_source: {
        media_id: media_id,
        source_type: "video_id",
        cover_image_key_frame_time: Math.floor(coverTimestamp / 1000),
      },
      title: title ?? "",
      description: description ?? "",
      link: link ?? "",
    };

    const createPinResponse = await fetch("https://api.pinterest.com/v5/pins", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(pinRequestBody),
    });

    console.log(
      "[Pinterest Post Function] Pin creation response status:",
      createPinResponse.status
    );

    if (!createPinResponse.ok) {
      const errorData = await createPinResponse.json();
      console.error(
        "[Pinterest Post Function] Pinterest API error:",
        errorData
      );

      return {
        success: false,
        error: "Failed to create pin",
      };
    }

    // Process successful response
    const data = (await createPinResponse.json()) as Record<string, unknown>;
    console.log("[Pinterest Post Function] Successfully created pin");

    return {
      success: true,
      postId: data.id as string,
      postUrl: `https://www.pinterest.com/pin/${data.id}/`,
      data: data,
      message: `Successfully created ${postType} pin on Pinterest`,
    };
  } catch (error) {
    console.error("[Pinterest Post Function] Unexpected error:", error);

    return {
      success: false,
      error: "Failed to post to Pinterest",
      message: "Unexpected error",
    };
  }
}
