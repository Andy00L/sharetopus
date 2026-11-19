import "server-only";

import { lt, sql } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { mcp_audit_log } from "@/db/schema";

import { inngest } from "../client";

const RETENTION_DAYS = 90;

export const cleanupMcpAuditLogCron = inngest.createFunction(
  {
    id: "cleanup-mcp-audit-log",
    name: "Cleanup mcp_audit_log rows older than 90 days",
    retries: 0,
    triggers: [{ cron: "0 4 * * *" }],
  },
  async ({ step }) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const cutoffIso = cutoff.toISOString();

    const result = await step.run("delete-old-audit-rows", async () => {
      const { data: deletedCount, error } = await runQuery(
        db.transaction(async (transaction) => {
          // set_config's third argument true limits the setting to this
          // transaction: https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADMIN-SET
          await transaction.execute(
            sql`select set_config('app.allow_append_only_delete', 'on', true)`,
          );
          const deleteResult = await transaction
            .delete(mcp_audit_log)
            .where(lt(mcp_audit_log.created_at, cutoffIso));
          return deleteResult.count;
        }),
      );

      if (error) {
        // Thrown so Inngest records the step as failed.
        throw new Error(
          `[cleanupMcpAuditLogCron] DELETE failed: ${error.message}`,
        );
      }

      return { deleted: deletedCount };
    });

    console.log(
      `[cleanupMcpAuditLogCron] Deleted ${result.deleted} rows older than ${cutoffIso}`,
    );

    return { deleted: result.deleted, cutoff: cutoffIso };
  },
);
