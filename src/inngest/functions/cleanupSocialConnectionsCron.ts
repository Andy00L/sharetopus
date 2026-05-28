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
 * Runs at 02:00 UTC to avoid overlap with existing cron jobs at
 * 03:00 (stripe webhook cleanup), 04:00 (stale OAuth clients),
 * and 05:00 (SIWE nonces).
 *
 * Batched: up to 1000 rows per iteration, max 5 iterations per run.
 * If more rows remain after 5 iterations, the next daily run catches them.
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

      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        const { count, error } = await adminSupabase
          .from("social_connections")
          .delete({ count: "exact" })
          .in("status", ["pending", "failed", "expired"])
          .lt("created_at", cutoff)
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

        // If we deleted fewer than BATCH_SIZE, there are no more rows to process
        if (deletedInBatch < BATCH_SIZE) {
          break;
        }
      }

      console.log(
        `[cleanupSocialConnectionsCron] Deleted ${totalDeleted} stale connections older than ${cutoff}`,
      );

      return { deleted: totalDeleted, cutoff };
    });
  },
);
