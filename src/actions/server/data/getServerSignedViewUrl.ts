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

/**
 * getServerSignedViewUrl for many paths in one Storage call. Fails as a
 * whole when any path cannot be signed, so the caller never publishes a
 * post without its media.
 */
export async function getServerSignedViewUrls(
  paths: string[],
  expiresInSeconds: number = 300,
): Promise<
  | { success: true; urlByPath: Map<string, string> }
  | { success: false; message: string }
> {
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length === 0) {
    return { success: true, urlByPath: new Map() };
  }
  if (uniquePaths.some((path) => path.trim() === "")) {
    return { success: false, message: "[getServerSignedViewUrls] Path is empty" };
  }

  try {
    const { data, error } = await adminSupabase.storage
      .from(MEDIA_BUCKET)
      .createSignedUrls(uniquePaths, expiresInSeconds);

    if (error) {
      console.error("[getServerSignedViewUrls] Supabase error:", error.message);
      return {
        success: false,
        message: `Failed to sign view URLs: ${error.message}`,
      };
    }

    const urlByPath = new Map<string, string>();
    for (const signedEntry of data) {
      if (signedEntry.path && signedEntry.signedUrl && !signedEntry.error) {
        urlByPath.set(signedEntry.path, signedEntry.signedUrl);
      }
    }
    const unsignedPath = uniquePaths.find((path) => !urlByPath.has(path));
    if (unsignedPath !== undefined) {
      return {
        success: false,
        message: `[getServerSignedViewUrls] No signed URL for ${unsignedPath}`,
      };
    }
    return { success: true, urlByPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[getServerSignedViewUrls] Unexpected error:", message);
    return { success: false, message: `[getServerSignedViewUrls] ${message}` };
  }
}
