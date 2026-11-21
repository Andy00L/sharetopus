import "server-only";

import type { MediaType } from "@/db/schema";
import {
  buildInputFailure,
  type PlatformPostFailure,
} from "@/lib/api/_shared/platformFailure";
import { createVideoPin } from "./createVideoPin";
import { createImagePin } from "./postImage";

export type PinterestPostResult =
  | {
      success: true;
      postId: string;
      postUrl: string;
      data: Record<string, unknown>;
      message: string;
    }
  | PlatformPostFailure;

export async function postToPinterest({
  accessToken,
  boardId,
  title = "",
  description = "",
  link = "",
  mediaPath,
  mediaType,
  fileName,
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
  coverTimestamp: number;
  postType: MediaType;
  mediaUrl: string | null;
}): Promise<PinterestPostResult> {
  if (!accessToken || !boardId) {
    console.error("[postToPinterest] Missing access token or board id");
    return buildInputFailure("Missing required parameters (accessToken and boardId)");
  }

  if (postType === "image") {
    if (!mediaUrl) {
      console.error("[postToPinterest] Image pin without media URL");
      return buildInputFailure("Media URL is required for Pinterest image pins");
    }
    return createImagePin({
      accessToken,
      boardId,
      title,
      description,
      link,
      mediaUrl,
    });
  }

  return createVideoPin({
    accessToken,
    boardId,
    title,
    description,
    link,
    mediaPath,
    mediaType,
    fileName,
    coverTimestamp,
  });
}
