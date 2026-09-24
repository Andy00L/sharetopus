import { adminSupabase } from "@/actions/api/adminSupabase";
import { MEDIA_BUCKET } from "@/lib/storage/mediaBucket";
import "server-only";

/**
 * Server-side helper to generate a Supabase signed view URL.
 * Calls adminSupabase directly instead of going through the HTTP route
 * (which requires Clerk auth and is intended for browser callers).
 *
 * Returns: { success, url } or { success: false, message }.
 * Persists: nothing (the signed URL is ephemeral).
 */
export async function getServerSignedViewUrl(
  path: string,
  expiresInSeconds: number = 300,
): Promise<
  { success: true; url: string } | { success: false; message: string }
> {
  if (!path || path.trim() === "") {
    return {
      success: false,
      message: "[getServerSignedViewUrl] Path is empty",
    };
  }

  try {
    const { data, error } = await adminSupabase.storage
      .from(MEDIA_BUCKET)
      .createSignedUrl(path, expiresInSeconds);

    if (error) {
      console.error("[getServerSignedViewUrl] Supabase error:", error.message);
      return {
        success: false,
        message: `Failed to sign view URL: ${error.message}`,
      };
    }

    if (!data?.signedUrl) {
      return {
        success: false,
        message: "[getServerSignedViewUrl] Empty signed URL",
      };
    }

    return { success: true, url: data.signedUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[getServerSignedViewUrl] Unexpected error:", message);
    return { success: false, message: `[getServerSignedViewUrl] ${message}` };
  }
}
