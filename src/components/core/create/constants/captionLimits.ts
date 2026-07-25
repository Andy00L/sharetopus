import { getProviderMetadata } from "@/lib/platforms/providers/catalog";

/**
 * Max caption/description length per platform, in characters. Keys are the
 * DB platform values (database.types.ts Platform alias): lookups everywhere
 * use `CAPTION_LIMITS[post.platform]`, so a key that is not a DB platform
 * value is unreachable. sourceRefs:
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
} as const;

export type CaptionPlatform = keyof typeof CAPTION_LIMITS;

/**
 * Text limit for any platform value: legacy platforms answer from the map
 * above, registry providers from their catalog rules (maxTextLength), and
 * everything else falls back to the default. Character counts here are
 * plain string lengths; platform-weighted counting (X counts every URL as
 * 23) is deliberately not modeled, so treat near-limit values as a warning
 * rather than a guarantee.
 */
export function resolvePlatformTextLimit(platform: string): number {
  if (platform !== "default" && platform in CAPTION_LIMITS) {
    return CAPTION_LIMITS[platform as CaptionPlatform];
  }
  const registryLimit = getProviderMetadata(platform)?.rules.maxTextLength;
  return registryLimit ?? CAPTION_LIMITS.default;
}
