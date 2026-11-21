import { adminSupabase } from "@/actions/api/adminSupabase";
import {
  classifyStorageReadError,
  STORAGE_READ_TIMEOUT_MS,
  type StorageReadFailureReason,
} from "@/actions/server/data/storageRead";
import { MEDIA_BUCKET } from "@/lib/storage/mediaBucket";
import { isOwnedMediaPath } from "@/lib/storage/mediaPath";
import "server-only";

export type StoredFileResult =
  | { success: true; buffer: Buffer }
  | { success: false; reason: StorageReadFailureReason; message: string };

export async function getSupabaseVideoFile(
  filePath: string,
  userId: string | null,
): Promise<StoredFileResult> {
  if (!isOwnedMediaPath(filePath, userId ?? "")) {
    console.warn(
      `[getSupabaseVideoFile] Refused a path outside the caller's folder for user ${userId}: ${filePath}`,
    );
    return { success: false, reason: "not_found", message: "Invalid file path or unauthorized access." };
  }

  try {
    console.log(`[getSupabaseVideoFile] Fetching file for user ${userId}: ${filePath}`);

    const { data, error } = await adminSupabase.storage
      .from(MEDIA_BUCKET)
      .download(filePath, undefined, { signal: AbortSignal.timeout(STORAGE_READ_TIMEOUT_MS) });

    if (error) {
      const reason = classifyStorageReadError(error);
      console.error(
        `[getSupabaseVideoFile] Supabase download error (${reason}) for path ${filePath}:`,
        error.message,
      );
      return { success: false, reason, message: `Failed to download file: ${error.message}` };
    }

    const buffer = Buffer.from(await data.arrayBuffer());

    console.log(`[getSupabaseVideoFile] Retrieved file: ${filePath} (${buffer.length} bytes)`);
    return { success: true, buffer };
  } catch (downloadError) {
    const message =
      downloadError instanceof Error ? downloadError.message : "Unexpected error retrieving file";
    console.error(`[getSupabaseVideoFile] Unexpected error retrieving ${filePath}:`, message);
    return { success: false, reason: "unavailable", message };
  }
}
