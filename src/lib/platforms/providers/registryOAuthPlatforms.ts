import type { Platform } from "@/db/schema";

/**
 * Registry providers that connect through OAuth, typed against the DB
 * platform union (social_accounts.platform) so a provider id that drifts
 * from the schema fails compilation instead of failing at insert time.
 *
 * Client-safe: a constant and a guard, nothing else. The schema import is
 * type-only and erased from the bundle.
 */

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
  return (REGISTRY_OAUTH_PLATFORM_IDS as readonly string[]).includes(value);
}
