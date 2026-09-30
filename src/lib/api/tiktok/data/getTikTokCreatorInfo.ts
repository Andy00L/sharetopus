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
  data?: CreatorInfoData;
  error?: {
    code: string;
    message: string;
    log_id: string;
  };
};

type GetCreatorInfoResult =
  | { success: true; data: CreatorInfoData }
  | { success: false; message: string };

/**
 * User-facing messages for the creator_info error codes a creator can act
 * on. The three posting-limit codes mean the post must stop and the user
 * try again later (Content Sharing Guidelines). sourceRef:
 * developers.tiktok.com/doc/content-posting-api-reference-query-creator-info
 */
const CREATOR_INFO_ERROR_MESSAGES: Record<string, string> = {
  spam_risk_too_many_posts:
    "This account has reached TikTok's daily posting limit. Please try again later.",
  spam_risk_user_banned_from_posting:
    "TikTok is not allowing this account to post right now. Please try again later.",
  reached_active_user_cap:
    "TikTok's daily publishing limit for Sharetopus is reached. Please try again later.",
  access_token_invalid:
    "Your TikTok connection has expired. Please reconnect the account.",
  scope_not_authorized:
    "This TikTok connection is missing the posting permission. Please reconnect the account.",
  rate_limit_exceeded:
    "TikTok is receiving too many requests. Please wait a minute and try again.",
};

/** Reads the TikTok error envelope from any response, 2xx or not. */
async function readCreatorInfoResponse(
  response: Response,
): Promise<CreatorInfoApiResponse | null> {
  try {
    return (await response.json()) as CreatorInfoApiResponse;
  } catch {
    return null;
  }
}

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

    // TikTok answers errors with a 4xx status AND the error envelope, so the
    // code is read before the status decides anything.
    const json = await readCreatorInfoResponse(response);
    const errorCode = json?.error?.code;

    if (!response.ok || (errorCode && errorCode !== "ok")) {
      console.error(
        "[getTikTokCreatorInfo] API error:",
        response.status,
        json?.error ?? "unreadable body",
      );
      return {
        success: false,
        message:
          (errorCode && CREATOR_INFO_ERROR_MESSAGES[errorCode]) ??
          json?.error?.message ??
          `TikTok API returned ${response.status}`,
      };
    }

    if (!json?.data) {
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
