"use server";
import { adminSupabase } from "@/actions/api/supabase-client";

/**
 * Delete a file from Supabase Storage
 *
 * @param filePath Path to the file in Supabase Storage
 * @returns Object with success status and message
 */
export async function deleteSupabaseFileAction(
  filePath: string,
  userId: string | null
): Promise<{ success: boolean; message: string }> {
  if (!userId) {
    return { success: false, message: "User not authenticated." };
  }

  // Security Check: Ensure the file path starts with the user's ID
  // This prevents users from potentially deleting others' files if they guess paths
  if (!filePath?.startsWith(`${userId}/`)) {
    console.warn(
      `[Delete Action] Attempt to delete invalid/unauthorized path by user ${userId}: ${filePath}`
    );
    return { success: false, message: "Invalid file path or unauthorized." };
  }

  try {
    console.log(
      `[Delete Action] Deleting file for user ${userId}: ${filePath}`
    );

    const { error } = await adminSupabase.storage
      .from("scheduled-videos") // Use your bucket name
      .remove([filePath]);

    // Use your bucket name
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
    console.error(
      `[Delete Action] Unexpected error deleting ${filePath}:`,
      err
    );
    return {
      success: false,
      message: "An unexpected error occurred during file deletion.",
    };
  }
}
