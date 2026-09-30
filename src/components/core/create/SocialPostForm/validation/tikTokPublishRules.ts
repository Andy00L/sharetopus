import type { MediaType } from "@/db/schema";
import type {
  ClientSocialAccount,
  PrivacyLevel,
  TikTokOptions,
} from "@/lib/types/dbTypes";
import type { CreatorInfoData } from "../hooks/useTikTokCreatorInfo";

/**
 * TikTok's Content Sharing Guidelines for Direct Post, as the rules the
 * composer enforces before anything is sent to TikTok. The panel
 * (TikTokPostSettings), the publish button and the submit handler all read
 * these, so a rule lives in one place. sourceRef:
 * developers.tiktok.com/doc/content-sharing-guidelines (read 2026-09-30).
 */

/** Photo post title cap, in UTF-16 units (content-posting-api-reference-photo-post). */
export const TIKTOK_PHOTO_TITLE_MAX_LENGTH = 90;

/** Guideline wording: disclosure is on and neither option is picked. */
export const TIKTOK_DISCLOSURE_CHOICE_REQUIRED =
  "You need to indicate if your content promotes yourself, a third party, or both.";

/** Guideline wording: branded content cannot be posted as "Only me". */
export const TIKTOK_BRANDED_CONTENT_NOT_PRIVATE =
  "Branded content visibility cannot be set to private.";

/** What every selected TikTok account allows, combined into one set of controls. */
export type TikTokCapabilities = {
  /** Privacy options every account offers, in the first account's order. */
  privacyOptions: PrivacyLevel[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  /** The shortest video cap among the accounts, in seconds. */
  maxVideoDurationSec: number;
};

/**
 * Combines creator_info across accounts: a privacy option is offered only
 * when every account has it, and an interaction is off when any account
 * turned it off. Null until at least one account has loaded.
 */
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

/** "m:ss" for a duration in seconds (125 -> "2:05"). */
export function formatVideoDuration(totalSeconds: number): string {
  const wholeSeconds = Math.floor(totalSeconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** The name a creator recognizes: the TikTok nickname, then stored names. */
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

/**
 * The reason the post cannot go to TikTok yet, or null when it can. The
 * publish button stays disabled and shows this text while it is set.
 */
export function findTikTokPublishBlocker(params: {
  accounts: ClientSocialAccount[];
  creatorInfo: Record<string, CreatorInfoData>;
  isLoading: Record<string, boolean>;
  errors: Record<string, string | null>;
  capabilities: TikTokCapabilities | null;
  postType: MediaType;
  options: TikTokOptions;
  /** Null while the selected video's metadata has not loaded. */
  videoDurationSec: number | null;
  hasVideoFile: boolean;
  photoTitle: string;
}): string | null {
  const { accounts, creatorInfo, isLoading, errors, capabilities, options } =
    params;
  if (accounts.length === 0) return null;

  // creator_info must answer for every account before publishing: it
  // carries the posting limit, the privacy options and the duration cap.
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

/**
 * The options actually sent: an interaction the creator turned off in
 * TikTok stays off even if it was ticked before that account was added.
 */
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
