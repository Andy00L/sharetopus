// =============================================================================
// lib/api/pinterest/post/postImage.ts
// =============================================================================
import "server-only";

import { z } from "zod";

import { readStringField } from "@/lib/platforms/providers/_shared/providerFetch";
import { PinterestPostResult } from "./postToPinterest";

/** POST /v5/pins answer: the pin id, the rest kept for the result's data. Also read by createVideoPin. */
export const CreatedPinSchema = z.looseObject({ id: z.string() });

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

    const payload: unknown = await response.json();

    if (!response.ok) {
      console.error("[Pinterest] Image pin creation failed:", payload);
      return {
        success: false,
        error: "Failed to create image pin",
        message: readStringField(payload, "message") ?? undefined,
      };
    }

    const createdPin = CreatedPinSchema.safeParse(payload);
    if (!createdPin.success) {
      console.error("[Pinterest] Image pin response had no pin id");
      return {
        success: false,
        error: "Failed to create image pin",
        message: "Pinterest returned no pin id",
      };
    }

    return {
      success: true,
      postId: createdPin.data.id,
      postUrl: `https://www.pinterest.com/pin/${createdPin.data.id}/`,
      data: createdPin.data,
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
