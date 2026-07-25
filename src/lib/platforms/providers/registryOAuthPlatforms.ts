import type { Database } from "@/lib/types/database.types";

/**
 * Registry providers that connect through OAuth, typed against the DB
 * platform union so a provider id that drifts from the schema fails
 * compilation instead of failing at insert time.
 *
 * Client-safe: a constant and a guard, nothing else.
 */

type SocialAccountPlatform =
  Database["public"]["Tables"]["social_accounts"]["Insert"]["platform"];

export const REGISTRY_OAUTH_PLATFORM_IDS = [
  "reddit",
  "threads",
  "tumblr",
  "twitch",
  "kick",
  "linkedin_page",
  "dribbble",
  "gmb",
] as const satisfies readonly SocialAccountPlatform[];

export type RegistryOAuthPlatform =
  (typeof REGISTRY_OAUTH_PLATFORM_IDS)[number];

export function isRegistryOAuthPlatform(
  value: string,
): value is RegistryOAuthPlatform {
  return (REGISTRY_OAUTH_PLATFORM_IDS as readonly string[]).includes(value);
}
