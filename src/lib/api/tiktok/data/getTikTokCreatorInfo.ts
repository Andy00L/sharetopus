import "server-only";

import { z } from "zod";

import {
  classifyPlatformHttpFailure,
  type PlatformFailure,
} from "@/lib/api/_shared/platformFailure";
import { PLATFORM_API_TIMEOUT_MS } from "@/lib/api/_shared/platformFetchTimeouts";
import { describeNetworkError } from "@/lib/net/describeNetworkError";
import { parseJsonObject } from "@/lib/platforms/providers/_shared/providerFetch";
import type { TikTokPrivacyLevel } from "@/lib/types/dbTypes";

export type CreatorInfoData = {
  creator_avatar_url: string;
  creator_username: string;
  creator_nickname: string;
  privacy_level_options: TikTokPrivacyLevel[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
};

// The privacy levels creator_info returns: https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info
const TikTokPrivacyLevelSchema = z.enum([
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
]);

const CreatorInfoDataSchema = z.object({
  creator_avatar_url: z.string(),
  creator_username: z.string(),
  creator_nickname: z.string(),
  privacy_level_options: z.array(z.string()).transform((levels) =>
    levels.flatMap((level) => {
      const knownLevel = TikTokPrivacyLevelSchema.safeParse(level);
      return knownLevel.success ? [knownLevel.data] : [];
    }),
  ),
  comment_disabled: z.boolean(),
  duet_disabled: z.boolean(),
  stitch_disabled: z.boolean(),
  max_video_post_duration_sec: z.number(),
});

const CreatorInfoResponseSchema = z.object({
  data: z.unknown().optional(),
  error: z
    .object({ code: z.string(), message: z.string() })
    .partial()
    .optional(),
});

type GetCreatorInfoResult =
  | { success: true; data: CreatorInfoData }
  | { success: false; message: string; failure: PlatformFailure };

// creator_info error codes: https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info
// When creator_info says the creator cannot post now, "API Clients must stop the
// current publishing attempt and prompt users to try again later":
// https://developers.tiktok.com/doc/content-sharing-guidelines
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

export async function getTikTokCreatorInfo(
  accessToken: string
): Promise<GetCreatorInfoResult> {
  if (!accessToken) {
    console.error("[getTikTokCreatorInfo] Missing access token");
    return {
      success: false,
      message: "Missing TikTok access token",
      failure: { reason: "auth_expired", mayHavePublished: false },
    };
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
        signal: AbortSignal.timeout(PLATFORM_API_TIMEOUT_MS),
      }
    );

    const responseText = await response.text();
    const parsedEnvelope = CreatorInfoResponseSchema.safeParse(
      parseJsonObject(responseText),
    );
    const envelope = parsedEnvelope.success ? parsedEnvelope.data : null;
    const errorCode = envelope?.error?.code;

    if (!response.ok || (errorCode && errorCode !== "ok")) {
      console.error(
        "[getTikTokCreatorInfo] API error:",
        response.status,
        envelope?.error ?? "unreadable body",
      );
      const classification = classifyPlatformHttpFailure({
        platform: "tiktok",
        httpStatus: response.status,
        responseText,
      });
      return {
        success: false,
        message:
          (errorCode && CREATOR_INFO_ERROR_MESSAGES[errorCode]) ??
          envelope?.error?.message ??
          `TikTok API returned ${response.status}`,
        failure: { reason: classification.reason, mayHavePublished: false },
      };
    }

    const creatorInfo = CreatorInfoDataSchema.safeParse(envelope?.data);
    if (!creatorInfo.success) {
      console.error("[getTikTokCreatorInfo] No usable data in response");
      return {
        success: false,
        message: "No creator info data returned",
        failure: { reason: "unknown", mayHavePublished: false },
      };
    }

    return { success: true, data: creatorInfo.data };
  } catch (requestError) {
    const message = describeNetworkError(requestError);
    console.error("[getTikTokCreatorInfo] Request failed:", message);
    return {
      success: false,
      message: `Failed to fetch creator info: ${message}`,
      failure: { reason: "transient", mayHavePublished: false },
    };
  }
}
