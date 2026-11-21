import "server-only";
import { buildProxiedTikTokMediaUrl } from "./buildProxiedTikTokMediaUrl";
import { buildSupabaseDirectTikTokMediaUrl } from "./buildSupabaseDirectTikTokMediaUrl";

type TikTokMediaMode = "proxy" | "supabase_direct";

type BuildTikTokMediaUrlResult =
  | { success: true; url: string; mode: TikTokMediaMode }
  | { success: false; message: string };

export async function buildTikTokMediaUrl(input: {
  mediaPath: string;
  principalId: string;
  expiresInSeconds?: number;
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

  const result = await buildSupabaseDirectTikTokMediaUrl({
    mediaPath: input.mediaPath,
    expiresInSeconds: input.expiresInSeconds,
  });
  if (!result.success) {
    return result;
  }
  return { success: true, url: result.url, mode: "supabase_direct" };
}
