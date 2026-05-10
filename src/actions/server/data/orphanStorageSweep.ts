import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";

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

  // List top-level entries (folders = principal IDs)
  const { data: topLevel, error: topError } = await adminSupabase.storage
    .from(input.bucket)
    .list("", { limit: 1000, offset: 0 });

  if (topError) {
    console.error(
      "[listAgedStorageFiles] Failed to list bucket root:",
      topError.message
    );
    return { success: false, message: `Bucket root list failed: ${topError.message}` };
  }

  if (!topLevel) {
    return { success: false, message: "Bucket root list returned null data" };
  }

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
  const pageSize = 1000;

  while (remaining > 0) {
    const { data, error } = await adminSupabase.storage
      .from(bucket)
      .list(folder, { limit: pageSize, offset });

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

    // If the page was full, there may be more
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return { success: true, files };
}

/**
 * Returns the subset of `paths` that are referenced by any of the four
 * media-storage-path tables: scheduled_posts, failed_posts,
 * pending_tiktok_pulls, pending_direct_posts.
 *
 * No status filters: the orphan sweep is conservative (any reference = keep).
 *
 * Chunks internally for >1000 paths to stay within Postgres query limits.
 */
export async function findReferencedStoragePaths(
  paths: string[]
): Promise<
  | { success: true; referenced: string[] }
  | { success: false; message: string }
> {
  if (paths.length === 0) {
    return { success: true, referenced: [] };
  }

  const referencedSet = new Set<string>();
  const chunkSize = 1000;

  for (let i = 0; i < paths.length; i += chunkSize) {
    const chunk = paths.slice(i, i + chunkSize);
    const result = await queryReferencesForChunk(chunk);
    if (!result.success) return result;
    for (const p of result.found) {
      referencedSet.add(p);
    }
  }

  return { success: true, referenced: Array.from(referencedSet) };
}

async function queryReferencesForChunk(
  chunk: string[]
): Promise<
  | { success: true; found: string[] }
  | { success: false; message: string }
> {
  const tables = [
    "scheduled_posts",
    "failed_posts",
    "pending_tiktok_pulls",
    "pending_direct_posts",
  ] as const;

  const results = await Promise.allSettled(
    tables.map((table) =>
      adminSupabase
        .from(table)
        .select("media_storage_path")
        .in("media_storage_path", chunk)
    )
  );

  const found: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "rejected") {
      console.error(
        `[findReferencedStoragePaths] Query to ${tables[i]} threw:`,
        result.reason
      );
      return {
        success: false,
        message: `Query to ${tables[i]} threw: ${result.reason}`,
      };
    }

    const { data, error } = result.value;
    if (error) {
      console.error(
        `[findReferencedStoragePaths] Query to ${tables[i]} failed:`,
        error.message
      );
      return {
        success: false,
        message: `Query to ${tables[i]} failed: ${error.message}`,
      };
    }

    if (data) {
      for (const row of data) {
        if (row.media_storage_path) {
          found.push(row.media_storage_path);
        }
      }
    }
  }

  return { success: true, found };
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

  for (let i = 0; i < input.paths.length; i += batchSize) {
    const batch = input.paths.slice(i, i + batchSize);

    const { data, error } = await adminSupabase.storage
      .from(input.bucket)
      .remove(batch);

    if (error) {
      console.error(
        `[batchDeleteStorageFiles] Batch ${Math.floor(i / batchSize) + 1} failed:`,
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

    for (const p of batch.slice(0, deleted)) {
      bytesFreed += pathSizes[p] ?? 0;
    }
  }

  return { success: true, deletedCount, failedCount, bytesFreed };
}
