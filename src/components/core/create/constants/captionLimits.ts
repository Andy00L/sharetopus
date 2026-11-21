import type { Platform } from "@/db/schema";
import { getProviderMetadata } from "@/lib/platforms/providers/catalog";

/**
 * Max caption/description length per platform, in characters. sourceRefs:
 *   - x: 280 (standard tweet length, docs.x.com POST /2/tweets)
 *   - facebook: 63206 (Graph API page post message limit)
 *   - instagram: 2200 (Instagram caption limit)
 *   - linkedin: 3000 (ugcPosts shareCommentary limit)
 *   - pinterest: 500 (pin description limit)
 *   - tiktok: 2200 (video caption limit)
 *   - youtube: 5000 (video description limit, videos.insert)
 */
export const CAPTION_LIMITS = {
  default: 2200,
  x: 280,
  facebook: 63206,
  instagram: 2200,
  linkedin: 3000,
  pinterest: 500,
  tiktok: 2200,
  youtube: 5000,
} as const satisfies { default: number } & Partial<Record<Platform, number>>;

export type CaptionPlatform = keyof typeof CAPTION_LIMITS;

export function isCaptionPlatform(
  platform: string,
): platform is Exclude<CaptionPlatform, "default"> {
  return platform !== "default" && Object.hasOwn(CAPTION_LIMITS, platform);
}

export function resolvePlatformTextLimit(platform: string): number {
  if (isCaptionPlatform(platform)) {
    return CAPTION_LIMITS[platform];
  }
  const registryLimit = getProviderMetadata(platform)?.rules.maxTextLength;
  return registryLimit ?? CAPTION_LIMITS.default;
}
