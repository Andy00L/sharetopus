import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { findReferencedMediaPaths } from "./storageFiles/mediaReferences";

/** Paths per Storage list page, the API's maximum. */
const LIST_PAGE_SIZE = 1000;

/**
 * Lists every file in the bucket older than `cutoffIso`, recursing into
 * principal-prefixed folders. Skips `.emptyFolderPlaceholder`. Skips
 * top-level files (none should exist; logs a warning if any are found).
 *
 * Pagination: up to 1000 per page per folder.
 * Hard cap: returns at most `maxFiles` candidate paths (default 10000).
 * If cap is hit, returns `truncated: true` so the caller logs a warning.
 */
export async function listAgedStorageFiles(input: {
  bucket: string;
  cutoffIso: string;
  maxFiles?: number;
}): Promise<
  | {
      success: true;
      paths: string[];
      pathSizes: Record<string, number>;
      folderCount: number;
      truncated: boolean;
    }
  | { success: false; message: string }
> {
  const maxFiles = input.maxFiles ?? 10_000;
  const cutoffMs = new Date(input.cutoffIso).getTime();

  const rootListing = await listBucketRoot(input.bucket);
  if (!rootListing.success) return rootListing;
  const topLevel = rootListing.entries;

  const paths: string[] = [];
  const pathSizes: Record<string, number> = {};
  let folderCount = 0;
  let truncated = false;

  for (const entry of topLevel) {
    if (entry.name === ".emptyFolderPlaceholder") continue;

    // Folders have id=null in Supabase storage list responses
    if (entry.id !== null) {
      // Top-level file (unexpected). Log warning, skip.
      console.warn(
        `[listAgedStorageFiles] Unexpected top-level file: ${entry.name}`
      );
      continue;
    }

    // This is a folder (principal ID prefix)
    folderCount++;
    const folderResult = await listFolderFiles(
      input.bucket,
      entry.name,
      cutoffMs,
      maxFiles - paths.length
    );

    if (!folderResult.success) {
      // Log and continue with other folders (partial success acceptable)
      console.error(
        `[listAgedStorageFiles] Failed to list folder ${entry.name}:`,
        folderResult.message
      );
      continue;
    }

    for (const file of folderResult.files) {
      paths.push(file.path);
      pathSizes[file.path] = file.size;
    }

    if (paths.length >= maxFiles) {
      truncated = true;
      break;
    }
  }

  return { success: true, paths, pathSizes, folderCount, truncated };
}

/**
 * Every entry at the bucket root, page by page. One page used to be read,
 * so the folders past the first 1000 users were never swept.
 */
async function listBucketRoot(
  bucket: string
): Promise<
  | { success: true; entries: { name: string; id: string | null }[] }
  | { success: false; message: string }
> {
  const entries: { name: string; id: string | null }[] = [];
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const { data: page, error } = await adminSupabase.storage
      .from(bucket)
      .list("", { limit: LIST_PAGE_SIZE, offset });
    if (error) {
      console.error(
        "[listBucketRoot] Failed to list bucket root:",
        error.message
      );
      return { success: false, message: `Bucket root list failed: ${error.message}` };
    }
    if (!page) {
      return { success: false, message: "Bucket root list returned null data" };
    }
    entries.push(...page);
    if (page.length < LIST_PAGE_SIZE) break;
  }
  return { success: true, entries };
}

async function listFolderFiles(
  bucket: string,
  folder: string,
  cutoffMs: number,
  remaining: number
): Promise<
  | { success: true; files: Array<{ path: string; size: number }> }
  | { success: false; message: string }
> {
  const files: Array<{ path: string; size: number }> = [];
  let offset = 0;

  while (remaining > 0) {
    const { data, error } = await adminSupabase.storage
      .from(bucket)
      .list(folder, { limit: LIST_PAGE_SIZE, offset });

    if (error) {
      return { success: false, message: `list(${folder}) failed: ${error.message}` };
    }

    if (!data || data.length === 0) break;

    for (const file of data) {
      if (file.name === ".emptyFolderPlaceholder") continue;
      // Folders within principal folders are not expected but skip them
      if (file.id === null) continue;

      const createdAt = file.created_at ? new Date(file.created_at).getTime() : 0;
      if (createdAt >= cutoffMs) continue; // Too new, skip

      files.push({
        path: `${folder}/${file.name}`,
        size: file.metadata?.size ?? 0,
      });
      remaining--;
      if (remaining <= 0) break;
    }

    if (data.length < LIST_PAGE_SIZE) break;
    offset += LIST_PAGE_SIZE;
  }

  return { success: true, files };
}

/**
 * Returns the subset of `paths` that any row of scheduled_posts,
 * failed_posts, pending_tiktok_pulls or pending_direct_posts references,
 * whatever its status (findReferencedMediaPaths, scope "any_row"): the
 * sweep deletes only files nothing mentions.
 *
 * Everything this function fails to report as referenced gets DELETED from
 * storage by the caller, so any failed statement aborts the whole sweep.
 */
export async function findReferencedStoragePaths(
  paths: string[]
): Promise<
  | { success: true; referenced: string[] }
  | { success: false; message: string }
> {
  const refCheck = await findReferencedMediaPaths(paths, "any_row");
  if (!refCheck.success) {
    console.error("[findReferencedStoragePaths]", refCheck.message);
    return refCheck;
  }
  return { success: true, referenced: Array.from(refCheck.referenced) };
}

/**
 * Removes `paths` from the bucket in batches of `batchSize` (default 100).
 * On any batch failure, logs and continues to next batch (partial success
 * is preferred over zero progress).
 */
export async function batchDeleteStorageFiles(input: {
  bucket: string;
  paths: string[];
  pathSizes?: Record<string, number>;
  batchSize?: number;
}): Promise<
  | { success: true; deletedCount: number; failedCount: number; bytesFreed: number }
  | { success: false; message: string }
> {
  if (input.paths.length === 0) {
    return { success: true, deletedCount: 0, failedCount: 0, bytesFreed: 0 };
  }

  const batchSize = input.batchSize ?? 100;
  const pathSizes = input.pathSizes ?? {};
  let deletedCount = 0;
  let failedCount = 0;
  let bytesFreed = 0;

  for (let batchStart = 0; batchStart < input.paths.length; batchStart += batchSize) {
    const batch = input.paths.slice(batchStart, batchStart + batchSize);

    const { data, error } = await adminSupabase.storage
      .from(input.bucket)
      .remove(batch);

    if (error) {
      console.error(
        `[batchDeleteStorageFiles] Batch ${Math.floor(batchStart / batchSize) + 1} failed:`,
        error.message
      );
      failedCount += batch.length;
      continue;
    }

    // data is the array of deleted FileObjects (or null on some edge cases)
    const deleted = data?.length ?? 0;
    deletedCount += deleted;

    // If data returned fewer than batch size, count the rest as failed
    if (deleted < batch.length) {
      failedCount += batch.length - deleted;
    }

    for (const deletedPath of batch.slice(0, deleted)) {
      bytesFreed += pathSizes[deletedPath] ?? 0;
    }
  }

  return { success: true, deletedCount, failedCount, bytesFreed };
}
