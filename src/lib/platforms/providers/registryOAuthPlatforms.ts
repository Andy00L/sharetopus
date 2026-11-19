import type { Platform } from "@/db/schema";

export const REGISTRY_OAUTH_PLATFORM_IDS = [
  "reddit",
  "threads",
  "tumblr",
  "twitch",
  "kick",
  "linkedin_page",
  "dribbble",
  "gmb",
] as const satisfies readonly Platform[];

export type RegistryOAuthPlatform =
  (typeof REGISTRY_OAUTH_PLATFORM_IDS)[number];

export function isRegistryOAuthPlatform(
  value: string,
): value is RegistryOAuthPlatform {
  return REGISTRY_OAUTH_PLATFORM_IDS.some((platformId) => platformId === value);
}
