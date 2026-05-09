import "server-only";
import { adminSupabase } from "@/actions/api/adminSupabase";

/**
 * Builds a direct Supabase signed URL for TikTok using the operator's
 * custom storage domain. TikTok pulls directly from Supabase, bypassing
 * the /api/media proxy. Requires SUPABASE_CUSTOM_STORAGE_DOMAIN to be
 * set to a valid hostname (e.g., api.sharetopus.com).
 *
 * The signed URL has a default expiry of 3600 seconds (1 hour) to
 * outlive TikTok's async pull window.
 *
 * Returns: { success, url } or { success: false, message }.
 * Persists: nothing (the signed URL is ephemeral).
 */
export async function buildSupabaseDirectTikTokMediaUrl(input: {
  mediaPath: string;
  expiresInSeconds?: number;
  bucket?: string;
}): Promise<
  { success: true; url: string } | { success: false; message: string }
> {
  const {
    mediaPath,
    expiresInSeconds = 3600,
    bucket = "scheduled-videos",
  } = input;

  const customDomain = process.env.SUPABASE_CUSTOM_STORAGE_DOMAIN;

  if (!customDomain || customDomain.trim() === "") {
    return {
      success: false,
      message:
        "SUPABASE_CUSTOM_STORAGE_DOMAIN is not set. Cannot use supabase_direct mode.",
    };
  }

  // Defensive: strip protocol if operator accidentally includes it
  const cleanDomain = customDomain
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");

  if (!cleanDomain || cleanDomain.includes("/")) {
    return {
      success: false,
      message: `SUPABASE_CUSTOM_STORAGE_DOMAIN value "${customDomain}" is not a valid hostname`,
    };
  }

  const { data, error } = await adminSupabase.storage
    .from(bucket)
    .createSignedUrl(mediaPath, expiresInSeconds);

  if (error) {
    console.error(
      "[buildSupabaseDirectTikTokMediaUrl] Supabase signed URL error:",
      error.message
    );
    return {
      success: false,
      message: `Failed to create signed URL: ${error.message}`,
    };
  }

  if (!data?.signedUrl) {
    return {
      success: false,
      message: "Supabase returned no signed URL",
    };
  }

  // Rewrite the host portion to the custom domain while preserving
  // path and query (the signed token lives in the query string).
  try {
    const url = new URL(data.signedUrl);
    url.host = cleanDomain;
    url.protocol = "https:";
    const rewrittenUrl = url.toString();

    console.log(
      "[buildSupabaseDirectTikTokMediaUrl] Built direct Supabase URL on custom domain"
    );

    return { success: true, url: rewrittenUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      "[buildSupabaseDirectTikTokMediaUrl] URL rewrite failed:",
      message
    );
    return {
      success: false,
      message: `Failed to rewrite signed URL host: ${message}`,
    };
  }
}
