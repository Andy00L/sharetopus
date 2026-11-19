import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { MEDIA_BUCKET } from "@/lib/storage/mediaBucket";
import { findReferencedMediaPaths } from "./mediaReferences";

const PAGE_SIZE = 1000;

/** Paths per Storage remove call. */
const REMOVE_BATCH_SIZE = 1000;

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
 * Before removing a file from storage, checks that no row still needs it
 * (findReferencedMediaPaths, scope "in_use"). If one does, the file is
 * preserved.
 *
 * Storage cleanup failures do not throw. They are logged via console.error
 * and surfaced as { success: false, message }.
 *
 * Tables read: scheduled_posts, failed_posts, pending_tiktok_pulls, pending_direct_posts
 * Storage written: MEDIA_BUCKET (delete)
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
    if (!filePath) {
      return await deletePrincipalFolder(principalId, forceDelete);
    }

    console.log(
      `[deleteSupabaseFile]: Initiating single file deletion: ${filePath}`,
    );

    if (!filePath.startsWith(`${principalId}/`)) {
      console.warn(
        `[deleteSupabaseFile]: Security violation, principal ${principalId} attempted to delete: ${filePath}`,
      );
      return {
        success: false,
        message: "Access denied: You can only delete your own files.",
      };
    }

    if (!forceDelete) {
      const refCheck = await findReferencedMediaPaths([filePath], "in_use");
      if (!refCheck.success) {
        console.error(
          `[deleteSupabaseFile]: Reference check failed for ${filePath}:`,
          refCheck.message,
        );
        return {
          success: false,
          message: `Unable to verify if the file can be safely deleted. Please try again.`,
        };
      }
      if (refCheck.referenced.has(filePath)) {
        console.log(
          `[deleteSupabaseFile]: File still referenced, preserving: ${filePath}`,
        );
        return {
          success: true,
          message:
            "Cannot delete: This file is still used by a post or a publish in progress.",
        };
      }
    } else {
      console.log(
        `[deleteSupabaseFile]: Force delete enabled, skipping reference checks`,
      );
    }

    console.log(`[deleteSupabaseFile]: Executing file deletion: ${filePath}`);
    const { error } = await adminSupabase.storage
      .from(MEDIA_BUCKET)
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

export type DeleteUnreferencedMediaResult =
  | { success: true; removedCount: number; preservedCount: number }
  | { success: false; message: string };

/**
 * deleteSupabaseFile for many files at once: one reference check and one
 * Storage call per REMOVE_BATCH_SIZE paths, instead of a check and a call
 * per file. Paths outside the principal's folder are skipped. removedCount
 * is what Storage reports as removed, so a preserved file is never counted
 * as deleted.
 */
export async function deleteUnreferencedMediaFiles(
  principalId: string,
  filePaths: string[],
): Promise<DeleteUnreferencedMediaResult> {
  const ownedPaths = [
    ...new Set(
      filePaths.filter(
        (filePath) => filePath.length > 0 && filePath.startsWith(`${principalId}/`),
      ),
    ),
  ];
  if (ownedPaths.length === 0) {
    return { success: true, removedCount: 0, preservedCount: 0 };
  }

  const refCheck = await findReferencedMediaPaths(ownedPaths, "in_use");
  if (!refCheck.success) {
    console.error(
      `[deleteUnreferencedMediaFiles] Reference check failed for principal ${principalId}:`,
      refCheck.message,
    );
    return { success: false, message: "Unable to verify file references." };
  }

  const removablePaths = ownedPaths.filter(
    (filePath) => !refCheck.referenced.has(filePath),
  );
  const removed = await removeStorageFiles(removablePaths);
  if (!removed.success) {
    console.error(
      `[deleteUnreferencedMediaFiles] Storage remove failed for principal ${principalId}:`,
      removed.message,
    );
    return { success: false, message: "Failed to delete files." };
  }

  return {
    success: true,
    removedCount: removed.removedCount,
    preservedCount: ownedPaths.length - removablePaths.length,
  };
}

async function removeStorageFiles(
  filePaths: string[],
): Promise<{ success: true; removedCount: number } | { success: false; message: string }> {
  let removedCount = 0;
  for (
    let batchStart = 0;
    batchStart < filePaths.length;
    batchStart += REMOVE_BATCH_SIZE
  ) {
    const batch = filePaths.slice(batchStart, batchStart + REMOVE_BATCH_SIZE);
    const { data: removedFiles, error } = await adminSupabase.storage
      .from(MEDIA_BUCKET)
      .remove(batch);
    if (error) {
      return { success: false, message: error.message };
    }
    removedCount += removedFiles?.length ?? 0;
  }
  return { success: true, removedCount };
}

/** Deletes every file in the principal's folder, keeping referenced ones unless forceDelete. */
async function deletePrincipalFolder(
  principalId: string,
  forceDelete: boolean,
): Promise<{ success: boolean; message: string }> {
  console.log(
    `[deletePrincipalFolder]: Initiating folder deletion for principal: ${principalId}`,
  );

  const allFiles: { name: string }[] = [];
  let offset = 0;

  while (true) {
    const { data: page, error: listError } = await adminSupabase.storage
      .from(MEDIA_BUCKET)
      .list(principalId, { limit: PAGE_SIZE, offset });

    if (listError) {
      console.error(
        `[deletePrincipalFolder]: Failed to list files for principal ${principalId} at offset ${offset}:`,
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
      `[deletePrincipalFolder]: No files found in folder for principal: ${principalId}`,
    );
    return {
      success: true,
      message: "No files found in your folder to delete.",
    };
  }
  console.log(
    `[deletePrincipalFolder]: Found ${allFiles.length} files in principal's folder`,
  );

  const folderPaths = allFiles.map((file) => `${principalId}/${file.name}`);
  let filesToDelete = folderPaths;

  if (!forceDelete) {
    const refCheck = await findReferencedMediaPaths(folderPaths, "in_use");
    if (!refCheck.success) {
      console.error(
        `[deletePrincipalFolder]: Reference check failed for folder ${principalId}:`,
        refCheck.message,
      );
      return {
        success: false,
        message: "Unable to verify file references. Please try again later.",
      };
    }

    filesToDelete = folderPaths.filter(
      (filePath) => !refCheck.referenced.has(filePath),
    );
    console.log(
      `[deletePrincipalFolder]: ${filesToDelete.length} files safe to delete, ${folderPaths.length - filesToDelete.length} files preserved`,
    );
  } else {
    console.log(
      `[deletePrincipalFolder]: Force delete enabled, skipping reference checks for ${filesToDelete.length} files`,
    );
  }

  if (filesToDelete.length === 0) {
    console.log(
      `[deletePrincipalFolder]: No files available for deletion after reference checks`,
    );
    return {
      success: true,
      message:
        "All files are currently in use by scheduled posts and cannot be deleted.",
    };
  }

  const removed = await removeStorageFiles(filesToDelete);
  if (!removed.success) {
    console.error(
      `[deletePrincipalFolder]: Batch file deletion failed:`,
      removed.message,
    );
    return {
      success: false,
      message: `Failed to delete files. Please try again later.`,
    };
  }

  console.log(
    `[deletePrincipalFolder]: Successfully deleted ${filesToDelete.length} files for principal ${principalId}`,
  );
  return {
    success: true,
    message: `Successfully deleted ${filesToDelete.length} files from your folder.`,
  };
}
