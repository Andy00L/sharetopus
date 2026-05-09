import "server-only";

/**
 * Builds a proxied media URL for TikTok through the /api/media route.
 * TikTok fetches this URL, and the route streams bytes from Supabase
 * storage. Vercel is in the byte path.
 *
 * Returns: { success, url } or { success: false, message }.
 * Persists: nothing.
 */
export function buildProxiedTikTokMediaUrl(input: {
  mediaPath: string;
  principalId: string;
}): { success: true; url: string } | { success: false; message: string } {
  const { mediaPath, principalId } = input;

  if (!mediaPath) {
    return { success: false, message: "mediaPath is required" };
  }
  if (!principalId) {
    return { success: false, message: "principalId is required" };
  }

  const baseUrl =
    process.env.NODE_ENV === "production"
      ? "https://sharetopus.com/api/media"
      : "http://localhost:3000/api/media";

  const params = new URLSearchParams({ file: mediaPath, user: principalId });
  const url = `${baseUrl}?${params}`;

  console.log("[buildProxiedTikTokMediaUrl] Built proxy URL for TikTok");

  return { success: true, url };
}
