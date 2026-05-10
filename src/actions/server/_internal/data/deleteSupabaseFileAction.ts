import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { countPendingTikTokPullsForMediaPath } from "@/actions/server/data/pendingTikTokPulls";
import { countPendingDirectPostsForMediaPath } from "@/actions/server/data/pendingDirectPosts";

/**
 * Deletes files from Supabase Storage with reference checking. No auth.
 *
 * This is the data-layer version of the public deleteSupabaseFileAction.
 * It does NOT call authCheck or authCheckCronJob. The caller is responsible
 * for verifying the principal before calling this function.
 *
 * Allowed callers: actions/server/_internal/*, src/lib/mcp/*.
 * Web UI and cron paths must use the public wrapper instead:
 *   src/actions/server/data/deleteSupabaseFileAction.ts
 *
 * Before removing a file from storage, checks that no rows in
 * scheduled_posts (status scheduled or processing) or failed_posts
 * reference it via media_storage_path. If any do, the file is preserved.
 *
 * Storage cleanup failures do not throw. They are logged via console.error
 * and surfaced as { success: false, message }.
 *
 * Tables read: scheduled_posts, failed_posts
 * Storage written: scheduled-videos bucket (delete)
 * Called by: _internal/scheduleActions/deleteScheduledPostBatch.ts,
 *           server/data/deleteSupabaseFileAction.ts (public wrapper)
 */
