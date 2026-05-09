import "server-only";
import { buildProxiedTikTokMediaUrl } from "./buildProxiedTikTokMediaUrl";
import { buildSupabaseDirectTikTokMediaUrl } from "./buildSupabaseDirectTikTokMediaUrl";

type TikTokMediaMode = "proxy" | "supabase_direct";

type BuildTikTokMediaUrlResult =
  | { success: true; url: string; mode: TikTokMediaMode }
  | { success: false; message: string };

/**
 * Dual-mode TikTok media URL builder. Reads TIKTOK_MEDIA_SOURCE env var
 * to select the mode:
 *   - "proxy" (default): routes through /api/media (Vercel streams bytes)
 *   - "supabase_direct": routes to Supabase Custom Domain (bypasses Vercel)
 *
 * If TIKTOK_MEDIA_SOURCE=supabase_direct but SUPABASE_CUSTOM_STORAGE_DOMAIN
 * is empty, returns a clean error. Does NOT silently fall back to proxy
 * (that would mask misconfiguration).
 *
 * Returns: { success, url, mode } or { success: false, message }.
 * Persists: nothing.
 */
export async function buildTikTokMediaUrl(input: {
  mediaPath: string;
  principalId: string;
  expiresInSeconds?: number;
  bucket?: string;
}): Promise<BuildTikTokMediaUrlResult> {
  const rawMode = process.env.TIKTOK_MEDIA_SOURCE ?? "proxy";
  const mode = rawMode.trim().toLowerCase();

  if (mode !== "proxy" && mode !== "supabase_direct") {
    return {
      success: false,
      message: `Invalid TIKTOK_MEDIA_SOURCE: "${rawMode}". Expected "proxy" or "supabase_direct".`,
    };
  }

  console.log(
    `[buildTikTokMediaUrl] Resolving TikTok media URL in "${mode}" mode`
  );

  if (mode === "proxy") {
    const result = buildProxiedTikTokMediaUrl({
      mediaPath: input.mediaPath,
      principalId: input.principalId,
    });
    if (!result.success) {
      return result;
    }
    return { success: true, url: result.url, mode: "proxy" };
  }

  // supabase_direct mode
  const result = await buildSupabaseDirectTikTokMediaUrl({
    mediaPath: input.mediaPath,
    expiresInSeconds: input.expiresInSeconds,
    bucket: input.bucket,
  });
  if (!result.success) {
    return result;
  }
  return { success: true, url: result.url, mode: "supabase_direct" };
}
