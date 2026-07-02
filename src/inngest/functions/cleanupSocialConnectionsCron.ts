import { adminSupabase } from "@/actions/api/adminSupabase";
import { inngest } from "@/inngest/client";

const RETENTION_DAYS = 30;
const BATCH_SIZE = 1000;
const MAX_ITERATIONS = 5;

/**
 * Daily cron at 02:00 UTC. Deletes stale social_connections rows
 * older than 30 days with status IN ('pending', 'failed', 'expired').
 *
 * NEVER touches status='connected' or status='revoked' rows.
 * Connected rows are the real audit trail for active OAuth grants.
 *
 * Runs at 02:00 UTC to avoid overlap with the existing cron jobs at
 * 03:00 (stripe webhook cleanup) and 04:00 (stale OAuth clients).
 *
 * Batched: each delete is ordered by id and bounded to 1000 rows per
 * iteration, up to 5 iterations per run. The explicit order is what lets
 * PostgREST honor the per-iteration limit (see the .order call below). If
 * rows remain after 5 iterations, the run logs that the per-run cap was hit
 * and the next daily run clears the rest.
 *
 * Retries: 0 (next daily run handles transient failures).
 */
export const cleanupSocialConnectionsCron = inngest.createFunction(
  {
    id: "cleanup-social-connections",
    name: "Cleanup stale social connections (30d retention)",
    retries: 0,
    triggers: [{ cron: "0 2 * * *" }],
  },
  async ({ step }) => {
    return await step.run("delete-stale-connections", async () => {
      const cutoff = new Date(
        Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();

      let totalDeleted = 0;
      let capReached = false;

      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        const { count, error } = await adminSupabase
          .from("social_connections")
          .delete({ count: "exact" })
          .in("status", ["pending", "failed", "expired"])
          .lt("created_at", cutoff)
          // PostgREST honors a limited delete only when an explicit order on a
          // unique column is present; without it the .limit is ignored and
          // every matching row is deleted in a single statement. Order by the
          // PK so each iteration removes at most BATCH_SIZE rows.
          .order("id", { ascending: true })
          .limit(BATCH_SIZE);

        if (error) {
          console.error(
            `[cleanupSocialConnectionsCron] Delete failed on iteration ${iteration}:`,
            error.message,
          );
          // Return partial stats rather than throwing, so the next daily run
          // picks up where this one left off.
          return { deleted: totalDeleted, cutoff, error: error.message };
        }

        const deletedInBatch = count ?? 0;
        totalDeleted += deletedInBatch;

        // A short batch (fewer than BATCH_SIZE rows) means every remaining
        // stale row was deleted this iteration, so stop early.
        if (deletedInBatch < BATCH_SIZE) {
          break;
        }

        // A full batch on the last allowed iteration means we hit the per-run
        // cap (MAX_ITERATIONS * BATCH_SIZE) and stale rows likely remain. Log
        // it so the under-deletion is visible in the Inngest run; the next
        // daily run clears the rest.
        if (iteration === MAX_ITERATIONS - 1) {
          capReached = true;
          console.log(
            `[cleanupSocialConnectionsCron] Hit per-run cap of ${
              MAX_ITERATIONS * BATCH_SIZE
            } rows; stale rows likely remain and will be cleared on the next daily run`,
          );
        }
      }

      console.log(
        `[cleanupSocialConnectionsCron] Deleted ${totalDeleted} stale connections older than ${cutoff}`,
      );

      return { deleted: totalDeleted, cutoff, capReached };
    });
  },
);