export async function deleteSupabaseFileActionInternal(
  principalId: string,
  filePath: string | null,
  forceDelete: boolean = false
): Promise<{ success: boolean; message: string }> {
  console.log(
    `[deleteSupabaseFileInternal]: Starting deletion for principal: ${principalId}, path: ${
      filePath ?? "entire folder"
    }`
  );

  try {
    // CASE 1: FOLDER DELETION
    // When only principalId is provided, delete the entire principal's folder.
    if (!filePath) {
      console.log(
        `[deleteSupabaseFileInternal]: Initiating folder deletion for principal: ${principalId}`
      );

      const { data: fileList, error: listError } = await adminSupabase.storage
        .from("scheduled-videos")
        .list(principalId);

      if (listError) {
        console.error(
          `[deleteSupabaseFileInternal]: Failed to list files for principal ${principalId}:`,
          listError.message
        );
        return {
          success: false,
          message: `Unable to access your files. Please try again later.`,
        };
      }

      if (!fileList || fileList.length === 0) {
        console.log(
          `[deleteSupabaseFileInternal]: No files found in folder for principal: ${principalId}`
        );
        return {
          success: true,
          message: "No files found in your folder to delete.",
        };
      }
      console.log(
        `[deleteSupabaseFileInternal]: Found ${fileList.length} files in principal's folder`
      );

      const filesToDelete = fileList.map((file) => `${principalId}/${file.name}`);

      // Reference check: skip if forceDelete is true.
      if (!forceDelete) {
        console.log(
          `[deleteSupabaseFileInternal]: Checking for file references before deletion (safe mode)`
        );
        const safeFilesToDelete: string[] = [];
        let referencedFiles = 0;

        for (const path of filesToDelete) {
          // Check scheduled_posts for active references.
          const { count: scheduledCount, error: checkError } =
            await adminSupabase
              .from("scheduled_posts")
              .select("id", { count: "exact", head: true })
              .eq("media_storage_path", path)
              .in("status", ["scheduled", "processing"]);

          if (checkError) {
            console.error(
              `[deleteSupabaseFileInternal]: Error checking scheduled_posts for ${path}:`,
              checkError.message
            );
            continue;
          }

          // Check failed_posts for references.
          const { count: failedCount, error: failedCheckError } =
            await adminSupabase
              .from("failed_posts")
              .select("id", { count: "exact", head: true })
              .eq("media_storage_path", path);

          if (failedCheckError) {
            console.error(
              `[deleteSupabaseFileInternal]: Error checking failed_posts for ${path}:`,
              failedCheckError.message
            );
            continue;
          }

          const referenceCount = (scheduledCount ?? 0) + (failedCount ?? 0);

          if (referenceCount > 0) {
            console.log(
              `[deleteSupabaseFileInternal]: File referenced by ${referenceCount} post(s), preserving: ${path}`
            );
            referencedFiles++;
            continue;
          }

          // Check pending TikTok pulls (async pull not yet completed)
          const pendingPulls = await countPendingTikTokPullsForMediaPath(path);
          if (!pendingPulls.success) {
            console.error(
              `[deleteSupabaseFileInternal]: Failed to count pending TikTok pulls for ${path}:`,
              pendingPulls.message
            );
            // Conservative: treat as referenced to avoid deleting mid-pull
            referencedFiles++;
            continue;
          }
          if (pendingPulls.count > 0) {
            console.log(
              `[deleteSupabaseFileInternal]: File has ${pendingPulls.count} pending TikTok pull(s), preserving: ${path}`
            );
            referencedFiles++;
            continue;
          }

          // Check pending direct post workers (race-safe cleanup gate)
          const pendingDirect = await countPendingDirectPostsForMediaPath(path);
          if (!pendingDirect.success) {
            console.error(
              `[deleteSupabaseFileInternal]: Failed to count pending direct posts for ${path}:`,
              pendingDirect.message
            );
            referencedFiles++;
            continue;
          }
          if (pendingDirect.count > 0) {
            console.log(
              `[deleteSupabaseFileInternal]: File has ${pendingDirect.count} active direct post worker(s), preserving: ${path}`
            );
            referencedFiles++;
            continue;
          }

          console.log(
            `[deleteSupabaseFileInternal]: File not referenced, marking for deletion: ${path}`
          );
          safeFilesToDelete.push(path);
        }

        console.log(
          `[deleteSupabaseFileInternal]: ${safeFilesToDelete.length} files safe to delete, ${referencedFiles} files preserved`
        );
        filesToDelete.length = 0;
        filesToDelete.push(...safeFilesToDelete);
      } else {
        console.log(
          `[deleteSupabaseFileInternal]: Force delete enabled, skipping reference checks for ${filesToDelete.length} files`
        );
      }

      if (filesToDelete.length === 0) {
        console.log(
          `[deleteSupabaseFileInternal]: No files available for deletion after reference checks`
        );
        return {
          success: true,
          message:
            "All files are currently in use by scheduled posts and cannot be deleted.",
        };
      }

      console.log(
        `[deleteSupabaseFileInternal]: Deleting ${filesToDelete.length} files for principal ${principalId}`
      );

      const { error: deleteError } = await adminSupabase.storage
        .from("scheduled-videos")
        .remove(filesToDelete);

      if (deleteError) {
        console.error(
          `[deleteSupabaseFileInternal]: Batch file deletion failed:`,
          deleteError.message
        );
        return {
          success: false,
          message: `Failed to delete files. Please try again later.`,
        };
      }

      console.log(
        `[deleteSupabaseFileInternal]: Successfully deleted ${filesToDelete.length} files for principal ${principalId}`
      );
      return {
        success: true,
        message: `Successfully deleted ${filesToDelete.length} files from your folder.`,
      };
    }

    // CASE 2: SINGLE FILE DELETION
    console.log(
      `[deleteSupabaseFileInternal]: Initiating single file deletion: ${filePath}`
    );

    // Ownership check: the file path must start with the principal's folder.
    if (!filePath.startsWith(`${principalId}/`)) {
      console.warn(
        `[deleteSupabaseFileInternal]: Security violation, principal ${principalId} attempted to delete: ${filePath}`
      );
      return {
        success: false,
        message: "Access denied: You can only delete your own files.",
      };
    }

    // Reference check: skip if forceDelete is true.
    if (!forceDelete) {
      console.log(
        `[deleteSupabaseFileInternal]: Checking file references before deletion: ${filePath}`
      );

      const { count: scheduledCount, error: checkError } = await adminSupabase
        .from("scheduled_posts")
        .select("id", { count: "exact", head: true })
        .eq("media_storage_path", filePath)
        .in("status", ["scheduled", "processing"]);

      if (checkError) {
        console.error(
          `[deleteSupabaseFileInternal]: Failed to check scheduled_posts references:`,
          checkError.message
        );
        return {
          success: false,
          message: `Unable to verify if the file can be safely deleted. Please try again.`,
        };
      }

      const { count: failedCount, error: failedCheckError } =
        await adminSupabase
          .from("failed_posts")
          .select("id", { count: "exact", head: true })
          .eq("media_storage_path", filePath);

      if (failedCheckError) {
        console.error(
          `[deleteSupabaseFileInternal]: Failed to check failed_posts references:`,
          failedCheckError.message
        );
        return {
          success: false,
          message: `Unable to verify if the file can be safely deleted. Please try again.`,
        };
      }

      const referenceCount = (scheduledCount ?? 0) + (failedCount ?? 0);

      if (referenceCount > 0) {
        console.log(
          `[deleteSupabaseFileInternal]: File referenced by ${referenceCount} post(s), preserving: ${filePath}`
        );
        return {
          success: true,
          message: `Cannot delete: This file is currently being used by ${referenceCount} scheduled posts.`,
        };
      }

      // Check pending TikTok pulls (async pull not yet completed)
      const pendingPullsResult = await countPendingTikTokPullsForMediaPath(filePath);
      if (!pendingPullsResult.success) {
        console.error(
          "[deleteSupabaseFileInternal] Failed to count pending TikTok pulls:",
          pendingPullsResult.message
        );
        // Conservative: do NOT delete on uncertainty
        return {
          success: false,
          message: "Could not verify safe-to-delete; preserving file",
        };
      }
      if (pendingPullsResult.count > 0) {
        console.log(
          `[deleteSupabaseFileInternal]: File has ${pendingPullsResult.count} pending TikTok pull(s), preserving: ${filePath}`
        );
        return {
          success: true,
          message: `Cannot delete: File has ${pendingPullsResult.count} pending TikTok pull(s).`,
        };
      }

      // Check pending direct post workers (race-safe cleanup gate)
      const pendingDirectResult = await countPendingDirectPostsForMediaPath(filePath);
      if (!pendingDirectResult.success) {
        console.error(
          "[deleteSupabaseFileInternal] Failed to count pending direct posts:",
          pendingDirectResult.message
        );
        return {
          success: false,
          message: "Could not verify safe-to-delete; preserving file",
        };
      }
      if (pendingDirectResult.count > 0) {
        console.log(
          `[deleteSupabaseFileInternal]: File has ${pendingDirectResult.count} active direct post worker(s), preserving: ${filePath}`
        );
        return {
          success: true,
          message: `Cannot delete: File has ${pendingDirectResult.count} active direct post worker(s).`,
        };
      }

      console.log(
        `[deleteSupabaseFileInternal]: File reference check passed, safe to delete`
      );
    } else {
      console.log(
        `[deleteSupabaseFileInternal]: Force delete enabled, skipping reference checks`
      );
    }

    console.log(
      `[deleteSupabaseFileInternal]: Executing file deletion: ${filePath}`
    );
    const { error } = await adminSupabase.storage
      .from("scheduled-videos")
      .remove([filePath]);

    if (error) {
      console.error(
        `[deleteSupabaseFileInternal]: File deletion failed:`,
        error.message
      );
      return {
        success: false,
        message: `Failed to delete file. The file may not exist or you may not have permission.`,
      };
    }

    console.log(
      `[deleteSupabaseFileInternal]: File deleted successfully: ${filePath}`
    );
    return { success: true, message: "File deleted successfully." };
  } catch (err) {
    console.error(
      `[deleteSupabaseFileInternal]: Unexpected error during file deletion:`,
      err instanceof Error ? err.message : err
    );
    return {
      success: false,
      message:
        "An unexpected error occurred while deleting the file. Please try again later.",
    };
  }
}
