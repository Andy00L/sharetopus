import "server-only";

import { z } from "zod";

import {
  buildHttpFailure,
  buildNetworkFailure,
  buildUnreadableAnswerFailure,
} from "@/lib/api/_shared/platformFailure";
import {
  PLATFORM_IMAGE_PULL_TIMEOUT_MS,
  PLATFORM_PUBLISH_TIMEOUT_MS,
} from "@/lib/api/_shared/platformFetchTimeouts";
import { parseJsonObject } from "@/lib/platforms/providers/_shared/providerFetch";
import type { PinterestPostResult } from "./postToPinterest";

const CreatedPinSchema = z.looseObject({ id: z.string().min(1) });

const PIN_REQUEST_TIMEOUT_MS: Record<"image" | "video", number> = {
  image: PLATFORM_IMAGE_PULL_TIMEOUT_MS,
  video: PLATFORM_PUBLISH_TIMEOUT_MS,
};

export async function createPin({
  accessToken,
  pinBody,
  action,
  pinLabel,
}: {
  accessToken: string;
  pinBody: Record<string, unknown>;
  action: string;
  pinLabel: "image" | "video";
}): Promise<PinterestPostResult> {
  try {
    const response = await fetch("https://api.pinterest.com/v5/pins", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(pinBody),
      signal: AbortSignal.timeout(PIN_REQUEST_TIMEOUT_MS[pinLabel]),
    });
    const responseText = await response.text();

    if (!response.ok) {
      console.error(`[createPin] ${action} failed (${response.status}): ${responseText}`);
      return buildHttpFailure({
        platform: "pinterest",
        action,
        httpStatus: response.status,
        responseText,
        isPublishRequest: true,
      });
    }

    const createdPin = CreatedPinSchema.safeParse(parseJsonObject(responseText));
    if (!createdPin.success) {
      console.error(`[createPin] ${action} answer had no pin id`);
      return buildUnreadableAnswerFailure({ action, isPublishRequest: true });
    }

    console.log(`[createPin] Created ${pinLabel} pin ${createdPin.data.id}`);
    return {
      success: true,
      postId: createdPin.data.id,
      postUrl: `https://www.pinterest.com/pin/${createdPin.data.id}/`,
      data: createdPin.data,
      message: `Successfully created ${pinLabel} pin`,
    };
  } catch (requestError) {
    const failure = buildNetworkFailure({ action, requestError, isPublishRequest: true });
    console.error("[createPin]", failure.error);
    return failure;
  }
}

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
  return createPin({
    accessToken,
    pinBody: {
      board_id: boardId,
      media_source: { source_type: "image_url", url: mediaUrl },
      title,
      description,
      link,
    },
    action: "Pinterest image pin creation",
    pinLabel: "image",
  });
}
