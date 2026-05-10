import "server-only";
import { createHmac } from "crypto";

/**
 * Builds an HMAC-signed proxied media URL for TikTok through the /api/media
 * route. TikTok fetches this URL, and the route verifies the signature and
 * expiry before streaming bytes from Supabase storage.
 *
 * The URL includes an HMAC-SHA256 signature over `userId:filePath:expires`
 * and a 30-minute expiry timestamp.
 *
 * Returns: { success, url, expiresAt } or { success: false, message }.
 * Persists: nothing.
 */
export function buildProxiedTikTokMediaUrl(input: {
  mediaPath: string;
  principalId: string;
}):
  | { success: true; url: string; expiresAt: number }
  | { success: false; message: string } {
  const { mediaPath, principalId } = input;

  if (!mediaPath) {
    return { success: false, message: "mediaPath is required" };
  }
  if (!principalId) {
    return { success: false, message: "principalId is required" };
  }

  const secret = process.env.MEDIA_PROXY_HMAC_SECRET;
  if (!secret) {
    console.error(
      "[buildProxiedTikTokMediaUrl] MEDIA_PROXY_HMAC_SECRET not configured"
    );
    return {
      success: false,
      message:
        "[buildProxiedTikTokMediaUrl] MEDIA_PROXY_HMAC_SECRET not configured",
    };
  }

  const baseUrl =
    process.env.NODE_ENV === "production"
      ? "https://sharetopus.com/api/media"
      : "http://localhost:3000/api/media";

  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60;
  const payload = `${principalId}:${mediaPath}:${expiresAt}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");

  const params = new URLSearchParams({
    file: mediaPath,
    user: principalId,
    expires: String(expiresAt),
    sig,
  });
  const url = `${baseUrl}?${params}`;

  console.log("[buildProxiedTikTokMediaUrl] Signed proxy URL", {
    user: principalId,
    file: mediaPath,
    expiresAt,
  });

  return { success: true, url, expiresAt };
}
