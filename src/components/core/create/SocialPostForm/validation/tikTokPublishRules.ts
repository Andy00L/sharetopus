import type { MediaType } from "@/db/schema";
import type {
  ClientSocialAccount,
  PrivacyLevel,
  TikTokOptions,
} from "@/lib/types/dbTypes";
import type { CreatorInfoData } from "../hooks/useTikTokCreatorInfo";

// Rules from TikTok's Content Sharing Guidelines for Direct Post:
// developers.tiktok.com/doc/content-sharing-guidelines (revision of 2026-08-04, read 2026-11-21).

/** Photo post title cap, in UTF-16 units (content-posting-api-reference-photo-post). */
export const TIKTOK_PHOTO_TITLE_MAX_LENGTH = 90;

/** Guideline wording: disclosure is on and neither option is picked. */
export const TIKTOK_DISCLOSURE_CHOICE_REQUIRED =
  "You need to indicate if your content promotes yourself, a third party, or both.";

/** Guideline wording: branded content cannot be posted as "Only me". */
export const TIKTOK_BRANDED_CONTENT_NOT_PRIVATE =
  "Branded content visibility cannot be set to private.";

export type TikTokCapabilities = {
  privacyOptions: PrivacyLevel[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoDurationSec: number;
};

export function combineCreatorCapabilities(
  creatorInfos: CreatorInfoData[],
): TikTokCapabilities | null {
  const [firstInfo, ...otherInfos] = creatorInfos;
  if (!firstInfo) return null;

  return {
    privacyOptions: firstInfo.privacy_level_options.filter((option) =>
      otherInfos.every((info) => info.privacy_level_options.includes(option)),
    ),
    commentDisabled: creatorInfos.some((info) => info.comment_disabled),
    duetDisabled: creatorInfos.some((info) => info.duet_disabled),
    stitchDisabled: creatorInfos.some((info) => info.stitch_disabled),
    maxVideoDurationSec: Math.min(
      ...creatorInfos.map((info) => info.max_video_post_duration_sec),
    ),
  };
}

export function formatVideoDuration(totalSeconds: number): string {
  const wholeSeconds = Math.floor(totalSeconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function describeTikTokAccount(
  account: ClientSocialAccount,
  creatorInfo: CreatorInfoData | undefined,
): string {
  return (
    creatorInfo?.creator_nickname ??
    account.display_name ??
    account.username ??
    "your TikTok account"
  );
}

export function findTikTokPublishBlocker(params: {
  accounts: ClientSocialAccount[];
  creatorInfo: Record<string, CreatorInfoData>;
  isLoading: Record<string, boolean>;
  errors: Record<string, string | null>;
  capabilities: TikTokCapabilities | null;
  postType: MediaType;
  options: TikTokOptions;
  videoDurationSec: number | null;
  hasVideoFile: boolean;
  photoTitle: string;
}): string | null {
  const { accounts, creatorInfo, isLoading, errors, capabilities, options } =
    params;
  if (accounts.length === 0) return null;

  for (const account of accounts) {
    const accountName = describeTikTokAccount(account, creatorInfo[account.id]);
    const accountError = errors[account.id];
    if (accountError) return `${accountName}: ${accountError}`;
    if (isLoading[account.id] || !creatorInfo[account.id]) {
      return `Loading TikTok settings for ${accountName}...`;
    }
  }
  if (!capabilities) return "Loading TikTok settings...";

  if (params.postType === "video" && params.hasVideoFile) {
    if (params.videoDurationSec === null) {
      return "Checking the video length for TikTok...";
    }
    if (params.videoDurationSec > capabilities.maxVideoDurationSec) {
      const accountScope =
        accounts.length === 1 ? "this account" : "the selected accounts";
      return `This video is ${formatVideoDuration(params.videoDurationSec)} long. TikTok accepts up to ${formatVideoDuration(capabilities.maxVideoDurationSec)} for ${accountScope}.`;
    }
  }

  if (
    params.postType === "image" &&
    params.photoTitle.length > TIKTOK_PHOTO_TITLE_MAX_LENGTH
  ) {
    return `TikTok photo titles can be up to ${TIKTOK_PHOTO_TITLE_MAX_LENGTH} characters.`;
  }

  if (
    !options.privacyLevel ||
    !capabilities.privacyOptions.includes(options.privacyLevel)
  ) {
    return "Choose who can view this post on TikTok.";
  }

  if (
    options.brandContentToggle === true &&
    options.yourBrand !== true &&
    options.brandedContent !== true
  ) {
    return TIKTOK_DISCLOSURE_CHOICE_REQUIRED;
  }

  if (options.brandedContent === true && options.privacyLevel === "SELF_ONLY") {
    return TIKTOK_BRANDED_CONTENT_NOT_PRIVATE;
  }

  return null;
}

export function applyCreatorRestrictions(
  options: TikTokOptions,
  capabilities: TikTokCapabilities | null,
): TikTokOptions {
  if (!capabilities) return options;
  return {
    ...options,
    disableComment: capabilities.commentDisabled || options.disableComment,
    disableDuet: capabilities.duetDisabled || options.disableDuet,
    disableStitch: capabilities.stitchDisabled || options.disableStitch,
  };
}
