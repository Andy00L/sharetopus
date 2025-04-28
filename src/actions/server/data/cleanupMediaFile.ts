import { deleteSupabaseFileAction } from "@/actions/server/data/deleteSupabaseFileAction";

/**
 * Helper function to clean up a media file from Supabase storage
 */
export async function cleanupMediaFile(
  mediaPath: string,
  userId: string | null
): Promise<void> {
  if (!userId) {
    console.log(
      "[LinkedIn Direct Post] Cannot clean up file: No user ID provided"
    );
    return;
  }

  try {
    console.log(
      `[LinkedIn Direct Post] Cleaning up temporary file: ${mediaPath}`
    );

    const result = await deleteSupabaseFileAction(userId, mediaPath, true);

    if (result.success) {
      console.log(
        `[LinkedIn Direct Post] File cleanup successful: ${mediaPath}`
      );
    } else {
      console.warn(
        `[LinkedIn Direct Post] File cleanup failed: ${result.message}`
      );
    }
  } catch (error) {
    console.error("[LinkedIn Direct Post] Error during file cleanup:", error);
  }
}
