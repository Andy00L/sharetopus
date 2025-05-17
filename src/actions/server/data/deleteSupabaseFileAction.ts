"use server";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { authCheck } from "@/actions/authCheck";

/**
 * Safely deletes files from Supabase Storage with reference checking
 *
 * This function implements a secure deletion process that:
 * 1. Verifies user authentication and authorization
 * 2. Checks if files are referenced by active scheduled posts before deletion
 * 3. Handles both single file and folder (batch) deletion scenarios
 * 4. Provides detailed feedback about the deletion operation
 *
 * @param userId - ID of the authenticated user who owns the file(s)
 * @param filePath - Path to the specific file to delete (optional for folder deletion)
 * @param forceDelete - Override reference checking to force deletion (use with caution)
 * @returns Object with success status and detailed message about the operation
 */
export async function deleteSupabaseFileAction(
  userId: string | null,
  filePath?: string | null,
  forceDelete: boolean = false
): Promise<{ success: boolean; message: string }> {
  console.log(
    `[deleteSupabaseFile]: Starting deletion process for user: ${userId}, path: ${
      filePath ?? "entire folder"
    }`
  );

  const authResult = await authCheck(userId);
  if (!authResult) {
    console.error(
      `[deleteSupabaseFileAction]: Authentication check failed for user ID: ${userId}`
    );
    return {
      success: false,
      message: "Authentication validation failed. Please sign in again.",
    };
  }
  try {
    // ===== CASE 1: FOLDER DELETION =====
    // When only userId is provided, attempt to delete the entire user folder
    if (!filePath) {
      console.log(
        `[deleteSupabaseFile]: Initiating folder deletion for user: ${userId}`
      );

      // Step 2: List all files in the user's folder
      const { data: fileList, error: listError } = await adminSupabase.storage
        .from("scheduled-videos")
        .list(userId!);

      if (listError) {
        console.error(
          `[deleteSupabaseFile]: Failed to list files for user ${userId}:`,
          listError.message
        );
        return {
          success: false,
          message: `Unable to access your files. Please try again later.`,
        };
      }

      // Step 3: Handle empty folder case
      if (!fileList || fileList.length === 0) {
        console.log(
          `[deleteSupabaseFile]: No files found in folder for user: ${userId}`
        );
        return {
          success: true,
          message: "No files found in your folder to delete.",
        };
      }
      console.log(
        `[deleteSupabaseFile]: Found ${fileList.length} files in user's folder`
      );

      // Step 4: Prepare paths for batch deletion
      const filesToDelete = fileList.map((file) => `${userId}/${file.name}`);

      // Step 5: Check file references if not forcing deletion
      if (!forceDelete) {
        console.log(
          `[deleteSupabaseFile]: Checking for file references before deletion (safe mode)`
        );
        const safeFilesToDelete = [];
        let referencedFiles = 0;

        for (const path of filesToDelete) {
          // Check if file is still referenced by any scheduled posts
          const { count: scheduledCount, error: checkError } =
            await adminSupabase
              .from("scheduled_posts")
              .select("id", { count: "exact", head: true })
              .eq("media_storage_path", path)
              .in("status", ["scheduled", "pending", "processing"]);

          if (checkError) {
            console.error(
              `[deleteSupabaseFile]: Error checking references for file ${path}:`,
              checkError.message
            );
            continue;
          }

          // Check if file is referenced in failed_posts
          const { count: failedCount, error: failedCheckError } =
            await adminSupabase
              .from("failed_posts")
              .select("id", { count: "exact", head: true })
              .eq("media_storage_path", path);
          if (failedCheckError) {
            console.error(
              `[deleteSupabaseFile]: Error checking failed references for file ${path}:`,
              failedCheckError.message
            );
            continue;
          }
          const referenceCount = (scheduledCount ?? 0) + (failedCount ?? 0); // Handle null cases

          // If count is 0, no posts reference this file
          if (referenceCount === 0) {
            console.log(
              `[deleteSupabaseFile]: File not referenced by any posts, marking for deletion: ${path}`
            );
            safeFilesToDelete.push(path);
          } else {
            console.log(
              `[deleteSupabaseFile]: File referenced by ${referenceCount} active posts, preserving: ${path}`
            );
            referencedFiles++;
          }
        }

        // Update the list to only include unreferenced files
        console.log(
          `[deleteSupabaseFile]: ${safeFilesToDelete.length} files safe to delete, ${referencedFiles} files preserved`
        );
        filesToDelete.length = 0;
        filesToDelete.push(...safeFilesToDelete);
      } else {
        console.log(
          `[deleteSupabaseFile]: Force delete enabled - skipping reference checks for ${filesToDelete.length} files`
        );
      }

      // Step 6: Handle case where no files can be safely deleted
      if (filesToDelete.length === 0) {
        console.log(
          `[deleteSupabaseFile]: No files available for deletion after reference checks`
        );
        return {
          success: true,
          message:
            "All files are currently in use by scheduled posts and cannot be deleted.",
        };
      }

      // Step 7: Perform batch deletion
      console.log(
        `[deleteSupabaseFile]: Deleting ${filesToDelete.length} files for user ${userId}`
      );

      // Delete all files in a batch operation
      const { error: deleteError } = await adminSupabase.storage
        .from("scheduled-videos")
        .remove(filesToDelete);

      if (deleteError) {
        console.error(
          `[deleteSupabaseFile]: Batch file deletion failed:`,
          deleteError.message
        );
        return {
          success: false,
          message: `Failed to delete files. Please try again later.`,
        };
      }

      // Step 8: Return success for folder deletion
      console.log(
        `[deleteSupabaseFile]: Successfully deleted ${filesToDelete.length} files for user ${userId}`
      );

      return {
        success: true,
        message: `Successfully deleted ${filesToDelete.length} files from your folder.`,
      };
    }

    // ===== CASE 2: SINGLE FILE DELETION =====
    // When both userId and filePath are provided, delete a specific file
    console.log(
      `[deleteSupabaseFile]: Initiating single file deletion: ${filePath}`
    );

    // Step 9: Security check for file path
    if (!filePath.startsWith(`${userId}/`)) {
      console.warn(
        `[deleteSupabaseFile]: Security violation - user ${userId} attempted to delete unauthorized path: ${filePath}`
      );
      return {
        success: false,
        message: "Access denied: You can only delete your own files.",
      };
    }

    // Step 10: Check if file is still referenced (unless force delete)
    if (!forceDelete) {
      console.log(
        `[deleteSupabaseFile]: Checking file references before deletion: ${filePath}`
      );
      const { count: scheduledCount, error: checkError } = await adminSupabase
        .from("scheduled_posts")
        .select("id", { count: "exact", head: true })
        .eq("media_storage_path", filePath)
        .in("status", ["scheduled", "pending", "processing"]);

      if (checkError) {
        console.error(
          `[deleteSupabaseFile]: Failed to check file references:`,
          checkError.message
        );
        return {
          success: false,
          message: `Unable to verify if the file can be safely deleted. Please try again.`,
        };
      }
      // Check if file is referenced in failed_posts
      const { count: failedCount, error: failedCheckError } =
        await adminSupabase
          .from("failed_posts")
          .select("id", { count: "exact", head: true })
          .eq("media_storage_path", filePath);

      if (failedCheckError) {
        console.error(
          `[deleteSupabaseFile]: Failed to check failed file references:`,
          failedCheckError.message
        );
        return {
          success: false,
          message: `Unable to verify if the file can be safely deleted. Please try again.`,
        };
      }
      const referenceCount = (scheduledCount ?? 0) + (failedCount ?? 0); // Combine both reference counts

      // If count is > 0, posts still reference this file
      if (referenceCount > 0) {
        console.log(
          `[deleteSupabaseFile]: File deletion prevented - referenced by ${referenceCount} active posts: ${filePath}`
        );
        return {
          success: true,
          message: `Cannot delete: This file is currently being used by ${referenceCount} scheduled posts.`,
        };
      }

      console.log(
        `[deleteSupabaseFile]: File reference check passed - safe to delete`
      );
    } else {
      console.log(
        `[deleteSupabaseFile]: Force delete enabled - skipping reference checks`
      );
    }

    // Step 11: Delete the single file
    console.log(`[deleteSupabaseFile]: Executing file deletion: ${filePath}`);
    const { error } = await adminSupabase.storage
      .from("scheduled-videos")
      .remove([filePath]);

    if (error) {
      console.error(
        `[deleteSupabaseFile]: File deletion failed:`,
        error.message
      );
      return {
        success: false,
        message: `Failed to delete file. The file may not exist or you may not have permission.`,
      };
    }

    // Step 12: Return success for single file deletion
    console.log(`[deleteSupabaseFile]: File deleted successfully: ${filePath}`);
    return { success: true, message: "File deleted successfully." };
  } catch (err) {
    // Step 13: Handle unexpected errors
    console.error(
      `[deleteSupabaseFile]: Unexpected error during file deletion:`,
      err instanceof Error ? err.message : err
    );
    return {
      success: false,
      message:
        "An unexpected error occurred while deleting the file. Please try again later.",
    };
  }
}
