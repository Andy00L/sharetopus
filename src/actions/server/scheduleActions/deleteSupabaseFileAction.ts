"use server";
import { adminSupabase } from "@/actions/api/supabase-client";

/**
 * Delete a file or folder from Supabase Storage with reference checking
 *
 * This function implements "safe deletion" - it checks if files are still
 * referenced by any active scheduled posts before deleting them. This prevents
 * accidentally breaking scheduled posts by removing their media files.
 *
 * @param userId ID of the authenticated user
 * @param filePath Path to the file in Supabase Storage, optional if deleting entire user folder
 * @param forceDelete Override reference checking (use with caution)
 * @returns Object with success status and message
 */
export async function deleteSupabaseFileAction(
  userId: string | null,
  filePath?: string | null,
  forceDelete: boolean = false
): Promise<{ success: boolean; message: string }> {
  if (!userId) {
    return { success: false, message: "User not authenticated." };
  }

  try {
    // ===== CASE 1: FOLDER DELETION =====
    // When only userId is provided, attempt to delete the entire user folder
    // but only delete files that aren't referenced by active scheduled posts
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

      // Prepare paths for batch deletion
      const filesToDelete = fileList.map((file) => `${userId}/${file.name}`);

      // Check if any files are still referenced before deleting
      if (!forceDelete) {
        const safeFilesToDelete = [];

        for (const path of filesToDelete) {
          // Check if file is still referenced by any scheduled posts
          const { count, error: checkError } = await adminSupabase
            .from("scheduled_posts")
            .select("id", { count: "exact", head: true })
            .eq("media_storage_path", path)
            .in("status", ["scheduled", "pending", "processing"]);

          if (checkError) {
            console.error(
              `[Delete Supabase File Action] Error checking references for file ${path}:`,
              checkError
            );
            continue;
          }
          const referenceCount = count ?? 0; // Handle null case

          // If count is 0, no posts reference this file
          if (referenceCount === 0) {
            console.log(
              `[Delete Supabase File Action] File not referenced, will delete: ${path}`
            );
            safeFilesToDelete.push(path);
          } else {
            console.log(
              `[Delete Supabase File Action] File still in use by ${count} posts, keeping: ${path}`
            );
          }
        }

        // Update the list to only include unreferenced files
        filesToDelete.length = 0;
        filesToDelete.push(...safeFilesToDelete);
      }

      if (filesToDelete.length === 0) {
        console.log(
          `[Delete Supabase File Action] No unreferenced files to delete for user ${userId}`
        );
        return { success: true, message: "No files available for deletion." };
      }

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
        `[Delete Supabase File Action] All unreferenced files deleted successfully: ${userId}`
      );
      return {
        success: true,
        message: "All unreferenced files deleted successfully.",
      };
    }

    // ===== CASE 2: SINGLE FILE DELETION =====
    // When both userId and filePath are provided, delete a specific file
    // but only if it's not referenced by any active scheduled posts

    // Security Check: Ensure the file path starts with the user's ID
    // This prevents unauthorized access to other users' files
    if (!filePath.startsWith(`${userId}/`)) {
      console.warn(
        `[Delete Supabase File Action] Attempt to delete invalid/unauthorized path by user ${userId}: ${filePath}`
      );
      return { success: false, message: "Invalid file path or unauthorized." };
    }

    // Check if file is still referenced by any scheduled posts
    if (!forceDelete) {
      const { count, error: checkError } = await adminSupabase
        .from("scheduled_posts")
        .select("id", { count: "exact", head: true })
        .eq("media_storage_path", filePath)
        .in("status", ["scheduled", "pending", "processing"]);

      if (checkError) {
        console.error(
          `[Delete Supabase File Action] Error checking references for file ${filePath}:`,
          checkError
        );
        return {
          success: false,
          message: `Failed to check file references.`,
        };
      }
      const referenceCount = count ?? 0; // Handle null case

      // If count is > 0, posts still reference this file
      if (referenceCount > 0) {
        console.log(
          `[Delete Supabase File Action] File still in use by ${count} posts, skipping deletion: ${filePath}`
        );
        return {
          success: true,
          message: `File preserved as it's still used by ${count} scheduled posts.`,
        };
      }
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
