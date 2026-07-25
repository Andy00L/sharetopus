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
 * Number of paths per `.in()` filter. PostgREST sends the filter in the
 * request URL, so a chunk of 1000 storage paths (~50 chars each) builds a
 * query string large enough to be rejected as a 414 by the gateway. 200
 * keeps the URL comfortably small; the caller loops.
 */
const REFERENCE_CHUNK_SIZE = 200;

/**
 * Rows fetched per page inside one chunk query. PostgREST caps a response
 * at the project's `max-rows` setting (commonly 1000) and returns the
 * truncated page WITHOUT an error, so every chunk query must paginate to
 * completion instead of trusting a single response.
 */
const REFERENCE_PAGE_SIZE = 500;

/**
 * Returns the subset of `paths` that are referenced by any of the four
 * media-storage-path tables: scheduled_posts, failed_posts,
 * pending_tiktok_pulls, pending_direct_posts.
 *
 * No status filters: the orphan sweep is conservative (any reference = keep).
 *
 * Correctness note: everything this function fails to report as referenced
 * gets DELETED from storage by the caller. A silently short result is
 * therefore user data loss, not a missed optimization, which is why the
 * chunk queries paginate explicitly and any error aborts the whole sweep.
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

  for (let i = 0; i < paths.length; i += REFERENCE_CHUNK_SIZE) {
    const chunk = paths.slice(i, i + REFERENCE_CHUNK_SIZE);
    const result = await queryReferencesForChunk(chunk);
    if (!result.success) return result;
    for (const referencedPath of result.found) {
      referencedSet.add(referencedPath);
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
    tables.map((table) => readAllReferencesFromTable(table, chunk))
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

    if (!result.value.success) {
      console.error(
        `[findReferencedStoragePaths] Query to ${tables[i]} failed:`,
        result.value.message
      );
      return {
        success: false,
        message: `Query to ${tables[i]} failed: ${result.value.message}`,
      };
    }

    found.push(...result.value.found);
  }

  return { success: true, found };
}

/**
 * Reads EVERY row of one table whose media_storage_path is in `chunk`,
 * paging until a short page proves the result set is exhausted.
 *
 * A single unpaginated select cannot be trusted here: one storage path can
 * be referenced by many rows (the same media fanned out across platforms,
 * or reused across posts), so a 200-path chunk can match far more than 200
 * rows, and PostgREST silently truncates at the project's max-rows cap.
 * Any reference missed by that truncation would be read as an orphan and
 * its file deleted.
 */
async function readAllReferencesFromTable(
  table:
    | "scheduled_posts"
    | "failed_posts"
    | "pending_tiktok_pulls"
    | "pending_direct_posts",
  chunk: string[]
): Promise<
  { success: true; found: string[] } | { success: false; message: string }
> {
  const found: string[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await adminSupabase
      .from(table)
      .select("media_storage_path")
      .in("media_storage_path", chunk)
      .range(offset, offset + REFERENCE_PAGE_SIZE - 1);

    if (error) {
      return { success: false, message: error.message };
    }
    if (!data || data.length === 0) {
      return { success: true, found };
    }

    for (const row of data) {
      if (row.media_storage_path) {
        found.push(row.media_storage_path);
      }
    }

    // A short page means the range exceeded the result set: done.
    if (data.length < REFERENCE_PAGE_SIZE) {
      return { success: true, found };
    }
    offset += REFERENCE_PAGE_SIZE;
  }
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
