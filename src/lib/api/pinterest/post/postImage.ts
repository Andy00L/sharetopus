// =============================================================================
// lib/api/pinterest/post/postImage.ts
// =============================================================================
import "server-only";
import { PinterestPostResult } from "./postToPinterest";

/**
 * Create an image pin using direct URL upload (no download needed)
 */
export async function createImagePin({
  accessToken,
  boardId,
  title,
  description,
  link,
  mediaUrl,
}: {
  accessToken: string;
  boardId: string;
  title: string;
  description: string;
  link: string;
  mediaUrl: string;
}): Promise<PinterestPostResult> {
  try {
    const requestBody = {
      board_id: boardId,
      media_source: {
        source_type: "image_url",
        url: mediaUrl,
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
      console.error("[Pinterest] Image pin creation failed:", data);
      return {
        success: false,
        error: "Failed to create image pin",
        message: data.message as string,
      };
    }

    return {
      success: true,
      postId: data.id as string,
      postUrl: `https://www.pinterest.com/pin/${data.id}/`,
      data,
      message: "Successfully created image pin",
    };
  } catch (error) {
    console.error("[Pinterest PostImage] Unexpected error:", error);
    return {
      success: false,
      error: "Failed to create image pin",
      message: "Unexpected error",
    };
  }
}
