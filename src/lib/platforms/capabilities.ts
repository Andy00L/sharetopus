import type { MediaType, Platform } from "@/db/schema";

import {
  getProviderMetadata,
  REGISTRY_PLATFORM_IDS,
} from "@/lib/platforms/providers/catalog";

export const ADAPTER_PLATFORMS = [
  "linkedin",
  "tiktok",
  "pinterest",
  "instagram",
  "youtube",
  "x",
  "facebook",
] as const satisfies readonly Platform[];

export type AdapterPlatform = (typeof ADAPTER_PLATFORMS)[number];

/** @deprecated Use ADAPTER_PLATFORMS. */
export const POSTING_PLATFORMS = ADAPTER_PLATFORMS;

/** @deprecated Use AdapterPlatform. */
export type PostingPlatform = AdapterPlatform;

export const PLATFORM_LABELS: Record<AdapterPlatform, string> = {
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
const PLATFORM_MEDIA_SUPPORT: Record<AdapterPlatform, readonly MediaType[]> = {
  linkedin: ["text", "image", "video"],
  tiktok: ["image", "video"],
  pinterest: ["image", "video"],
  instagram: ["image", "video"],
  youtube: ["video"],
  x: ["text", "image", "video"],
  facebook: ["text", "image", "video"],
};

export function isAdapterPlatform(value: string): value is AdapterPlatform {
  return ADAPTER_PLATFORMS.some((platform) => platform === value);
}

/** @deprecated Use isAdapterPlatform. */
export const isPostingPlatform = isAdapterPlatform;

export const SCHEDULABLE_PLATFORMS = [
  ...ADAPTER_PLATFORMS,
  ...REGISTRY_PLATFORM_IDS,
] as const satisfies readonly Platform[];

export type SchedulablePlatform = (typeof SCHEDULABLE_PLATFORMS)[number];

export function isSchedulablePlatform(
  value: string,
): value is SchedulablePlatform {
  return SCHEDULABLE_PLATFORMS.some((platform) => platform === value);
}

export function platformSupportsMediaType(
  platform: string,
  mediaType: MediaType,
): boolean {
  if (isAdapterPlatform(platform)) {
    return PLATFORM_MEDIA_SUPPORT[platform].includes(mediaType);
  }
  const registryMetadata = getProviderMetadata(platform);
  if (registryMetadata) {
    return registryMetadata.rules.supportedMediaTypes.includes(mediaType);
  }
  return false;
}

export function platformHotlinksMedia(platform: string): boolean {
  const registryMetadata = getProviderMetadata(platform);
  return registryMetadata?.rules.hotlinksMedia === true;
}

export function platformRequiresTitle(platform: string): boolean {
  return getProviderMetadata(platform)?.rules.titleRequired === true;
}

export function listPlatformsSupportingMediaType(
  mediaType: MediaType,
): AdapterPlatform[] {
  return ADAPTER_PLATFORMS.filter((platform) =>
    PLATFORM_MEDIA_SUPPORT[platform].includes(mediaType),
  );
}

export function getPlatformDisplayLabel(platform: string): string {
  if (isAdapterPlatform(platform)) {
    return PLATFORM_LABELS[platform];
  }
  return getProviderMetadata(platform)?.label ?? platform;
}
