import "server-only";

import { lt, sql } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { x402_access_log } from "@/db/schema";

import { inngest } from "../client";

const RETENTION_DAYS = 90;

/**
 * Daily cleanup of x402_access_log rows older than 90 days.
 *
 * Runs at 06:00 UTC. Like mcp_audit_log, the table's append-only trigger
 * (reject_mutation) refuses a DELETE unless the transaction sets
 * app.allow_append_only_delete = 'on', so the DELETE runs in its own
 * transaction that sets it (see cleanupMcpAuditLogCron).
 *
 * Mirrors cleanupMcpAuditLogCron retention policy.
 */
export const cleanupX402AccessLogCron = inngest.createFunction(
  {
    id: "cleanup-x402-access-log",
    name: "Cleanup x402_access_log rows older than 90 days",
    retries: 0,
    triggers: [{ cron: "0 6 * * *" }],
  },
  async ({ step }) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const cutoffIso = cutoff.toISOString();

    const result = await step.run("delete-old-x402-log-rows", async () => {
      const { data: deletedCount, error } = await runQuery(
        db.transaction(async (transaction) => {
          await transaction.execute(
            sql`select set_config('app.allow_append_only_delete', 'on', true)`,
          );
          const deleteResult = await transaction
            .delete(x402_access_log)
            .where(lt(x402_access_log.created_at, cutoffIso));
          return deleteResult.count;
        }),
      );

      if (error) {
        // Thrown so Inngest records the step as failed.
        throw new Error(
          `[cleanupX402AccessLogCron] DELETE failed: ${error.message}`,
        );
      }

      return { deleted: deletedCount };
    });

    console.log(
      `[cleanupX402AccessLogCron] Deleted ${result.deleted} rows older than ${cutoffIso}`,
    );

    return { deleted: result.deleted, cutoff: cutoffIso };
  },
);
