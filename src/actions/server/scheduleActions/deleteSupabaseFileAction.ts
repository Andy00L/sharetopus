"use server";
import { adminSupabase } from "@/actions/api/supabase-client";

/**
 * Delete a file or folder from Supabase Storage
 *
 * @param filePath Path to the file in Supabase Storage, optional if deleting entire user folder
 * @param userId ID of the authenticated user
 * @returns Object with success status and message
 */
export async function deleteSupabaseFileAction(
  userId: string | null,
  filePath?: string | null
): Promise<{ success: boolean; message: string }> {
  if (!userId) {
    return { success: false, message: "User not authenticated." };
  }

  try {
    // Case 1: Only userId is provided - delete the entire user folder
    if (!filePath) {
      console.log(
        `[Delete Supabase File Action] Deleting entire folder for user ${userId}`
      );

      // First, list all files with the user ID prefix
      const { data: fileList, error: listError } = await adminSupabase.storage
        .from("scheduled-videos")
        .list(userId);

      if (listError) {
        console.error(
          `[Delete Supabase File Action] Error listing files for user ${userId}:`,
          listError
        );
        return {
          success: false,
          message: `Failed to list user files.`,
        };
      }

      // If there are no files, we're done
      if (!fileList || fileList.length === 0) {
        console.log(
          `[Delete Supabase File Action] No files found for user ${userId}`
        );
        return { success: true, message: "No files to delete." };
      }

      // Prepare paths for batch deletion (prepend user ID to each file name)
      const filesToDelete = fileList.map((file) => `${userId}/${file.name}`);

      console.log(
        `[Delete Supabase File Action] Deleting ${filesToDelete.length} files for user ${userId}`
      );

      // Delete all files in a batch operation
      const { error: deleteError } = await adminSupabase.storage
        .from("scheduled-videos")
        .remove(filesToDelete);

      if (deleteError) {
        console.error(
          `[Delete Supabase File Action] Error batch deleting files for user ${userId}:`,
          deleteError
        );
        return {
          success: false,
          message: `Failed to delete user files.`,
        };
      }

      console.log(
        `[Delete Supabase File Action] All user files deleted successfully: ${userId}`
      );
      return { success: true, message: "All user files deleted successfully." };
    }

    // Case 2: Both userId and filePath are provided - delete specific file
    // Security Check: Ensure the file path starts with the user's ID
    if (!filePath.startsWith(`${userId}/`)) {
      console.warn(
        `[Delete Supabase File Action] Attempt to delete invalid/unauthorized path by user ${userId}: ${filePath}`
      );
      return { success: false, message: "Invalid file path or unauthorized." };
    }

    console.log(
      `[Delete Supabase File Action] Deleting file for user ${userId}: ${filePath}`
    );

    const { error } = await adminSupabase.storage
      .from("scheduled-videos")
      .remove([filePath]);

    if (error) {
      console.error(
        `[Delete Supabase File Action] Supabase delete error for path ${filePath}:`,
        error
      );
      return {
        success: false,
        message: `Failed to delete file.`,
      };
    }

    console.log(
      `[Delete Supabase File Action] File deleted successfully: ${filePath}`
    );
    return { success: true, message: "File deleted." };
  } catch (err) {
    console.error(`[Delete Supabase File Action] Unexpected error:`, err);
    return {
      success: false,
      message: "An unexpected error occurred during file deletion.",
    };
  }
}
