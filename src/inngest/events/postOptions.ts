import { z } from "zod";

import type { AdapterPlatform } from "@/lib/platforms/capabilities";
import type {
  PinterestPrivacyLevel,
  PlatformOptions,
  TikTokPrivacyLevel,
} from "@/lib/types/dbTypes";
import type { SchedulePostData } from "@/lib/types/SchedulePostData";

const TIKTOK_PRIVACY_LEVELS = {
  PUBLIC_TO_EVERYONE: "PUBLIC_TO_EVERYONE",
  MUTUAL_FOLLOW_FRIENDS: "MUTUAL_FOLLOW_FRIENDS",
  FOLLOWER_OF_CREATOR: "FOLLOWER_OF_CREATOR",
  SELF_ONLY: "SELF_ONLY",
} as const satisfies { [Level in TikTokPrivacyLevel]: Level };

const PINTEREST_PRIVACY_LEVELS = {
  PUBLIC: "PUBLIC",
  PROTECTED: "PROTECTED",
} as const satisfies { [Level in PinterestPrivacyLevel]: Level };

const TikTokPrivacyLevelSchema = z.enum(TIKTOK_PRIVACY_LEVELS);

const PinterestPrivacyLevelSchema = z.enum(PINTEREST_PRIVACY_LEVELS);

const StoredPrivacyLevelSchema = z.enum({
  ...TIKTOK_PRIVACY_LEVELS,
  ...PINTEREST_PRIVACY_LEVELS,
});

const YouTubePrivacyStatusSchema = z.enum(["public", "unlisted", "private"]);

export const PLATFORM_OPTION_DEFAULTS = {
  pinterestPrivacyLevel: "PUBLIC",
  linkedinVisibility: "PUBLIC",
  youtubePrivacyStatus: "public",
  tiktokInteractionDisabled: false,
} as const satisfies {
  pinterestPrivacyLevel: PinterestPrivacyLevel;
  linkedinVisibility: string;
  youtubePrivacyStatus: z.infer<typeof YouTubePrivacyStatusSchema>;
  tiktokInteractionDisabled: boolean;
};

export const PlatformOptionsSchema = z.object({
  tiktok: z
    .object({
      privacyLevel: TikTokPrivacyLevelSchema.optional(),
      disableComment: z.boolean().optional(),
      disableDuet: z.boolean().optional(),
      disableStitch: z.boolean().optional(),
      brandContentToggle: z.boolean().optional(),
      yourBrand: z.boolean().optional(),
      brandedContent: z.boolean().optional(),
      isAigc: z.boolean().optional(),
    })
    .optional(),
  pinterest: z
    .object({
      privacyLevel: PinterestPrivacyLevelSchema,
      board: z.string(),
      link: z.string(),
    })
    .optional(),
  linkedin: z.object({ visibility: z.string() }).optional(),
  youtube: z.object({ privacyStatus: YouTubePrivacyStatusSchema.optional() }).optional(),
}) satisfies z.ZodType<PlatformOptions>;

export const StoredPostOptionsSchema = z.object({
  link: z.string().nullish(),
  board: z.string().nullish(),
  boardName: z.string().nullish(),
  privacyLevel: StoredPrivacyLevelSchema.nullish(),
  visibility: z.string().nullish(),
  disableComment: z.boolean().nullish(),
  disableDuet: z.boolean().nullish(),
  disableStitch: z.boolean().nullish(),
  brandContentToggle: z.boolean().nullish(),
  yourBrand: z.boolean().nullish(),
  brandedContent: z.boolean().nullish(),
  isAigc: z.boolean().nullish(),
  privacyStatus: YouTubePrivacyStatusSchema.nullish(),
});

type StoredPostOptions = z.infer<typeof StoredPostOptionsSchema>;

export type PinterestBoardChoice = { boardId: string; boardName: string | null };

export type DecodedPostOptions = {
  platformOptions: PlatformOptions;
  pinterestBoard: PinterestBoardChoice | null;
  link: string;
};

