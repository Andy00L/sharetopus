import type { PrivacyLevel, TikTokOptions } from "@/lib/types/dbTypes";

const ENDPOINT_PRIVACY_LEVEL: PrivacyLevel = "PUBLIC_TO_EVERYONE";

export function resolveTikTokPrivacyLevel(
  tikTokOptions: TikTokOptions | undefined,
): PrivacyLevel {
  return tikTokOptions?.privacyLevel ?? ENDPOINT_PRIVACY_LEVEL;
}
