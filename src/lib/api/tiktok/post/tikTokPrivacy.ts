import type { TikTokOptions, TikTokPrivacyLevel } from "@/lib/types/dbTypes";

const ENDPOINT_PRIVACY_LEVEL: TikTokPrivacyLevel = "PUBLIC_TO_EVERYONE";

export function resolveTikTokPrivacyLevel(
  tikTokOptions: TikTokOptions | undefined,
): TikTokPrivacyLevel {
  return tikTokOptions?.privacyLevel ?? ENDPOINT_PRIVACY_LEVEL;
}
