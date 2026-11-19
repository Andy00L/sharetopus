import { and, asc, inArray, lt } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { social_connections } from "@/db/schema";
import { inngest } from "@/inngest/client";

const RETENTION_DAYS = 30;
const BATCH_SIZE = 1000;
const MAX_ITERATIONS = 5;

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
      // Postgres DELETE has no LIMIT, so a batch is a limited id subquery:
      // https://www.postgresql.org/docs/current/sql-delete.html
      const staleBatchIds = db
        .select({ id: social_connections.id })
        .from(social_connections)
        .where(isStaleConnection)
        .orderBy(asc(social_connections.id))
        .limit(BATCH_SIZE);

      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        // The outer WHERE repeats the stale filter. Postgres re-checks it on
        // the current row version, so a row that turned connected after the
        // subquery read it is not deleted:
        // https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED
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
          return { deleted: totalDeleted, cutoff, error: error.message };
        }

        const deletedInBatch = deleteResult.count;
        totalDeleted += deletedInBatch;

        if (deletedInBatch < BATCH_SIZE) {
          break;
        }

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
