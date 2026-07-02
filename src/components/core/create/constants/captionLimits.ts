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
