import { inngest } from "@/inngest/client";
import {
  listAgedStorageFiles,
  findReferencedStoragePaths,
  batchDeleteStorageFiles,
} from "@/actions/server/data/orphanStorageSweep";
import { MEDIA_BUCKET } from "@/lib/storage/mediaBucket";

const CUTOFF_HOURS = 24;
const MAX_FILES_PER_RUN = 10_000;

type SweepOutcome =
  | {
      ok: true;
      scanned: number;
      referenced: number;
      orphansFound: number;
      deleted: number;
      failed: number;
      bytesFreed: number;
      truncated: boolean;
    }
  | { ok: false; reason: string };

// One step that returns counts only: Inngest stores every step result, so
// the listed paths would be stored and replayed to each later step.
// https://www.inngest.com/docs/learn/how-functions-are-executed
export const sweepOrphanStorageFiles = inngest.createFunction(
  {
    id: "sweep-orphan-storage-files",
    name: "Sweep orphan storage files older than 24h",
    retries: 2,
    triggers: [{ cron: "0 3 * * *" }],
  },
  async ({ step }) => {
    const outcome = await step.run("sweep-orphans", async () => {
      const sweepResult = await sweepOrphans(
        new Date(Date.now() - CUTOFF_HOURS * 3_600_000).toISOString(),
      );
      // Inngest marks a step failed, and retries it, only when it throws:
      // https://www.inngest.com/docs/guides/error-handling
      if (!sweepResult.ok) {
        throw new Error(`[sweepOrphanStorageFiles] Sweep failed: ${sweepResult.reason}`);
      }
      return sweepResult;
    });
    console.log(
      `[sweepOrphanStorageFiles] scanned=${outcome.scanned} referenced=${outcome.referenced} ` +
        `orphans=${outcome.orphansFound} deleted=${outcome.deleted} failed=${outcome.failed} ` +
        `bytesFreed=${outcome.bytesFreed} truncated=${outcome.truncated}`,
    );
    return outcome;
  },
);

async function sweepOrphans(cutoffIso: string): Promise<SweepOutcome> {
  const listResult = await listAgedStorageFiles({
    bucket: MEDIA_BUCKET,
    cutoffIso,
    maxFiles: MAX_FILES_PER_RUN,
  });
  if (!listResult.success) return { ok: false, reason: listResult.message };

  if (listResult.truncated) {
    console.warn(
      `[sweepOrphans] Truncated at ${MAX_FILES_PER_RUN} files. ` +
        "Consider raising MAX_FILES_PER_RUN if this persists.",
    );
  }

  const emptyCounts = {
    ok: true as const,
    scanned: listResult.paths.length,
    referenced: 0,
    orphansFound: 0,
    deleted: 0,
    failed: 0,
    bytesFreed: 0,
    truncated: listResult.truncated,
  };
  if (listResult.paths.length === 0) return emptyCounts;

  const refResult = await findReferencedStoragePaths(listResult.paths);
  if (!refResult.success) return { ok: false, reason: refResult.message };

  const referencedPaths = new Set(refResult.referenced);
  const orphans = listResult.paths.filter(
    (storagePath) => !referencedPaths.has(storagePath),
  );
  if (orphans.length === 0) {
    return { ...emptyCounts, referenced: refResult.referenced.length };
  }

  const deleteResult = await batchDeleteStorageFiles({
    bucket: MEDIA_BUCKET,
    paths: orphans,
    pathSizes: listResult.pathSizes,
  });
  if (!deleteResult.success) return { ok: false, reason: deleteResult.message };

  return {
    ...emptyCounts,
    referenced: refResult.referenced.length,
    orphansFound: orphans.length,
    deleted: deleteResult.deletedCount,
    failed: deleteResult.failedCount,
    bytesFreed: deleteResult.bytesFreed,
  };
}
