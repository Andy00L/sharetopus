import { inngest } from "@/inngest/client";
import {
  listAgedStorageFiles,
  findReferencedStoragePaths,
  batchDeleteStorageFiles,
} from "@/actions/server/data/orphanStorageSweep";

const CUTOFF_HOURS = 24;
const MAX_FILES_PER_RUN = 10_000;
const BUCKET = process.env.SUPABASE_BUCKET_NAME ?? "scheduled-videos";

/**
 * Daily cron that sweeps storage files older than 24h with no reference
 * in any of 4 tables (scheduled_posts, failed_posts, pending_tiktok_pulls,
 * pending_direct_posts).
 *
 * Runs at 03:00 UTC. No retries (next daily run catches any failures).
 * Partial success is acceptable: failed batches are logged and retried
 * on the next run (the 24h cutoff makes them eligible again).
 */
export const sweepOrphanStorageFiles = inngest.createFunction(
  {
    id: "sweep-orphan-storage-files",
    name: "Sweep orphan storage files older than 24h",
    retries: 0,
    triggers: [{ cron: "0 3 * * *" }],
  },
  async ({ step }) => {
    const cutoffIso = new Date(
      Date.now() - CUTOFF_HOURS * 3_600_000
    ).toISOString();

    const listResult = await step.run("list-aged", () =>
      listAgedStorageFiles({ bucket: BUCKET, cutoffIso, maxFiles: MAX_FILES_PER_RUN })
    );

    if (!listResult.success) {
      console.error(
        "[sweepOrphanStorageFiles] List failed:",
        listResult.message
      );
      return { ok: false, reason: listResult.message };
    }

    if (listResult.paths.length === 0) {
      return {
        ok: true,
        scanned: 0,
        referenced: 0,
        orphansFound: 0,
        deleted: 0,
        bytesFreed: 0,
        truncated: false,
      };
    }

    if (listResult.truncated) {
      console.warn(
        `[sweepOrphanStorageFiles] Truncated at ${MAX_FILES_PER_RUN} files. ` +
          "Consider raising MAX_FILES_PER_RUN if this persists."
      );
    }

    const refResult = await step.run("query-references", () =>
      findReferencedStoragePaths(listResult.paths)
    );

    if (!refResult.success) {
      console.error(
        "[sweepOrphanStorageFiles] Reference query failed:",
        refResult.message
      );
      return { ok: false, reason: refResult.message };
    }

    const referencedSet = new Set(refResult.referenced);
    const orphans = listResult.paths.filter((p) => !referencedSet.has(p));

    if (orphans.length === 0) {
      console.log(
        `[sweepOrphanStorageFiles] scanned=${listResult.paths.length} ` +
          `referenced=${refResult.referenced.length} orphans=0`
      );
      return {
        ok: true,
        scanned: listResult.paths.length,
        referenced: refResult.referenced.length,
        orphansFound: 0,
        deleted: 0,
        bytesFreed: 0,
        truncated: listResult.truncated,
      };
    }

    const deleteResult = await step.run("batch-delete", () =>
      batchDeleteStorageFiles({
        bucket: BUCKET,
        paths: orphans,
        pathSizes: listResult.pathSizes,
      })
    );

    if (!deleteResult.success) {
      console.error(
        "[sweepOrphanStorageFiles] Batch delete failed:",
        deleteResult.message
      );
      return { ok: false, reason: deleteResult.message };
    }

    console.log(
      `[sweepOrphanStorageFiles] scanned=${listResult.paths.length} ` +
        `referenced=${refResult.referenced.length} ` +
        `orphans=${orphans.length} ` +
        `deleted=${deleteResult.deletedCount} failed=${deleteResult.failedCount} ` +
        `bytesFreed=${deleteResult.bytesFreed}`
    );

    return {
      ok: true,
      scanned: listResult.paths.length,
      referenced: refResult.referenced.length,
      orphansFound: orphans.length,
      deleted: deleteResult.deletedCount,
      bytesFreed: deleteResult.bytesFreed,
      truncated: listResult.truncated,
    };
  }
);
