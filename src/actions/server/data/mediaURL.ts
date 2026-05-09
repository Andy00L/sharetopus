// app/lib/mediaURL.ts
import "server-only";
import { buildProxiedTikTokMediaUrl } from "@/lib/api/tiktok/buildProxiedTikTokMediaUrl";

/**
 * @deprecated Use buildTikTokMediaUrl (dual-mode) for new code.
 * This wrapper preserves the existing sync signature for callers
 * like handleSocialMediaPost that have not yet migrated.
 * See FIX 17.1 for migration details.
 */
export function createSecureMediaUrlSigned(
  filePath: string,
  userId: string
): string {
  const result = buildProxiedTikTokMediaUrl({
    mediaPath: filePath,
    principalId: userId,
  });
  if (!result.success) {
    console.error(
      "[createSecureMediaUrlSigned] Failed to build proxy URL:",
      result.message
    );
    return "";
  }
  return result.url;
}
