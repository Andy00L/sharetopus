import { adminSupabase } from "@/actions/api/adminSupabase";
import {
  classifyStorageReadError,
  type StorageReadFailureReason,
} from "@/actions/server/data/storageRead";
import { MEDIA_BUCKET } from "@/lib/storage/mediaBucket";
import "server-only";

export type SignedViewUrlResult =
  | { success: true; url: string }
  | { success: false; reason: StorageReadFailureReason; message: string };

export async function getServerSignedViewUrl(
  path: string,
  expiresInSeconds: number = 300,
): Promise<SignedViewUrlResult> {
  if (path.trim() === "") {
    return { success: false, reason: "not_found", message: "[getServerSignedViewUrl] Path is empty" };
  }

  try {
    const { data, error } = await adminSupabase.storage
      .from(MEDIA_BUCKET)
      .createSignedUrl(path, expiresInSeconds);

    if (error) {
      const reason = classifyStorageReadError(error);
      console.error(`[getServerSignedViewUrl] Supabase error (${reason}):`, error.message);
      return { success: false, reason, message: `Failed to sign view URL: ${error.message}` };
    }

    if (!data.signedUrl) {
      return { success: false, reason: "unavailable", message: "[getServerSignedViewUrl] Empty signed URL" };
    }

    return { success: true, url: data.signedUrl };
  } catch (signError) {
    const message = signError instanceof Error ? signError.message : String(signError);
    console.error("[getServerSignedViewUrl] Unexpected error:", message);
    return { success: false, reason: "unavailable", message: `[getServerSignedViewUrl] ${message}` };
  }
}

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
