"use server";

import type { PrivacyLevel } from "@/lib/types/dbTypes";

// Matches CreatorInfoResponse.data in postToTikTok.ts
export type CreatorInfoData = {
  creator_avatar_url: string;
  creator_username: string;
  creator_nickname: string;
  privacy_level_options: PrivacyLevel[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
};

type CreatorInfoApiResponse = {
  data: CreatorInfoData;
  error: {
    code: string;
    message: string;
    log_id: string;
  };
};

type GetCreatorInfoResult =
  | { success: true; data: CreatorInfoData }
  | { success: false; message: string };

/**
 * Fetches TikTok creator info for the Content Posting API.
 * Returns privacy_level_options, interaction flags, and creator display info.
 * https://developers.tiktok.com/doc/content-posting-api-reference-direct-post-video
 */
export async function getTikTokCreatorInfo(
  accessToken: string
): Promise<GetCreatorInfoResult> {
  if (!accessToken) {
    console.error("[getTikTokCreatorInfo] Missing access token");
    return { success: false, message: "Missing TikTok access token" };
  }

  try {
    const response = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        "[getTikTokCreatorInfo] HTTP error:",
        response.status,
        errorBody
      );
      return {
        success: false,
        message: `TikTok API returned ${response.status}`,
      };
    }

    const json = (await response.json()) as CreatorInfoApiResponse;

    if (json.error && json.error.code !== "ok") {
      console.error("[getTikTokCreatorInfo] API error:", json.error);
      return {
        success: false,
        message: json.error.message || "TikTok creator info query failed",
      };
    }

    if (!json.data) {
      console.error("[getTikTokCreatorInfo] No data in response");
      return { success: false, message: "No creator info data returned" };
    }

    return { success: true, data: json.data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[getTikTokCreatorInfo] Unexpected error:", message);
    return { success: false, message: `Failed to fetch creator info: ${message}` };
  }
}
