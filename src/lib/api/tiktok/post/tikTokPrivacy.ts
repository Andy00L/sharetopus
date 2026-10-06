import type { PrivacyLevel, TikTokOptions } from "@/lib/types/dbTypes";

// API, MCP and x402 posts carry no privacy choice and always go out public.
const ENDPOINT_PRIVACY_LEVEL: PrivacyLevel = "PUBLIC_TO_EVERYONE";

/** Privacy sent to TikTok: the level the creator picked in the web composer, else public. */
export function resolveTikTokPrivacyLevel(
  tikTokOptions: TikTokOptions | undefined,
): PrivacyLevel {
  return tikTokOptions?.privacyLevel ?? ENDPOINT_PRIVACY_LEVEL;
}
