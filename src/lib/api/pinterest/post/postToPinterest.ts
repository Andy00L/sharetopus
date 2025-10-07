// =============================================================================
// lib/api/pinterest/post/createVideoPin.ts
// =============================================================================

import "server-only";
import { createVideoPin } from "./createVideoPin";
import { createImagePin } from "./postImage";

// Define return type for Pinterest posts
export interface PinterestPostResult {
  success: boolean;
  postId?: string;
  postUrl?: string;
  data?: Record<string, unknown>;
  error?: string;
  message?: string;
}
export interface PinterestMediaRegistrationResponse {
  media_id: string;
  media_type: string;
  upload_url: string;
  upload_parameters: Record<string, string>;
}
export interface PinterestMediaStatusResponse {
  status: string;
  media_id: string;
  media_type?: string;
}

/**
 * Posts content directly to Pinterest
 * - Images: Uses direct URL upload (no download needed)
 * - Videos: Uses the 3-step process (register → upload → create pin)
 */
export async function postToPinterest({
  accessToken,
  boardId,
  title = "",
  description = "",
  link = "",
  mediaPath,
  mediaType,
  fileName,
  userId,
  coverTimestamp,
  postType,
  mediaUrl,
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
  coverTimestamp: number;
  postType: "image" | "video" | "text";
  mediaUrl: string;
}): Promise<PinterestPostResult> {
  try {
    // Verify required parameters
    if (!accessToken || !boardId) {
      console.log(
        "[Pinterest Post Function] Missing required parameters (accessToken, boardId, mediaPath)"
      );
      return {
        success: false,
        error: "Missing required parameters",
      };
    }

    // Handle image posts (simple URL upload)
    if (postType === "image") {
      return await createImagePin({
        accessToken,
        boardId,
        title,
        description,
        link,
        mediaUrl,
      });
    }

    // Handle video posts (complex 3-step process)
    return await createVideoPin({
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
    });
  } catch (error) {
    console.error("[Pinterest Post] Unexpected error:", error);
    return {
      success: false,
      error: "Failed to post to Pinterest",
      message: error instanceof Error ? error.message : "Unexpected error",
    };
  }
}