export type DecodePostOptionsResult =
  | { ok: true; decoded: DecodedPostOptions }
  | { ok: false; invalidKeys: string[] };

function toPlatformOptions(options: StoredPostOptions): PlatformOptions {
  const pinterestPrivacy = PinterestPrivacyLevelSchema.safeParse(options.privacyLevel);
  const tikTokPrivacy = TikTokPrivacyLevelSchema.safeParse(options.privacyLevel);
  return {
    pinterest: {
      privacyLevel: pinterestPrivacy.success
        ? pinterestPrivacy.data
        : PLATFORM_OPTION_DEFAULTS.pinterestPrivacyLevel,
      board: options.board ?? "",
      link: options.link ?? "",
    },
    linkedin: {
      visibility: options.visibility ?? PLATFORM_OPTION_DEFAULTS.linkedinVisibility,
    },
    tiktok: {
      privacyLevel: tikTokPrivacy.success ? tikTokPrivacy.data : undefined,
      disableComment: options.disableComment ?? PLATFORM_OPTION_DEFAULTS.tiktokInteractionDisabled,
      disableDuet: options.disableDuet ?? PLATFORM_OPTION_DEFAULTS.tiktokInteractionDisabled,
      disableStitch: options.disableStitch ?? PLATFORM_OPTION_DEFAULTS.tiktokInteractionDisabled,
      brandContentToggle: options.brandContentToggle ?? undefined,
      yourBrand: options.yourBrand ?? undefined,
      brandedContent: options.brandedContent ?? undefined,
      isAigc: options.isAigc ?? undefined,
    },
    youtube: {
      privacyStatus: options.privacyStatus ?? PLATFORM_OPTION_DEFAULTS.youtubePrivacyStatus,
    },
  };
}

export function decodeStoredPostOptions(storedOptions: unknown): DecodePostOptionsResult {
  const parsedOptions = StoredPostOptionsSchema.safeParse(storedOptions ?? {});
  if (!parsedOptions.success) {
    return {
      ok: false,
      invalidKeys: parsedOptions.error.issues.map((issue) => issue.path.join(".")),
    };
  }
  const options = parsedOptions.data;
  return {
    ok: true,
    decoded: {
      platformOptions: toPlatformOptions(options),
      pinterestBoard: options.board
        ? { boardId: options.board, boardName: options.boardName ?? null }
        : null,
      link: options.link ?? "",
    },
  };
}

export function buildDefaultPlatformOptions(input: {
  pinterestBoardId: string | undefined;
  link: string | undefined;
}): PlatformOptions {
  return toPlatformOptions({ board: input.pinterestBoardId, link: input.link });
}

export function encodeFormPostOptions(input: {
  platform: AdapterPlatform;
  link: string;
  platformOptions: PlatformOptions;
  pinterestBoard: { boardId: string; boardName: string } | null;
}): SchedulePostData["postOptions"] {
  const { platformOptions } = input;
  switch (input.platform) {
    case "pinterest":
      return {
        privacyLevel:
          platformOptions.pinterest?.privacyLevel ?? PLATFORM_OPTION_DEFAULTS.pinterestPrivacyLevel,
        board: input.pinterestBoard?.boardId ?? "",
        boardName: input.pinterestBoard?.boardName ?? "",
        link: input.link,
      };
    case "linkedin":
      return {
        link: input.link || undefined,
        visibility: platformOptions.linkedin?.visibility ?? PLATFORM_OPTION_DEFAULTS.linkedinVisibility,
      };
    case "tiktok":
      return platformOptions.tiktok ?? null;
    case "youtube":
      return {
        privacyStatus:
          platformOptions.youtube?.privacyStatus ?? PLATFORM_OPTION_DEFAULTS.youtubePrivacyStatus,
      };
    case "instagram":
    case "x":
    case "facebook":
      return null;
    default: {
      const unhandledPlatform: never = input.platform;
      return unhandledPlatform;
    }
  }
}
