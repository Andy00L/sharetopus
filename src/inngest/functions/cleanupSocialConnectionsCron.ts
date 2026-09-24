import { and, asc, inArray, lt } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { social_connections } from "@/db/schema";
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
 * Batched: each iteration deletes at most 1000 rows, lowest ids first, up to
 * 5 iterations per run. Postgres has no DELETE ... LIMIT, so each batch is
 * the id-ordered, limited subquery below. If rows remain after 5
 * iterations, the run logs that the per-run cap was hit and the next daily
 * run clears the rest.
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

      const isStaleConnection = and(
        inArray(social_connections.status, ["pending", "failed", "expired"]),
        lt(social_connections.created_at, cutoff),
      );
      const staleBatchIds = db
        .select({ id: social_connections.id })
        .from(social_connections)
        .where(isStaleConnection)
        .orderBy(asc(social_connections.id))
        .limit(BATCH_SIZE);

      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        // The outer WHERE repeats the stale filter. Postgres re-checks it on
        // the current row version, so a row that turned connected after the
        // subquery read it is not deleted.
        const { data: deleteResult, error } = await runQuery(
          db
            .delete(social_connections)
            .where(and(inArray(social_connections.id, staleBatchIds), isStaleConnection)),
        );

        if (error) {
          console.error(
            `[cleanupSocialConnectionsCron] Delete failed on iteration ${iteration}:`,
            error.message,
          );
          // Return partial stats rather than throwing, so the next daily run
          // picks up where this one left off.
          return { deleted: totalDeleted, cutoff, error: error.message };
        }

        const deletedInBatch = deleteResult.count;
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
