import "server-only";

import type { MediaType } from "@/db/schema";
import {
  buildInputFailure,
  type PlatformPostFailure,
} from "@/lib/api/_shared/platformFailure";
import { getTikTokCreatorInfo } from "@/lib/api/tiktok/data/getTikTokCreatorInfo";
import { TikTokOptions } from "@/lib/types/dbTypes";
import { handleImagePost } from "./postImage";
import { handleVideoPost } from "./postVideo";

export type TikTokPostResult =
  | {
      success: true;
      publishId: string;
      postUrl: string;
      data: Record<string, unknown>;
      message: string;
      status: string;
      content_id: string;
      creator_username: string;
    }
  | PlatformPostFailure;

// TikTok's Direct Post flow queries creator info before it initializes a post:
// https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
export async function postToTikTok({
  accessToken,
  title,
  description,
  tikTokOptions,
  postType,
  coverTimestamp,
  media_url,
  autoAddMusic = true,
}: {
  accessToken: string;
  title?: string;
  description?: string;
  tikTokOptions?: TikTokOptions;
  coverTimestamp: number;
  postType: MediaType;
  mediaType: string;
  media_url: string;
  autoAddMusic?: boolean;
}): Promise<TikTokPostResult> {
  if (!accessToken) {
    console.error("[postToTikTok] Missing access token");
    return buildInputFailure("Missing access token");
  }

  const creatorInfo = await getTikTokCreatorInfo(accessToken);
  if (!creatorInfo.success) {
    return {
      success: false,
      error: `TikTok creator info query failed: ${creatorInfo.message}`,
      failure: creatorInfo.failure,
    };
  }
  const creatorUsername = creatorInfo.data.creator_username;

  if (postType === "image") {
    return handleImagePost({
      accessToken,
      title,
      description,
      tikTokOptions,
      creatorUsername,
      autoAddMusic,
      media_url,
    });
  }
  return handleVideoPost({
    accessToken,
    description,
    tikTokOptions,
    coverTimestamp,
    creatorUsername,
    media_url,
  });
}
