import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { countPendingDirectPostsForMediaPath } from "@/actions/server/data/pendingDirectPosts";
import { countPendingTikTokPullsForMediaPath } from "@/actions/server/data/pendingTikTokPulls";

const PAGE_SIZE = 1000;

/**
 * Deletes files from Supabase Storage with reference checking. No auth.
 *
 * This is the data-layer version of the public deleteSupabaseFileAction.
 * It does NOT call authCheck or authCheckCronJob. The caller is responsible
 * for verifying the principal before calling this function.
 *
 * Allowed callers: actions/server/data/storageFiles/deleteSupabaseFileAction.ts,
 *                  actions/server/scheduleActions/*, src/lib/mcp/*, Inngest workers.
 *
 * Before removing a file from storage, checks that no rows in
 * scheduled_posts (status scheduled or processing), failed_posts,
 * pending_tiktok_pulls (status pending) or pending_direct_posts
 * (status processing) reference it via media_storage_path.
 * If any do, the file is preserved.
 *
 * Storage cleanup failures do not throw. They are logged via console.error
 * and surfaced as { success: false, message }.
 *
 * Tables read: scheduled_posts, failed_posts, pending_tiktok_pulls, pending_direct_posts
 * Storage written: scheduled-videos bucket (delete)
 */
export async function deleteSupabaseFile(
  principalId: string,
  filePath: string | null,
  forceDelete: boolean = false,
): Promise<{ success: boolean; message: string }> {
  console.log(
    `[deleteSupabaseFile]: Starting deletion for principal: ${principalId}, path: ${
      filePath ?? "entire folder"
    }`,
  );

  try {
    // CASE 1: FOLDER DELETION
    // When only principalId is provided, delete the entire principal's folder.
    if (!filePath) {
      console.log(
        `[deleteSupabaseFile]: Initiating folder deletion for principal: ${principalId}`,
      );

      // #4: paginate through all files (Supabase storage default list = 100)
      const allFiles: { name: string }[] = [];
      let offset = 0;

      while (true) {
        const { data: page, error: listError } = await adminSupabase.storage
          .from("scheduled-videos")
          .list(principalId, { limit: PAGE_SIZE, offset });

        if (listError) {
          console.error(
            `[deleteSupabaseFile]: Failed to list files for principal ${principalId} at offset ${offset}:`,
            listError.message,
          );
          return {
            success: false,
            message: "Unable to access your files. Please try again later.",
          };
        }

        if (!page || page.length === 0) break;

        allFiles.push(...page);

        if (page.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }

      if (allFiles.length === 0) {
        console.log(
          `[deleteSupabaseFile]: No files found in folder for principal: ${principalId}`,
        );
        return {
          success: true,
          message: "No files found in your folder to delete.",
        };
      }
      console.log(
        `[deleteSupabaseFile]: Found ${allFiles.length} files in principal's folder`,
      );

      // #6: let instead of const so we can reassign after filtering
      let filesToDelete = allFiles.map((file) => `${principalId}/${file.name}`);

      // Reference check: skip if forceDelete is true.
      if (!forceDelete) {
        console.log(
          `[deleteSupabaseFile]: Checking for file references before deletion (safe mode)`,
        );

        // #3: batched check across 4 tables (4 queries total instead of 4*N)
        // #5: surface infra error explicitly instead of masking as "all in use"
        const refCheck = await findReferencedPaths(filesToDelete);
        if (!refCheck.success) {
          console.error(
            `[deleteSupabaseFile]: Reference check failed for folder ${principalId}:`,
            refCheck.message,
          );
          return {
            success: false,
            message:
              "Unable to verify file references. Please try again later.",
          };
        }

        const safeFiles = filesToDelete.filter(
          (path) => !refCheck.referenced.has(path),
        );
        const preservedCount = filesToDelete.length - safeFiles.length;
        console.log(
          `[deleteSupabaseFile]: ${safeFiles.length} files safe to delete, ${preservedCount} files preserved`,
        );

        filesToDelete = safeFiles;
      } else {
        console.log(
          `[deleteSupabaseFile]: Force delete enabled, skipping reference checks for ${filesToDelete.length} files`,
        );
      }

      if (filesToDelete.length === 0) {
        console.log(
          `[deleteSupabaseFile]: No files available for deletion after reference checks`,
        );
        return {
          success: true,
          message:
            "All files are currently in use by scheduled posts and cannot be deleted.",
        };
      }

      console.log(
        `[deleteSupabaseFile]: Deleting ${filesToDelete.length} files for principal ${principalId}`,
      );

      const { error: deleteError } = await adminSupabase.storage
        .from("scheduled-videos")
        .remove(filesToDelete);

      if (deleteError) {
        console.error(
          `[deleteSupabaseFile]: Batch file deletion failed:`,
          deleteError.message,
        );
        return {
          success: false,
          message: `Failed to delete files. Please try again later.`,
        };
      }

      console.log(
        `[deleteSupabaseFile]: Successfully deleted ${filesToDelete.length} files for principal ${principalId}`,
      );
      return {
        success: true,
        message: `Successfully deleted ${filesToDelete.length} files from your folder.`,
      };
    }

    // CASE 2: SINGLE FILE DELETION
    console.log(
      `[deleteSupabaseFile]: Initiating single file deletion: ${filePath}`,
    );

    // Ownership check: the file path must start with the principal's folder.
    if (!filePath.startsWith(`${principalId}/`)) {
      console.warn(
        `[deleteSupabaseFile]: Security violation, principal ${principalId} attempted to delete: ${filePath}`,
      );
      return {
        success: false,
        message: "Access denied: You can only delete your own files.",
      };
    }

    // Reference check: skip if forceDelete is true.
    if (!forceDelete) {
      console.log(
        `[deleteSupabaseFile]: Checking file references before deletion: ${filePath}`,
      );

      const { count: scheduledCount, error: checkError } = await adminSupabase
        .from("scheduled_posts")
        .select("id", { count: "exact", head: true })
        .eq("media_storage_path", filePath)
        .in("status", ["scheduled", "processing"]);

      if (checkError) {
        console.error(
          `[deleteSupabaseFile]: Failed to check scheduled_posts references:`,
          checkError.message,
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
          `[deleteSupabaseFile]: Failed to check failed_posts references:`,
          failedCheckError.message,
        );
        return {
          success: false,
          message: `Unable to verify if the file can be safely deleted. Please try again.`,
        };
      }

      const referenceCount = (scheduledCount ?? 0) + (failedCount ?? 0);

      if (referenceCount > 0) {
        console.log(
          `[deleteSupabaseFile]: File referenced by ${referenceCount} post(s), preserving: ${filePath}`,
        );
        return {
          success: true,
          message: `Cannot delete: This file is currently being used by ${referenceCount} scheduled posts.`,
        };
      }

      // Check pending TikTok pulls (async pull not yet completed)
      const pendingPullsResult =
        await countPendingTikTokPullsForMediaPath(filePath);
      if (!pendingPullsResult.success) {
        console.error(
          "[deleteSupabaseFile] Failed to count pending TikTok pulls:",
          pendingPullsResult.message,
        );
        // Conservative: do NOT delete on uncertainty
        return {
          success: false,
          message: "Could not verify safe-to-delete; preserving file",
        };
      }
      if (pendingPullsResult.count > 0) {
        console.log(
          `[deleteSupabaseFile]: File has ${pendingPullsResult.count} pending TikTok pull(s), preserving: ${filePath}`,
        );
        return {
          success: true,
          message: `Cannot delete: File has ${pendingPullsResult.count} pending TikTok pull(s).`,
        };
      }

      // Check pending direct post workers (race-safe cleanup gate)
      const pendingDirectResult =
        await countPendingDirectPostsForMediaPath(filePath);
      if (!pendingDirectResult.success) {
        console.error(
          "[deleteSupabaseFile] Failed to count pending direct posts:",
          pendingDirectResult.message,
        );
        return {
          success: false,
          message: "Could not verify safe-to-delete; preserving file",
        };
      }
      if (pendingDirectResult.count > 0) {
        console.log(
          `[deleteSupabaseFile]: File has ${pendingDirectResult.count} active direct post worker(s), preserving: ${filePath}`,
        );
        return {
          success: true,
          message: `Cannot delete: File has ${pendingDirectResult.count} active direct post worker(s).`,
        };
      }

      console.log(
        `[deleteSupabaseFile]: File reference check passed, safe to delete`,
      );
    } else {
      console.log(
        `[deleteSupabaseFile]: Force delete enabled, skipping reference checks`,
      );
    }

    console.log(`[deleteSupabaseFile]: Executing file deletion: ${filePath}`);
    const { error } = await adminSupabase.storage
      .from("scheduled-videos")
      .remove([filePath]);

    if (error) {
      console.error(
        `[deleteSupabaseFile]: File deletion failed:`,
        error.message,
      );
      return {
        success: false,
        message: `Failed to delete file. The file may not exist or you may not have permission.`,
      };
    }

    console.log(`[deleteSupabaseFile]: File deleted successfully: ${filePath}`);
    return { success: true, message: "File deleted successfully." };
  } catch (err) {
    console.error(
      `[deleteSupabaseFile]: Unexpected error during file deletion:`,
      err instanceof Error ? err.message : err,
    );
    return {
      success: false,
      message:
        "An unexpected error occurred while deleting the file. Please try again later.",
    };
  }
}

/**
 * Batched reference check across the 4 tables that can reference a media path.
 * Returns the set of paths still referenced (must be preserved from deletion).
 *
 * Used by the folder-deletion path to avoid N*4 round-trips. Single-file
 * deletion stays on per-table queries because each query short-circuits cleanly.
 *
 * Status filters on pending_tiktok_pulls (pending) and pending_direct_posts
 * (processing) match the partial indexes idx_pending_*_path_status, so the
 * Postgres planner uses the index instead of a seq scan.
 */
async function findReferencedPaths(
  paths: string[],
): Promise<
  | { success: true; referenced: Set<string> }
  | { success: false; message: string }
> {
  if (paths.length === 0) {
    return { success: true, referenced: new Set() };
  }

  const referenced = new Set<string>();

  // scheduled_posts (active statuses only -> hits idx_scheduled_posts_media_storage_path_active)
  const { data: scheduledRows, error: scheduledError } = await adminSupabase
    .from("scheduled_posts")
    .select("media_storage_path")
    .in("media_storage_path", paths)
    .in("status", ["scheduled", "processing"]);

  if (scheduledError) {
    return {
      success: false,
      message: `scheduled_posts check failed: ${scheduledError.message}`,
    };
  }
  for (const row of scheduledRows ?? []) {
    if (row.media_storage_path) referenced.add(row.media_storage_path);
  }

  // failed_posts (hits idx_failed_posts_media_storage_path)
  const { data: failedRows, error: failedError } = await adminSupabase
    .from("failed_posts")
    .select("media_storage_path")
    .in("media_storage_path", paths);

  if (failedError) {
    return {
      success: false,
      message: `failed_posts check failed: ${failedError.message}`,
    };
  }
  for (const row of failedRows ?? []) {
    if (row.media_storage_path) referenced.add(row.media_storage_path);
  }

  // pending_tiktok_pulls (filter on status='pending' to hit idx_pending_tiktok_pulls_path_status)
  const { data: pullsRows, error: pullsError } = await adminSupabase
    .from("pending_tiktok_pulls")
    .select("media_storage_path")
    .in("media_storage_path", paths)
    .eq("status", "pending");

  if (pullsError) {
    return {
      success: false,
      message: `pending_tiktok_pulls check failed: ${pullsError.message}`,
    };
  }
  for (const row of pullsRows ?? []) {
    if (row.media_storage_path) referenced.add(row.media_storage_path);
  }

  // pending_direct_posts (filter on status='processing' to hit idx_pending_direct_posts_path_status)
  const { data: directRows, error: directError } = await adminSupabase
    .from("pending_direct_posts")
    .select("media_storage_path")
    .in("media_storage_path", paths)
    .eq("status", "processing");

  if (directError) {
    return {
      success: false,
      message: `pending_direct_posts check failed: ${directError.message}`,
    };
  }
  for (const row of directRows ?? []) {
    if (row.media_storage_path) referenced.add(row.media_storage_path);
  }

  return { success: true, referenced };
}
