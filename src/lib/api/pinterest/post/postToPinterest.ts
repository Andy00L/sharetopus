// lib/api/pinterest/post/postToPinterest.ts
import { adminSupabase } from "@/actions/api/supabase-client";
import { auth } from "@clerk/nextjs/server";
import FormData from "form-data";
import fetch from "node-fetch";

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
  fileName, // Added filename parameter
  userId,
  supabaseBucket,
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
  supabaseBucket: string;
}): Promise<PinterestPostResult> {
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
    console.log("[Pinterest Post Function] Received parameters:");
    console.log("[Pinterest Post Function] boardId:", boardId);
    console.log("[Pinterest Post Function] title:", title);
    console.log(
      "[Pinterest Post Function] description length:",
      description?.length ?? 0
    );
    console.log("[Pinterest Post Function] link:", link);
    console.log("[Pinterest Post Function] mediaType:", mediaType);
    console.log("[Pinterest Post Function] fileName:", fileName);
    console.log(
      "[Pinterest Post Function] accessToken:",
      accessToken ? `${accessToken.substring(0, 6)}...` : "missing"
    );
    console.log(
      "[Pinterest Post Function] mediaBuffer length:",
      mediaPath ? mediaPath.length : 0
    );

    // Verify required parameters
    if (!accessToken || !boardId || !mediaPath) {
      console.log("[Pinterest Post Function] Missing required parameters");
      return {
        success: false,
        error:
          "Missing required parameters (accessToken, boardId, and mediaBuffer are required)",
      };
    }

    // Determine if we're posting an image or video
    const isImage = mediaType.startsWith("image/");
    const isVideo = mediaType.startsWith("video/");

    if (!isVideo && !isImage) {
      console.log(
        "[Pinterest Post Function] Unsupported media type:",
        mediaType
      );
      return {
        success: false,
        error: "Unsupported media type. Must be image or video.",
      };
    }

    if (isImage) {
      // FOR IMAGES: Use direct base64 encoding (original approach)
      console.log(
        "[Pinterest Post Function] Retrieving image for base64 encoding"
      );

      const { data: fileData, error: fileError } = await adminSupabase.storage
        .from(supabaseBucket)
        .download(mediaPath);

      if (fileError || !fileData) {
        console.error(
          "[Pinterest Post Function] Error retrieving image:",
          fileError
        );
        return {
          success: false,
          error: "Failed to retrieve image for uploading",
        };
      }
      const buffer = Buffer.from(await fileData.arrayBuffer());
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
      const data = (await createPinResponse.json()) as Record<string, unknown>; // <— you already need this

      if (!createPinResponse.ok) {
        // Error handling
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
    console.log("[Pinterest Post Function] Registering media upload");

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
    console.log(
      "[Pinterest Post Function] Media registration successful"
      // registerData
    );

    const { media_id, upload_url, upload_parameters } =
      registerData as PinterestMediaRegistrationResponse;

    // STEP 2: Upload media to the provided URL
    console.log("[Pinterest Post Function] Uploading media to provided URL");

    // Create form data with all required parameters
    const formData = new FormData();

    // Add all upload parameters from Pinterest
    Object.entries(upload_parameters).forEach(([key, value]) => {
      formData.append(key, value as string);
    });

    const { data: fileStream, error: streamError } = await adminSupabase.storage
      .from(supabaseBucket)
      .download(mediaPath);

    if (streamError || !fileStream) {
      console.error(
        "[Pinterest Post Function] Error creating stream:",
        streamError
      );
      return {
        success: false,
        error: "Failed to create stream for uploading",
      };
    }

    const buffer = Buffer.from(await fileStream.arrayBuffer());

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
    console.log(
      `[Pinterest Post Function] Creating pin with media_id: ${media_id}`
    );

    const pinRequestBody = {
      board_id: boardId,
      media_source: {
        media_id: media_id,
        source_type: "video_id", // Add this line
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
      message: `Successfully created ${
        isImage ? "image" : "video"
      } pin on Pinterest`,
    };
  } catch (error) {
    console.error("[Pinterest Post Function] Unexpected error:", error);

    return {
      success: false,
      error: "Failed to post to Pinterest",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
