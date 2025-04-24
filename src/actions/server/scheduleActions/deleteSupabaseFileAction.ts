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
  filePath: string | null,
  userId: string | null
): Promise<{ success: boolean; message: string }> {
  if (!userId) {
    return { success: false, message: "User not authenticated." };
  }

  try {
    // Case 1: Only userId is provided - delete the entire user folder
    if (!filePath) {
      console.log(`[Delete Action] Deleting entire folder for user ${userId}`);

      // Delete the user folder directly
      const { error } = await adminSupabase.storage
        .from("scheduled-videos")
        .remove([userId + "/"]);

      if (error) {
        console.error(
          `[Delete Action] Error deleting user folder ${userId}:`,
          error
        );
        return {
          success: false,
          message: `Failed to delete user folder: ${error.message}`,
        };
      }

      console.log(
        `[Delete Action] User folder deleted successfully: ${userId}`
      );
      return { success: true, message: "User folder deleted successfully." };
    }

    // Case 2: Both userId and filePath are provided - delete specific file
    // Security Check: Ensure the file path starts with the user's ID
    if (!filePath.startsWith(`${userId}/`)) {
      console.warn(
        `[Delete Action] Attempt to delete invalid/unauthorized path by user ${userId}: ${filePath}`
      );
      return { success: false, message: "Invalid file path or unauthorized." };
    }

    console.log(
      `[Delete Action] Deleting file for user ${userId}: ${filePath}`
    );

    const { error } = await adminSupabase.storage
      .from("scheduled-videos")
      .remove([filePath]);

    if (error) {
      console.error(
        `[Delete Action] Supabase delete error for path ${filePath}:`,
        error
      );
      return {
        success: false,
        message: `Failed to delete file: ${error.message}`,
      };
    }

    console.log(`[Delete Action] File deleted successfully: ${filePath}`);
    return { success: true, message: "File deleted." };
  } catch (err) {
    console.error(`[Delete Action] Unexpected error:`, err);
    return {
      success: false,
      message: "An unexpected error occurred during file deletion.",
    };
  }
}
