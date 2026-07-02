import type { MediaType, Platform } from "@/lib/types/database.types";

/**
 * Single source of truth for which platforms the app can post to and what
 * media each one accepts. Client-safe on purpose (no "server-only"): the
 * create form and the account selector read it, and so do the Inngest
 * workers, the REST schemas, and the MCP tool schemas.
 *
 * Before this module, the same knowledge was inlined in
 * processSinglePostHelpers.checkPlatformCompatibility, AccountSelector,
 * the REST post schema superRefine, and the create page. Those all read
 * from here now.
 *
 * PostingPlatform is Extract-ed from the DB Platform union
 * (src/lib/types/database.types.ts, Platform alias) so a platform removed
 * from the schema fails compilation here. "threads" is in the DB union but
 * has no posting implementation yet, so it is not listed.
 */
export type PostingPlatform = Extract<
  Platform,
  | "linkedin"
  | "tiktok"
  | "pinterest"
  | "instagram"
  | "youtube"
  | "x"
  | "facebook"
>;

/**
 * Typed as a union tuple (not a literal tuple) on purpose: z.enum() call
 * sites in the MCP tools otherwise push the SDK's schema inference past
 * the TS instantiation-depth limit (TS2589).
 */
export const POSTING_PLATFORMS: readonly [
  PostingPlatform,
  ...PostingPlatform[],
] = [
  "linkedin",
  "tiktok",
  "pinterest",
  "instagram",
  "youtube",
  "x",
  "facebook",
];

/** Display names for UI copy. Keyed by the DB platform value. */
export const PLATFORM_LABELS: Record<PostingPlatform, string> = {
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  instagram: "Instagram",
  youtube: "YouTube",
  x: "X (Twitter)",
  facebook: "Facebook",
};

/**
 * Media types each platform accepts.
 *   - linkedin: text, image, video (ugcPosts accepts all three)
 *   - tiktok / pinterest / instagram: media only (no text-only posts)
 *   - youtube: video only (videos.insert is the only publish surface)
 *   - x: text, image, video (POST /2/tweets with optional media ids)
 *   - facebook: text (/feed), image (/photos), video (/videos) on Pages
 */
const PLATFORM_MEDIA_SUPPORT: Record<PostingPlatform, readonly MediaType[]> = {
  linkedin: ["text", "image", "video"],
  tiktok: ["image", "video"],
  pinterest: ["image", "video"],
  instagram: ["image", "video"],
  youtube: ["video"],
  x: ["text", "image", "video"],
  facebook: ["text", "image", "video"],
};

/** Type guard for arbitrary strings (query params, DB reads). */
export function isPostingPlatform(value: string): value is PostingPlatform {
  return (POSTING_PLATFORMS as readonly string[]).includes(value);
}

/**
 * Whether a platform accepts the given media type. Unknown platforms
 * (e.g. "threads", which is in the DB union but not implemented) report
 * false for everything so callers fail closed.
 */
export function platformSupportsMediaType(
  platform: string,
  mediaType: MediaType,
): boolean {
  if (!isPostingPlatform(platform)) return false;
  return PLATFORM_MEDIA_SUPPORT[platform].includes(mediaType);
}

/** Platforms that accept the given media type, in POSTING_PLATFORMS order. */
export function listPlatformsSupportingMediaType(
  mediaType: MediaType,
): PostingPlatform[] {
  return POSTING_PLATFORMS.filter((platform) =>
    PLATFORM_MEDIA_SUPPORT[platform].includes(mediaType),
  );
}
